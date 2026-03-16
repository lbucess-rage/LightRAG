#!/bin/bash
#
# LightRAG Server Management Script
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_DIR/.venv"
LOG_FILE="/tmp/lightrag-server.log"
PID_FILE="/tmp/lightrag-server.pid"
HEALTH_URL="http://localhost:9621/health"
MAX_WAIT=60  # Maximum seconds to wait for server startup

cd "$PROJECT_DIR"

# Get the main python process PID (not shell wrapper)
get_server_pid() {
    pgrep -f "python -m lightrag.api.lightrag_server" | head -1
}

# Check if server is healthy via API
check_health() {
    curl -s --max-time 2 "$HEALTH_URL" | grep -q '"status":"healthy"'
}

start() {
    local existing_pid=$(get_server_pid)
    if [ -n "$existing_pid" ]; then
        echo "Server is already running (PID: $existing_pid)"
        return 1
    fi

    echo "Starting LightRAG server..."
    source "$VENV_DIR/bin/activate"
    nohup python -m lightrag.api.lightrag_server > "$LOG_FILE" 2>&1 &

    # Wait for server to start with health check
    echo -n "Waiting for server to be ready"
    local waited=0
    while [ $waited -lt $MAX_WAIT ]; do
        sleep 2
        waited=$((waited + 2))
        echo -n "."

        if check_health; then
            local pid=$(get_server_pid)
            echo "$pid" > "$PID_FILE"
            echo ""
            echo "Server started successfully (PID: $pid)"
            echo "Health: OK"
            return 0
        fi
    done

    echo ""
    echo "Server failed to start within ${MAX_WAIT}s. Check logs: $LOG_FILE"
    tail -10 "$LOG_FILE"
    return 1
}

stop() {
    local pid=$(get_server_pid)

    if [ -z "$pid" ]; then
        echo "Server is not running"
        rm -f "$PID_FILE"
        return 1
    fi

    echo "Stopping LightRAG server (PID: $pid)..."
    kill "$pid" 2>/dev/null

    # Wait for graceful shutdown
    local waited=0
    while [ $waited -lt 10 ]; do
        sleep 1
        waited=$((waited + 1))
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$PID_FILE"
            echo "Server stopped"
            return 0
        fi
    done

    # Force kill if still running
    echo "Force killing..."
    kill -9 "$pid" 2>/dev/null
    rm -f "$PID_FILE"
    echo "Server stopped (forced)"
}

restart() {
    stop
    sleep 2
    start
}

status() {
    local pid=$(get_server_pid)

    if [ -n "$pid" ]; then
        echo "Server is running (PID: $pid)"
        if check_health; then
            echo "Health: OK"
        else
            echo "Health: UNHEALTHY (API not responding)"
        fi
    else
        echo "Server is not running"
    fi
}

logs() {
    tail -f "$LOG_FILE"
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    health)
        if check_health; then
            echo "Health: OK"
        else
            echo "Health: UNHEALTHY"
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|health}"
        exit 1
        ;;
esac
