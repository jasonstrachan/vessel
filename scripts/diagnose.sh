#!/bin/bash
# TinyBrush Network Diagnostics Script

echo "🔍 Network Diagnostics for TinyBrush"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "❌ Not in TinyBrush project directory"
  exit 1
fi

# Check Node.js and npm
echo "📦 Environment:"
echo "  Node.js version: $(node --version)"
echo "  npm version: $(npm --version)"
echo "  Current directory: $(pwd)"

# Check ports
echo ""
echo "🔌 Port Status:"
for port in 3000 3001 3002 3003; do
  if command -v lsof >/dev/null 2>&1; then
    if lsof -i:$port >/dev/null 2>&1; then
      echo "  Port $port: ❌ IN USE"
      lsof -i:$port | head -5
    else
      echo "  Port $port: ✅ Available"
    fi
  else
    # Fallback if lsof is not available
    if ss -tlnp | grep -q ":$port "; then
      echo "  Port $port: ❌ IN USE"
    else
      echo "  Port $port: ✅ Available"
    fi
  fi
done

# Check if we can bind to localhost
echo ""
echo "🌐 Testing localhost connectivity..."
if command -v curl >/dev/null 2>&1; then
  if curl -s --connect-timeout 2 http://localhost:3000 >/dev/null 2>&1; then
    echo "✅ localhost:3000 is accessible"
  else
    echo "❌ localhost:3000 is not accessible"
  fi
else
  echo "⚠️ curl not available for connectivity test"
fi

# Check processes
echo ""
echo "⚙️ Running Node.js processes:"
if ps aux | grep -i node | grep -v grep >/dev/null; then
  ps aux | grep -i node | grep -v grep | head -5
else
  echo "  No Node.js processes found"
fi

echo ""
echo "🗂️ Next.js cache status:"
if [ -d ".next" ]; then
  echo "  ✅ .next directory exists ($(du -sh .next 2>/dev/null | cut -f1 || echo 'unknown size'))"
else
  echo "  ❌ .next directory missing"
fi

echo ""
echo "📁 Project status:"
if [ -d "node_modules" ]; then
  echo "  ✅ node_modules directory exists"
else
  echo "  ❌ node_modules directory missing - run 'npm install'"
fi

echo ""
echo "🔧 Recommendations:"
if [ ! -d "node_modules" ]; then
  echo "  • Run: npm install"
fi
if ps aux | grep -i node | grep -v grep >/dev/null; then
  echo "  • Stop existing Node.js processes: ./scripts/cleanup.sh"
fi
echo "  • Start clean development server: npm run dev:safe"