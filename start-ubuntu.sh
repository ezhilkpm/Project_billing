#!/bin/bash
# start-ubuntu.sh - Startup script for Ubuntu Server
echo "============================================================"
echo "  Starting ChefPulse Restaurant POS Server (Ubuntu Server)  "
echo "============================================================"

# Navigate to script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    echo "Install via: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing required npm dependencies..."
    npm install
fi

# Optional: Run via PM2 if installed, else run via node
if command -v pm2 &> /dev/null; then
    echo "Starting via PM2 Daemon..."
    pm2 start ecosystem.config.cjs
    pm2 save
else
    echo "Starting server on port 4000..."
    node server/server.js
fi
