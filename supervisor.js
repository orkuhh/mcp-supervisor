#!/usr/bin/env node
/**
 * MCP Supervisor - Process Manager for MCP Servers
 * 
 * Features:
 * - Auto-start standalone MCP servers (custom Node.js servers)
 * - Health monitoring via process checking + MCP ping probes
 * - Auto-restart crashed/unhealthy servers
 * - Status reporting via API
 * - Compatible with stdio-based servers managed by OpenClaw
 * 
 * Usage: node supervisor.js [start|stop|status|restart|check]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = '/root/.openclaw/workspace/config/mcporter.json';
const STATE_PATH = '/root/.openclaw/workspace/.mcp-supervisor-state.json';
const LOG_DIR = '/root/.openclaw/workspace/logs/mcp-supervisor';
const CHECK_INTERVAL = 30000; // 30 seconds
const HEALTHY_THRESHOLD = 3; // Consecutive healthy checks before marking healthy

class MCPSupervisor {
  constructor() {
    this.servers = new Map();
    this.state = this.loadState();
    this.running = false;
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      }
    } catch (e) {}
    return { servers: {}, lastCheck: null };
  }

  saveState() {
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      servers: Object.fromEntries(this.servers),
      lastCheck: Date.now()
    }, null, 2));
  }

  loadConfig() {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return config.mcpServers || {};
    } catch (e) {
      console.error('Failed to load MCP config:', e.message);
      return {};
    }
  }

  async start() {
    if (this.running) {
      console.log('Supervisor already running');
      return;
    }

    // Ensure log directory exists
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const servers = this.loadConfig();
    
    // Only start servers that can run standalone (Node.js servers, not npx/uvx stdio servers)
    // Also exclude on-demand tools that should run only when called
    const EXCLUDED_SERVERS = ['mcp-health-monitor']; // Run on-demand, not continuously
    const standaloneServers = Object.entries(servers).filter(([name, config]) => {
      // Skip stdio-based servers (npx, uvx) - these are managed by OpenClaw
      if (config.command === 'npx' || config.command === 'uvx') {
        console.log(`⏭️  Skipping ${name} (stdio server, managed by OpenClaw)`);
        return false;
      }
      // Skip excluded servers (on-demand tools)
      if (EXCLUDED_SERVERS.includes(name)) {
        console.log(`⏭️  Skipping ${name} (on-demand tool)`);
        return false;
      }
      return true;
    });

    console.log(`🚀 MCP Supervisor starting ${standaloneServers.length}/${Object.keys(servers).length} standalone servers...`);

    for (const [name, config] of standaloneServers) {
      await this.startServer(name, config);
    }

    this.running = true;
    this.startHealthCheckLoop();
    console.log('✅ Standalone servers started');
  }

  async startServer(name, config) {
    const logFile = path.join(LOG_DIR, `${name}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Kill existing process if any
    this.stopServer(name);

    const proc = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout.on('data', (data) => logStream.write(`[STDOUT] ${data}`));
    proc.stderr.on('data', (data) => logStream.write(`[STDERR] ${data}`));

    proc.on('error', (err) => {
      logStream.write(`[ERROR] Process error: ${err.message}\n`);
      this.updateServerStatus(name, 'error');
    });

    proc.on('exit', (code, signal) => {
      logStream.write(`[EXIT] Code: ${code}, Signal: ${signal}\n`);
      this.updateServerStatus(name, 'stopped');
    });

    this.servers.set(name, {
      process: proc,
      config,
      status: 'starting',
      pid: proc.pid,
      healthyChecks: 0,
      lastStart: Date.now()
    });

    // Initial status
    this.updateServerStatus(name, 'running');
    logStream.write(`[STARTED] PID: ${proc.pid}\n`);

    return proc;
  }

  stopServer(name) {
    const server = this.servers.get(name);
    if (server && server.process && !server.process.killed) {
      server.process.kill('SIGTERM');
      setTimeout(() => {
        if (server.process && !server.process.killed) {
          server.process.kill('SIGKILL');
        }
      }, 5000);
    }
    this.updateServerStatus(name, 'stopped');
  }

  async checkHealth(name) {
    const server = this.servers.get(name);
    if (!server || server.status === 'stopped') return false;

    const pid = server.pid;
    try {
      // Check if process exists
      process.kill(pid, 0);
      server.healthyChecks++;
      
      if (server.status !== 'healthy' && server.healthyChecks >= HEALTHY_THRESHOLD) {
        server.status = 'healthy';
        console.log(`✅ ${name} is healthy`);
      }
      return true;
    } catch (e) {
      server.status = 'unhealthy';
      server.healthyChecks = 0;
      console.log(`⚠️ ${name} is unhealthy, restarting...`);
      return false;
    }
  }

  updateServerStatus(name, status) {
    const server = this.servers.get(name);
    if (server) {
      server.status = status;
      this.saveState();
    }
  }

  async startHealthCheckLoop() {
    setInterval(async () => {
      for (const [name, server] of this.servers) {
        const isHealthy = await this.checkHealth(name);
        if (!isHealthy && server.config) {
          // Auto-restart unhealthy server
          console.log(`🔄 Restarting ${name}...`);
          await this.startServer(name, server.config);
        }
      }
      this.saveState();
    }, CHECK_INTERVAL);
  }

  async status() {
    const servers = this.loadConfig();
    const report = { timestamp: new Date().toISOString(), servers: {} };

    for (const [name, config] of Object.entries(servers)) {
      const server = this.servers.get(name);
      const isStandalone = config.command !== 'npx' && config.command !== 'uvx';
      
      report.servers[name] = {
        configured: true,
        type: isStandalone ? 'standalone' : 'stdio',
        managed: isStandalone,
        running: isStandalone ? (server?.process?.killed === false) : null,
        pid: server?.pid,
        uptime: server?.lastStart ? Date.now() - server.lastStart : null,
        status: server?.status || (isStandalone ? 'not_started' : 'openclaw_managed')
      };
    }

    return report;
  }

  async stop() {
    console.log('🛑 Stopping all servers...');
    for (const [name] of this.servers) {
      this.stopServer(name);
    }
    this.running = false;
    console.log('✅ All servers stopped');
  }
}

// CLI handling
const supervisor = new MCPSupervisor();
const command = process.argv[2] || 'start';

(async () => {
  switch (command) {
    case 'start':
      await supervisor.start();
      break;
    case 'stop':
      await supervisor.stop();
      break;
    case 'status':
      const status = await supervisor.status();
      console.log(JSON.stringify(status, null, 2));
      break;
    case 'restart':
      await supervisor.stop();
      await supervisor.start();
      break;
    default:
      console.log('Usage: node supervisor.js [start|stop|status|restart]');
  }
})();
