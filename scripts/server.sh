#!/bin/bash
#
# LightRAG Server Management Script
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_DIR/.venv"
LOG_FILE="/tmp/lightrag-server.log"
PID_FILE="/tmp/lightrag-server.pid"

cd "$PROJECT_DIR"

start() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Server is already running (PID: $(cat "$PID_FILE"))"
        return 1
    fi

    echo "Starting LightRAG server..."
    source "$VENV_DIR/bin/activate"
    nohup python -m lightrag.api.lightrag_server > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 5

    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Server started (PID: $(cat "$PID_FILE"))"
        tail -5 "$LOG_FILE"
    else
        echo "Failed to start server. Check logs: $LOG_FILE"
        return 1
    fi
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        # Try to find process by name
        PID=$(pgrep -f "python -m lightrag.api.lightrag_server")
        if [ -z "$PID" ]; then
            echo "Server is not running"
            return 1
        fi
    else
        PID=$(cat "$PID_FILE")
    fi

    echo "Stopping LightRAG server (PID: $PID)..."
    kill "$PID" 2>/dev/null
    sleep 2

    if kill -0 "$PID" 2>/dev/null; then
        echo "Force killing..."
        kill -9 "$PID" 2>/dev/null
    fi

    rm -f "$PID_FILE"
    echo "Server stopped"
}

restart() {
    stop
    sleep 2
    start
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Server is running (PID: $(cat "$PID_FILE"))"
    else
        PID=$(pgrep -f "python -m lightrag.api.lightrag_server")
        if [ -n "$PID" ]; then
            echo "Server is running (PID: $PID)"
        else
            echo "Server is not running"
        fi
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
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
