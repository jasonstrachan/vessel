# Server Troubleshooting Guide

> Quick solutions for Next.js server issues in TinyBrush, ordered by frequency

## Quick Start - Try These First!

### 1. **ERR_CONNECTION_REFUSED** (Most Common)
```bash
# Quick fix - restart with proper binding
pkill -f "next dev"
npx next dev --hostname 0.0.0.0
```

### 2. **Port 3000 Already in Use**
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
npm run dev
```

### 3. **Build Cache Corruption (500 Errors)**
```bash
# Clear corrupted cache
rm -rf .next
npm run build
npm run dev
```

## Common Issues (Ordered by Frequency)

### 1. ERR_CONNECTION_REFUSED
**Frequency:** ~40% of issues  
**Symptoms:**
- Browser shows "This site can't be reached"
- Terminal shows server is "Ready" but can't connect
- `curl localhost:3000` fails

**Quick Fix:**
```bash
npx next dev --hostname 0.0.0.0
```

**Why it happens:** WSL2 doesn't always bind to localhost properly

---

### 2. Port Already in Use
**Frequency:** ~25% of issues  
**Symptoms:**
- Error: "Port 3000 is already in use"
- Server switches to port 3001, 3002, etc.

**Quick Fix:**
```bash
lsof -ti:3000 | xargs kill -9
npm run dev
```

**Why it happens:** Previous server didn't shut down cleanly

---

### 3. Build Cache Corruption
**Frequency:** ~20% of issues  
**Symptoms:**
- 500 Internal Server Error for all pages
- Error: "Invariant: missing bootstrap script"
- Console shows errors for main-app.js, layout.css

**Quick Fix:**
```bash
rm -rf .next
rm -rf node_modules/.cache
npm run build
npm run dev
```

**Why it happens:** Interrupted builds or branch switches

---

### 4. Server Running but Page Won't Load
**Frequency:** ~10% of issues  
**Symptoms:**
- Server says "Ready" and `curl` works
- Browser shows infinite loading or blank page
- No error messages

**Quick Fix:**
1. Clear browser cache (Ctrl+Shift+R)
2. Try incognito mode
3. Check browser console for JavaScript errors

**Why it happens:** Client-side JavaScript errors or browser cache

---

### 5. WSL2 Network Issues
**Frequency:** ~5% of issues  
**Symptoms:**
- Works on WSL2 IP but not localhost
- Intermittent disconnections
- Windows can't access WSL2 server

**Quick Fix:**
```bash
# Get WSL2 IP and use it directly
hostname -I
# Access via http://[WSL2-IP]:3000
```

**Why it happens:** WSL2 network bridge problems

## Universal Fix Script

Save this as `~/fix-server.sh` and run whenever you have issues:

```bash
#!/bin/bash
echo "Fixing TinyBrush Server..."

# 1. Kill existing servers
pkill -f "next dev" 2>/dev/null

# 2. Clear port
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# 3. Clear cache if needed
if [ -d ".next" ]; then
    echo "Clearing cache..."
    rm -rf .next
fi

# 4. Start server
echo "Starting server..."
npx next dev --hostname 0.0.0.0 &

# 5. Wait and test
sleep 5
if curl -s http://localhost:3000 > /dev/null; then
    echo "SUCCESS: Server running at http://localhost:3000"
else
    echo "ERROR: Server failed - try manual steps"
fi
```

Make executable: `chmod +x ~/fix-server.sh`

## Diagnostic Commands

```bash
# Check if server is running
ps aux | grep "next dev" | grep -v grep

# Check what's on port 3000
lsof -i :3000

# Test server connection
curl -I http://localhost:3000

# Check server logs
tail -f server.log  # if using background process
```

## Emergency Fixes

### Nuclear Option (Last Resort)
```bash
# WARNING: This is aggressive but effective
pkill -f "next dev"
rm -rf .next node_modules/.cache
npm ci
npm run build
npx next dev --hostname 0.0.0.0
```

### WSL2 Complete Reset
```powershell
# Windows PowerShell (Admin)
wsl --shutdown
# Wait 10 seconds
wsl
```

## Prevention Tips

### Add to package.json:
```json
{
  "scripts": {
    "dev": "next dev",
    "dev:fix": "rm -rf .next && next dev --hostname 0.0.0.0",
    "dev:clean": "pkill -f 'next dev' && rm -rf .next && next dev"
  }
}
```

### Add to ~/.bashrc:
```bash
# TinyBrush aliases
alias tb='cd ~/projects/tinybrush && npm run dev:fix'
alias tbfix='pkill -f "next dev" && cd ~/projects/tinybrush && rm -rf .next && npm run dev'
```

### WSL2 Network Fix (Windows 11 22H2+):
```bash
# One-time setup
echo '[wsl2]
networkingMode=mirrored
localhostForwarding=true' > ~/.wslconfig

cp ~/.wslconfig /mnt/c/Users/$(whoami)/.wslconfig
```

## Success Checklist

Your server is working when:
- Terminal shows `Ready in XXXms`
- `curl http://localhost:3000` returns `200 OK`
- Browser loads the application
- File changes trigger hot reload
- No errors in browser console

## Still Having Issues?

1. **Check browser console** (F12) for JavaScript errors
2. **Try incognito mode** to rule out extensions
3. **Run `npm run build`** to check for compilation errors
4. **Restart WSL2** if nothing else works: `wsl --shutdown`

## Important Warnings

- **NEVER** use `pkill -f node` - it kills VS Code!
- **ALWAYS** use `pkill -f "next dev"` instead
- **DON'T** manually edit files in `.next` directory
- **DO** clear cache after switching branches

---

**Environment:** WSL2 Ubuntu, Next.js 15.3.4  
**Last Updated:** 2025-07-05