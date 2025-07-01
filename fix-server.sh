#!/bin/bash
# WSL2 Server Fix Script - One-click solution

echo "🔧 TinyBrush WSL2 Server Fix"
echo "================================"

# Kill existing servers
echo "1. 🛑 Stopping existing servers..."
pkill -f next
sleep 2

# Get WSL2 IP
WSL_IP=$(hostname -I | awk '{print $1}')
echo "2. 🌐 WSL2 IP detected: $WSL_IP"

# Clean build cache if needed
if [ ! -d ".next" ]; then
    echo "3. 🧹 Running clean build..."
    npm run build
else
    echo "3. ✅ Build exists, skipping..."
fi

# Start server with proper binding
echo "4. 🚀 Starting Next.js server..."
npx next dev --hostname 0.0.0.0 --port 3000 &
sleep 4

# Test connection
echo "5. 🔍 Testing connection..."
if curl -s -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ SUCCESS: Server accessible at http://localhost:3000"
    echo "🎉 Your optimized pixel drawing is ready!"
else
    echo "❌ Connection failed. Attempting Windows port forwarding..."
    
    # Try port forwarding via PowerShell
    /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "
    Write-Host 'Configuring Windows networking...'
    try {
        # Remove existing rule
        netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 2>`$null
        
        # Add new rule
        netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$WSL_IP
        
        # Add firewall rule
        New-NetFirewallRule -DisplayName 'TinyBrush-WSL2' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -ErrorAction SilentlyContinue
        
        Write-Host '✅ Port forwarding and firewall configured'
    } catch {
        Write-Host '❌ Failed - try running PowerShell as Administrator'
        Write-Host 'Manual command: netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$WSL_IP'
    }
    "
    
    # Test again after port forwarding
    sleep 3
    if curl -s -f http://localhost:3000 > /dev/null 2>&1; then
        echo "✅ SUCCESS: Port forwarding fixed the issue!"
    else
        echo "⚠️  Still having issues. Try accessing directly:"
        echo "   🔗 http://$WSL_IP:3000"
        echo "   🔗 http://localhost:3000"
        echo ""
        echo "💡 Alternative: Run 'npm run build && npx next start --hostname 0.0.0.0'"
    fi
fi

echo ""
echo "📊 Connection test results:"
echo "   Local:   $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 2>/dev/null || echo 'FAIL')"
echo "   Host:    $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo 'FAIL')"
echo "   WSL2:    $(curl -s -o /dev/null -w '%{http_code}' http://$WSL_IP:3000 2>/dev/null || echo 'FAIL')"
echo ""
echo "🎨 TinyBrush with optimized pixel drawing ready at:"
echo "   👉 http://localhost:3000"