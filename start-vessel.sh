#!/bin/bash

# Vessel WSL2-Friendly Startup Script
# Starts both Next.js backend and Express proxy server

echo "🎨 Starting Vessel with WSL2-Friendly Proxy"
echo "============================================="

# Kill any existing servers
echo "🛑 Stopping existing servers..."
pkill -f "next dev" 2>/dev/null
pkill -f "proxy-server" 2>/dev/null
pkill -f "node.*3000" 2>/dev/null
pkill -f "node.*8080" 2>/dev/null
sleep 2

# Get WSL2 IP
WSL_IP=$(hostname -I | awk '{print $1}')
echo "🌐 WSL2 IP: $WSL_IP"

# Start Next.js backend in background
echo "⚡ Starting Next.js backend server..."
npm run dev:backend > next.log 2>&1 &
NEXT_PID=$!

# Wait for Next.js to start
echo "⏳ Waiting for Next.js to initialize..."
sleep 5

# Check if Next.js started successfully
if kill -0 $NEXT_PID 2>/dev/null; then
    echo "✅ Next.js backend running (PID: $NEXT_PID)"
else
    echo "❌ Next.js backend failed to start"
    echo "📄 Check next.log for details"
    exit 1
fi

# Start proxy server in background
echo "🚀 Starting proxy server..."
npm run dev:proxy > proxy.log 2>&1 &
PROXY_PID=$!

# Wait for proxy to start
sleep 3

# Check if proxy started successfully
if kill -0 $PROXY_PID 2>/dev/null; then
    echo "✅ Proxy server running (PID: $PROXY_PID)"
else
    echo "❌ Proxy server failed to start"
    echo "📄 Check proxy.log for details"
    kill $NEXT_PID 2>/dev/null
    exit 1
fi

echo ""
echo "🎉 Vessel is ready!"
echo "===================="
echo "🔗 Main URL:      http://localhost:8080"
echo "🌐 Network URL:   http://$WSL_IP:8080"
echo "🏥 Health Check:  http://localhost:8080/health"
echo ""
echo "🎨 Your optimized pixel drawing features:"
echo "   ✅ Minimal waiting pixel algorithm"
echo "   ✅ Removed console logging spam"
echo "   ✅ Comprehensive test coverage"
echo "   ✅ Build timestamp verification"
echo ""
echo "📊 Server Status:"
echo "   Next.js Backend: http://localhost:3000 (PID: $NEXT_PID)"
echo "   Express Proxy:   http://localhost:8080 (PID: $PROXY_PID)"
echo ""
echo "🛑 To stop: Ctrl+C or run: ./stop-vessel.sh"
echo ""

# Test connectivity
echo "🔍 Testing connectivity..."
sleep 2
if curl -s http://localhost:8080/health > /dev/null; then
    echo "✅ Proxy server responding"
    if curl -s http://localhost:3000 > /dev/null; then
        echo "✅ Next.js backend responding"
        echo "🎯 SUCCESS: All systems operational!"
    else
        echo "⚠️  Next.js backend not responding (but proxy is working)"
    fi
else
    echo "❌ Proxy server not responding"
fi

echo ""
echo "📝 Logs:"
echo "   Next.js: tail -f next.log"
echo "   Proxy:   tail -f proxy.log"
echo ""

# Keep script running and handle shutdown
trap 'echo ""; echo "🛑 Shutting down Vessel..."; kill $NEXT_PID $PROXY_PID 2>/dev/null; echo "✅ Stopped"; exit 0' INT TERM

# Wait for either process to exit
while kill -0 $NEXT_PID 2>/dev/null && kill -0 $PROXY_PID 2>/dev/null; do
    sleep 1
done

echo "💥 A server process died. Check logs and restart."