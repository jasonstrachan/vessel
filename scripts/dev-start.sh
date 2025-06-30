#!/bin/bash
# TinyBrush Robust Development Server Startup Script

set -e  # Exit on any error

echo "🚀 Starting TinyBrush Development Server"
echo "======================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "❌ Error: Not in TinyBrush project directory"
  echo "Please run this script from the project root"
  exit 1
fi

# Step 1: Cleanup existing processes
echo "📝 Step 1: Cleanup existing processes"
if [ -f "scripts/cleanup.sh" ]; then
  chmod +x scripts/cleanup.sh
  ./scripts/cleanup.sh
else
  echo "⚠️ Cleanup script not found, performing basic cleanup..."
  pkill -f "next" 2>/dev/null || true
  pkill -f "node" 2>/dev/null || true
fi

# Step 2: Check dependencies
echo ""
echo "📦 Step 2: Check dependencies"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
else
  echo "✅ Dependencies already installed"
fi

# Step 3: Find available port
echo ""
echo "🔍 Step 3: Find available port"
find_available_port() {
  for port in 3000 3001 3002 3003 3004; do
    if command -v lsof >/dev/null 2>&1; then
      if ! lsof -i:$port >/dev/null 2>&1; then
        echo $port
        return
      fi
    else
      # Fallback using ss
      if ! ss -tlnp | grep -q ":$port "; then
        echo $port
        return
      fi
    fi
  done
  echo "3000"  # fallback
}

PORT=$(find_available_port)
echo "✅ Using port: $PORT"

# Step 4: Clean build cache
echo ""
echo "🗂️ Step 4: Prepare build environment"
rm -rf .next 2>/dev/null || true
echo "✅ Build cache cleaned"

# Step 5: Set environment variables
echo ""
echo "⚙️ Step 5: Configure environment"
export PORT=$PORT
export NODE_ENV=development
export NEXT_TELEMETRY_DISABLED=1

echo "Environment configured:"
echo "  PORT=$PORT"
echo "  NODE_ENV=$NODE_ENV"

# Step 6: Start the server
echo ""
echo "🔥 Step 6: Starting Next.js development server..."
echo "Server will be available at: http://localhost:$PORT"
echo "Press Ctrl+C to stop the server"
echo ""

# Use different startup methods based on available tools
if command -v timeout >/dev/null 2>&1; then
  # If timeout is available, use it to handle hanging
  timeout 300 npm run dev -- --port $PORT --hostname 0.0.0.0 || {
    echo "❌ Server failed to start within 5 minutes"
    exit 1
  }
else
  # Direct startup
  npm run dev -- --port $PORT --hostname 0.0.0.0
fi

# If we get here, the server stopped
echo ""
echo "⚠️ Development server stopped"