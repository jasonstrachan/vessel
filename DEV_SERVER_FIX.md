# TinyBrush Development Server - Permanent Fix Guide

## Current Issues
- ERR_CONNECTION_REFUSED 
- Server process management problems
- Port conflicts
- Inconsistent startup behavior

## Comprehensive Solution

### 1. Complete Process Cleanup Script

Create a script to properly clean up all Node.js and Next.js processes:

```bash
#!/bin/bash
# File: scripts/cleanup.sh

echo "🧹 Cleaning up development processes..."

# Kill all Node.js processes
pkill -f "node" 2>/dev/null || true
pkill -f "next" 2>/dev/null || true

# Kill processes on common ports
for port in 3000 3001 3002; do
  pid=$(lsof -ti:$port 2>/dev/null)
  if [ ! -z "$pid" ]; then
    echo "Killing process on port $port (PID: $pid)"
    kill -9 $pid 2>/dev/null || true
  fi
done

# Clean Next.js cache
rm -rf .next 2>/dev/null || true
rm -rf node_modules/.cache 2>/dev/null || true

echo "✅ Cleanup complete"
```

### 2. Robust Development Startup Script

```bash
#!/bin/bash
# File: scripts/dev-start.sh

set -e  # Exit on any error

echo "🚀 Starting TinyBrush Development Server"

# Step 1: Cleanup
./scripts/cleanup.sh

# Step 2: Check dependencies
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Step 3: Find available port
find_available_port() {
  for port in 3000 3001 3002 3003; do
    if ! lsof -i:$port >/dev/null 2>&1; then
      echo $port
      return
    fi
  done
  echo "3000"  # fallback
}

PORT=$(find_available_port)
echo "🔍 Using port: $PORT"

# Step 4: Start server with explicit configuration
export PORT=$PORT
export NODE_ENV=development

echo "🔥 Starting Next.js development server..."
npm run dev -- --port $PORT --hostname 0.0.0.0

# If we get here, the server stopped unexpectedly
echo "❌ Server stopped unexpectedly"
exit 1
```

### 3. Network Diagnostics Script

```bash
#!/bin/bash
# File: scripts/diagnose.sh

echo "🔍 Network Diagnostics for TinyBrush"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "❌ Not in TinyBrush project directory"
  exit 1
fi

# Check Node.js and npm
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Check ports
echo ""
echo "Port Status:"
for port in 3000 3001 3002; do
  if lsof -i:$port >/dev/null 2>&1; then
    echo "  Port $port: ❌ IN USE"
    lsof -i:$port
  else
    echo "  Port $port: ✅ Available"
  fi
done

# Check if we can bind to localhost
echo ""
echo "Testing localhost connectivity..."
if curl -s http://localhost:3000 >/dev/null 2>&1; then
  echo "✅ localhost:3000 is accessible"
else
  echo "❌ localhost:3000 is not accessible"
fi

# Check processes
echo ""
echo "Running Node.js processes:"
ps aux | grep -i node | grep -v grep || echo "No Node.js processes found"

echo ""
echo "Next.js cache status:"
if [ -d ".next" ]; then
  echo "✅ .next directory exists ($(du -sh .next | cut -f1))"
else
  echo "❌ .next directory missing"
fi
```

### 4. Updated package.json Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:clean": "./scripts/cleanup.sh && npm run dev",
    "dev:safe": "./scripts/dev-start.sh",
    "dev:diagnose": "./scripts/diagnose.sh",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

### 5. Next.js Configuration Update

```typescript
// File: next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Ensure proper development server configuration
  webpack: (config, { dev }) => {
    if (dev) {
      // Development optimizations
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      }
    }
    return config
  },
  
  // Experimental features for better development experience
  experimental: {
    // Disable problematic features in development
    esmExternals: 'loose',
  },
  
  // Server configuration
  async rewrites() {
    return []
  },
  
  // Ensure assets are served correctly
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
}

export default nextConfig
```

### 6. Environment Configuration

```bash
# File: .env.local
NODE_ENV=development
NEXT_TELEMETRY_DISABLED=1
PORT=3000
```

### 7. Complete Resolution Steps

Execute these commands in order:

```bash
# 1. Make scripts executable
chmod +x scripts/*.sh

# 2. Run diagnostics
npm run dev:diagnose

# 3. Clean start
npm run dev:safe
```

## Troubleshooting Reference

### Issue: ERR_CONNECTION_REFUSED
**Cause**: Server not running or port conflicts
**Solution**: Run `npm run dev:diagnose` then `npm run dev:safe`

### Issue: Server starts but can't connect
**Cause**: Firewall or network configuration
**Solution**: Check firewall settings, try different ports

### Issue: Repeated port conflicts
**Cause**: Processes not properly cleaned up
**Solution**: Run `./scripts/cleanup.sh` before starting

### Issue: Build failures
**Cause**: Corrupted cache or dependencies
**Solution**: 
```bash
rm -rf node_modules .next
npm install
npm run build
```

## Prevention Checklist

- [ ] Always use `npm run dev:safe` to start development
- [ ] Run cleanup script when switching branches
- [ ] Check diagnostics if experiencing issues
- [ ] Use consistent port configuration
- [ ] Monitor console for error messages

## Development Workflow

1. **Start development**: `npm run dev:safe`
2. **Test application**: Open http://localhost:3000
3. **Debug issues**: `npm run dev:diagnose`
4. **Clean restart**: `npm run dev:clean`
5. **Stop development**: Ctrl+C, then `./scripts/cleanup.sh`

This comprehensive setup should eliminate connection issues permanently.