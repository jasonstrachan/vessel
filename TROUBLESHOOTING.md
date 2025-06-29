# TinyBrush Server Troubleshooting Guide

## Issue: Next.js Development Server Not Binding to Ports

### Problem Description
The Next.js development server would start and show "Ready" messages but fail to actually bind to ports, resulting in connection refused errors when trying to access the application.

### Symptoms
- Server logs showed successful startup: `✓ Ready in XXXms`
- Server claimed to be running on `http://localhost:3000`
- Browser showed `ERR_CONNECTION_REFUSED`
- `curl` tests failed with "Couldn't connect to server"
- `ss -tulpn` showed no process listening on the expected ports

### Root Cause
The issue was caused by:
1. **Turbopack conflicts** - Using `--turbopack` flag caused binding issues in WSL2/Docker environments
2. **Build errors** - ESLint errors in debug page prevented proper server initialization
3. **Port conflicts** - Previous server processes may have left ports in inconsistent state

### Solutions Applied

#### 1. Fix Build Errors First
```bash
# Check for compilation issues
npm run build

# Fix identified errors:
# - Replace <a> tags with <Link> components in Next.js pages
# - Add missing imports (Link from 'next/link')
```

**Fixed in `/src/app/debug/page.tsx`:**
```diff
+ import Link from 'next/link';

- <a href="/" className="...">
+ <Link href="/" className="...">
```

#### 2. Use Standard Next.js Without Turbopack
```bash
# Instead of:
npm run dev  # (which used --turbopack)

# Use:
npx next dev  # Standard Next.js development server
```

#### 3. Test Server Connectivity
```bash
# Always verify server is actually responding:
curl -I http://localhost:3000

# Should return HTTP/1.1 200 OK response
```

### Best Practices for Server Management

#### 1. Always Check Build Status
```bash
# Before starting dev server, ensure clean build
npm run build
# Fix any errors before proceeding
```

#### 2. Server Startup Checklist
```bash
# 1. Kill any existing processes
pkill -f next

# 2. Clear any port conflicts
lsof -ti:3000 | xargs kill -9

# 3. Start with standard Next.js (avoid turbopack in WSL2)
npx next dev

# 4. Test connectivity
curl -I http://localhost:3000
```

#### 3. Port Binding Options
```bash
# If localhost fails, try binding to all interfaces:
npx next dev --hostname 0.0.0.0

# Or use different port:
npx next dev --port 3001
```

#### 4. WSL2 Specific Considerations
- Prefer `npx next dev` over `npm run dev --turbopack`
- Use network IP (10.255.255.254) if localhost fails
- Consider port forwarding for Windows access

### Environment-Specific Notes

#### WSL2 Environment
- **Issue**: Turbopack may not bind properly to network interfaces
- **Solution**: Use standard Next.js without turbopack
- **Network Access**: Server binds to both localhost and WSL2 network IP

#### Docker/Container Environments
- Always use `--hostname 0.0.0.0` for container access
- Ensure port mapping is configured correctly
- Check firewall rules for port access

### Debugging Commands

```bash
# Check what's listening on ports
ss -tulpn | grep :3000

# Test server response
curl -I http://localhost:3000

# Check Next.js processes
ps aux | grep next

# View server logs with timeout
timeout 10s npm run dev

# Kill stuck processes
pkill -f next
```

### Prevention

1. **Always fix build errors** before starting development server
2. **Use standard Next.js** in development environments with potential binding issues
3. **Test connectivity** after every server start
4. **Document environment-specific quirks** for team members

### Quick Fix Command Sequence

```bash
# Emergency server restart sequence:
pkill -f next
npm run build  # Fix any errors first
npx next dev   # Use standard Next.js
curl -I http://localhost:3000  # Verify it works
```

---

**Last Updated**: 2025-06-29  
**Environment**: WSL2 Ubuntu, Next.js 15.3.4  
**Resolution**: Use standard Next.js without turbopack, fix build errors first