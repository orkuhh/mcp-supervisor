# MCP Supervisor

Lightweight process manager for MCP servers with health monitoring and auto-restart capabilities.

## Architecture Overview

```
OpenClaw MCP Stack:
┌─────────────────────────────────────────────────────┐
│ OpenClaw Gateway                                    │
│  ├── MCP Client (connects via stdio)               │
│  └── Spawns stdio servers on demand:               │
│      • fetch (uvx)                                  │
│      • memory (npx)                                 │
│      • filesystem (npx)                            │
│      • sequential-thinking (npx)                   │
└─────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────┐
│ MCP Supervisor (this project)                       │
│  • Manages standalone servers:                      │
│    - shell-mcp-server (Node.js)                     │
│    - workspace-memory (Node.js)                    │
│    - devutils (Node.js)                            │
│    - git (Node.js)                                 │
│    - github (Node.js)                              │
│    - process (Node.js)                             │
│    - system-stats (Node.js)                        │
│    - mcp-health-monitor (Node.js)                  │
│    - link-preview (Node.js)                        │
│  • Health monitoring (30s intervals)               │
│  • Auto-restart crashed servers                     │
└─────────────────────────────────────────────────────┘
```

## Why Two Management Layers?

| Aspect | OpenClaw MCP | MCP Supervisor |
|--------|-------------|-----------------|
| Transport | stdio | stdin + HTTP |
| Spawns | On-demand per request | Persistent background |
| Lifecycle | Per-message | Continuous |
| Use case | Ephemeral commands | Persistent services |

The supervisor complements OpenClaw's built-in MCP management by providing:
- **Persistent processes** for servers that benefit from long-running state
- **Health monitoring** with restart on crash
- **Status API** for visibility into all servers
- **Auto-heal** for standalone-capable servers

## Quick Start

```bash
# Start standalone servers
./ctrl.sh start

# Check status
./ctrl.sh status

# Restart all
./ctrl.sh restart

# Stop supervisor (stdio servers stay managed by OpenClaw)
./ctrl.sh stop
```

## Systemd Installation

```bash
./ctrl.sh install-systemd
systemctl start mcp-supervisor
systemctl enable mcp-supervisor
```

## Server Types

| Type | Description | Managed By |
|------|-------------|------------|
| stdio | Servers using stdio transport (fetch, memory, filesystem, etc.) | OpenClaw |
| standalone | Node.js servers that can run persistently | MCP Supervisor |

The supervisor automatically detects which servers can run standalone and only manages those.

## What Gets Started

```
⏭️  Skipping fetch (stdio server, managed by OpenClaw)
⏭️  Skipping memory (stdio server, managed by OpenClaw)
🚀 MCP Supervisor starting 9/13 standalone servers...
```

## Status Output

```json
{
  "fetch": { "type": "stdio", "managed": false, "status": "openclaw_managed" },
  "shell-mcp-server": { "type": "standalone", "managed": true, "running": true, "pid": 1234 },
  "workspace-memory": { "type": "standalone", "managed": true, "running": true, "pid": 1235 }
}
```

## Files

```
mcp-supervisor/
├── supervisor.js           # Main process manager
├── ctrl.sh                 # Control script
├── mcp-supervisor.service  # Systemd unit
├── README.md               # This file
└── logs/
    └── mcp-supervisor/     # Server logs
```

## Integration with OpenClaw

- Reads `/root/.openclaw/workspace/config/mcporter.json` for server definitions
- Works alongside OpenClaw's built-in MCP spawning
- Complements `mcp-health-monitor` tool (API-level vs process-level)

## Extending Servers for Standalone Mode

To make an MCP server support standalone mode, add an HTTP transport:

```javascript
// Example: Add this to your server's main file
if (process.env.STANDALONE === 'true') {
  const express = require('express');
  const { Server } = require('@modelcontextprotocol/sdk/server/http.js');
  
  const app = express();
  app.use(express.json());
  
  const server = new Server(...);
  
  // Mount stdio server on HTTP
  const httpServer = app.listen(3000, () => {
    console.log('MCP Server running on HTTP :3000');
  });
}
```

## Troubleshooting

### Server keeps exiting
- Stdio servers exit when stdin closes - this is expected
- Only standalone servers should be managed by supervisor

### Supervisor can't start server
Check logs: `cat logs/mcp-supervisor/{server-name}.log`

### Process running but status shows false
Process might have exited between check and status query.

## Created

2026-02-11 | Nightly Build
