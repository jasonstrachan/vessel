#!/bin/bash
# TinyBrush Development Server Cleanup Script

echo "🧹 Cleaning up development processes..."

# Kill only Next.js development processes (not VS Code)
pkill -f "next dev" 2>/dev/null || true
pkill -f "tinybrush" 2>/dev/null || true

# Kill processes on common ports
for port in 3000 3001 3002 3003; do
  pid=$(lsof -ti:$port 2>/dev/null || true)
  if [ ! -z "$pid" ]; then
    echo "Killing process on port $port (PID: $pid)"
    kill -9 $pid 2>/dev/null || true
  fi
done

# Clean Next.js cache
echo "🗂️ Cleaning Next.js cache..."
rm -rf .next 2>/dev/null || true
rm -rf node_modules/.cache 2>/dev/null || true

# Wait a moment for processes to fully terminate
sleep 2

echo "✅ Cleanup complete"