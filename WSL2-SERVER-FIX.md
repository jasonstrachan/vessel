# WSL2 Server Connection Fix Guide

## IMMEDIATE SOLUTIONS (Try in Order)

### 1. **NUCLEAR WSL2 NETWORK RESET** ⚡
```bash
# Run in Windows PowerShell as Administrator
wsl --shutdown
# Wait 10 seconds
wsl
```

### 2. **FORCE CORRECT BINDING** 🎯
```bash
# Kill any existing servers
pkill -f next
# Start with explicit binding
npx next dev --hostname 0.0.0.0 --port 3000
```

### 3. **WINDOWS FIREWALL FIX** 🛡️
```powershell
# Run in PowerShell as Administrator
New-NetFirewallRule -DisplayName "WSL2-Dev" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### 4. **WSL2 PORT FORWARDING** 🔄
```powershell
# Get WSL2 IP first
wsl hostname -I
# Replace WSL_IP with the actual IP from above
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=WSL_IP
```

## ADVANCED SOLUTIONS

### 5. **PRODUCTION SERVER WORKAROUND** 🏭
```bash
# Build and run production server (more stable)
npm run build
npx next start --hostname 0.0.0.0 --port 3000
```

### 6. **DOCKER SOLUTION** 🐳
```bash
# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
EOF

# Build and run
docker build -t tinybrush .
docker run -p 3000:3000 tinybrush
```

## DIAGNOSTIC COMMANDS

### Check What's Actually Running
```bash
# See if anything is listening on port 3000
sudo ss -tulpn | grep :3000

# Test different connection methods
curl -I http://127.0.0.1:3000
curl -I http://localhost:3000  
curl -I http://$(hostname -I | awk '{print $1}'):3000
```

### Network Information
```bash
# Get WSL2 network details
hostname -I
ip addr show eth0
cat /etc/resolv.conf
```

## ONE-CLICK FIX SCRIPT

Create this script and run it whenever you have issues:

```bash
#!/bin/bash
# save as ~/fix-server.sh

echo "🔧 WSL2 Server Fix Script"

# Kill existing servers
echo "1. Killing existing servers..."
pkill -f next

# Get WSL2 IP
WSL_IP=$(hostname -I | awk '{print $1}')
echo "2. WSL2 IP: $WSL_IP"

# Start server with proper binding
echo "3. Starting server..."
npx next dev --hostname 0.0.0.0 --port 3000 &
sleep 3

# Test connection
echo "4. Testing connection..."
if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ SUCCESS: Server accessible at http://localhost:3000"
else
    echo "❌ FAILED: Trying port forwarding fix..."
    
    # Try port forwarding via PowerShell
    /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "
    try {
        netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 2>$null
        netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$WSL_IP
        Write-Host 'Port forwarding configured'
    } catch {
        Write-Host 'Port forwarding failed - try running as Administrator'
    }
    "
fi

echo "5. Server should be running at http://localhost:3000"
```

Make it executable:
```bash
chmod +x ~/fix-server.sh
```

## PERMANENT SOLUTION

Add this to your `~/.bashrc` or `~/.zshrc`:

```bash
# WSL2 Dev Server Alias
alias devserver='npx next dev --hostname 0.0.0.0 --port 3000'
alias fixserver='~/fix-server.sh'

# Auto-setup function
setup-dev() {
    echo "Setting up WSL2 development environment..."
    
    # Windows firewall rule
    /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "
    try {
        New-NetFirewallRule -DisplayName 'WSL2-Dev-Auto' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -ErrorAction SilentlyContinue
        Write-Host 'Firewall rule added'
    } catch {
        Write-Host 'Firewall rule already exists or failed'
    }
    "
    
    echo "✅ Setup complete. Use 'devserver' to start Next.js"
}
```

## WHY THIS HAPPENS

WSL2 networking issues occur because:

1. **Virtual Network**: WSL2 uses a virtual network adapter that Windows doesn't always route correctly
2. **Dynamic IPs**: WSL2 IP changes on every restart
3. **Port Forwarding**: Windows 10/11 doesn't automatically forward all ports
4. **Firewall**: Windows Defender blocks WSL2 traffic by default
5. **DNS Resolution**: `localhost` doesn't always resolve to WSL2 instance

## SUCCESS CHECKLIST

✅ Server shows "Ready" message  
✅ `curl http://localhost:3000` returns 200  
✅ Browser loads the application  
✅ Hot reload works when you save files  
✅ No "Connection Refused" errors  

## EMERGENCY BACKUP PLAN

If nothing works, use GitHub Codespaces:

1. Push your code to GitHub
2. Create a Codespace
3. Run `npm install && npm run dev`
4. Access via the forwarded port

This bypasses WSL2 networking entirely.

---

**TL;DR**: Run the one-click fix script above, or use `npx next dev --hostname 0.0.0.0 --port 3000` with Windows firewall rules.