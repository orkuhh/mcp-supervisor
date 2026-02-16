#!/bin/bash
# MCP Supervisor Control Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERVISOR="$SCRIPT_DIR/supervisor.js"
LOG_DIR="$SCRIPT_DIR/logs/mcp-supervisor"

case "$1" in
    start)
        echo "🚀 Starting MCP Supervisor..."
        mkdir -p "$LOG_DIR"
        node "$SUPERVISOR" start
        ;;
    stop)
        echo "🛑 Stopping MCP Supervisor..."
        node "$SUPERVISOR" stop
        ;;
    restart)
        echo "🔄 Restarting MCP Supervisor..."
        node "$SUPERVISOR" restart
        ;;
    status)
        echo "📊 MCP Supervisor Status:"
        node "$SUPERVISOR" status | jq .
        ;;
    install-systemd)
        echo "📦 Installing systemd service..."
        cp "$SCRIPT_DIR/mcp-supervisor.service" /etc/systemd/system/
        systemctl daemon-reload
        systemctl enable mcp-supervisor
        echo "✅ Installed. Run 'systemctl start mcp-supervisor' to start."
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|install-systemd}"
        exit 1
        ;;
esac
