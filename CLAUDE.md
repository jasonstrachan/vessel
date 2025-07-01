# Claude Development Notes for TinyBrush

## Project Overview
TinyBrush is a web-based drawing application built with Next.js, featuring animation capabilities, layer management, and brush tools.

## Server Management

### Development Server Commands
```bash
# Preferred method (most reliable):
npx next dev

# Alternative with custom port:
npx next dev --port 3001

# For container/network access:
npx next dev --hostname 0.0.0.0
```

### Common Server Issues & Solutions

#### Issue: Server shows "Ready" but connection refused
**Cause**: WSL2 networking binding issues, localhost vs 127.0.0.1 resolution problems
**Solution**: 
1. Use explicit hostname binding: `npx next dev --hostname 0.0.0.0`
2. Run in background: `nohup npx next dev --hostname 0.0.0.0 --port 3000 > server.log 2>&1 &`
3. Test with 127.0.0.1: `curl -I http://127.0.0.1:3000` (not localhost)
4. For persistent fix: Configure WSL2 mirrored networking in `~/.wslconfig`

#### Issue: Port conflicts
**Solution**: `pkill -f next && npx next dev`

#### Issue: Build errors blocking server
**Common fixes**:
- Replace `<a href="/">` with `<Link href="/">` in Next.js pages
- Add missing imports: `import Link from 'next/link'`
- Fix TypeScript/ESLint warnings that block compilation

### Testing Commands
```bash
# Always verify server is working (use 127.0.0.1 in WSL2):
curl -I http://127.0.0.1:3000

# Check listening ports:
ss -tulpn | grep :3000

# View running Next.js processes:
ps aux | grep next

# WSL2 Networking Fix:
echo -e "[wsl2]\nnetworkingMode=mirrored\nlocalhostForwarding=true" > ~/.wslconfig
# Copy to Windows: cp ~/.wslconfig /mnt/c/Users/$(whoami)/.wslconfig
```

## Architecture

### Key Components
- **Canvas**: P5.js-based drawing surface (`/src/components/canvas/`)
- **Toolbar**: Brush tools and settings (`/src/components/toolbar/`)
- **Timeline**: Frame and layer management (`/src/components/timeline/`)
- **Store**: Zustand state management (`/src/stores/useAppStore.ts`)

### Design System
- **Colors**: Dark theme with `#1a1a1a` background, `#2a2a2a` surfaces, `#60a5fa` accents
- **Layout**: Sidebar toolbar, main canvas, bottom timeline
- **Typography**: System fonts, consistent sizing

### File Structure
```
src/
├── app/
│   ├── page.tsx          # Main application
│   ├── layout.tsx        # Root layout
│   ├── globals.css       # Global styles
│   └── debug/page.tsx    # Debug console
├── components/
│   ├── canvas/           # Drawing canvas components
│   ├── toolbar/          # Tool and brush controls
│   ├── timeline/         # Animation timeline
│   └── ui/               # Shared UI components
├── hooks/                # Custom React hooks
├── stores/               # State management
├── types/                # TypeScript definitions
└── utils/                # Utility functions
```

## Development Workflow

### Before Making Changes
1. Ensure server is running: `npx next dev`
2. Test in browser: `http://localhost:3000`
3. Check for TypeScript errors: `npm run build`

### Design Implementation Process
1. Update global CSS for theme changes
2. Modify component styles to match design
3. Test functionality after visual changes
4. Commit changes with descriptive messages

### Common Tasks

#### Adding New Tools
1. Add tool type to `/src/types/index.ts`
2. Update toolbar with new tool button
3. Implement tool logic in canvas component
4. Add tool-specific settings if needed

#### Styling Updates
1. Use exact hex colors from design: `#1a1a1a`, `#2a2a2a`, `#60a5fa`
2. Maintain consistent spacing and typography
3. Test dark theme across all components

#### State Management
- Use Zustand store (`useAppStore`) for global state
- Keep component-specific state local when possible
- Update store actions for new features

## Environment Notes

### WSL2 Specific
- Use `npx next dev --hostname 0.0.0.0` for proper network binding
- Test connectivity with `curl -I http://127.0.0.1:3000` (not localhost)
- Configure mirrored networking in `~/.wslconfig` for persistent fix
- Run in background: `nohup npx next dev --hostname 0.0.0.0 --port 3000 > server.log 2>&1 &`

### Build Requirements
- Node.js with npm
- Next.js 15.3.4
- TypeScript support
- Tailwind CSS for styling

## Troubleshooting Quick Reference

```bash
# Server won't start (WSL2):
pkill -f next && nohup npx next dev --hostname 0.0.0.0 --port 3000 > server.log 2>&1 &

# Port issues:
pkill -f next && npx next dev --hostname 0.0.0.0 --port 3001

# Build errors:
npm run build  # See specific errors to fix

# Test server (WSL2):
curl -I http://127.0.0.1:3000

# Check server logs:
tail -f server.log
```

## Best Practices

1. **Always fix build errors before starting server**
2. **Use explicit hostname binding in WSL2** (`--hostname 0.0.0.0`)
3. **Test with 127.0.0.1 instead of localhost in WSL2**
4. **Follow dark theme design system consistently**
5. **Keep components focused and reusable**
6. **Use TypeScript for better development experience**

---

## Current Status

### Server Status ✅
- **Running**: http://127.0.0.1:3000 (WSL2 with 0.0.0.0 binding)
- **Build**: Successful (no errors)
- **Networking**: Fixed WSL2 localhost resolution issues
- **Background Process**: Running via nohup with server.log
- **Drawing**: Fully functional

### What Was Reverted
- All grid mode experimental code removed
- Build cache cleared (.next directory)
- DragNumber.tsx and other created files deleted
- No more grid mode console logs or hydration warnings

### Working Features
- Distance-based brush spacing system
- Pixel-perfect toggle functionality  
- Custom brush creation and selection
- Dotted brush patterns
- Layer management and animation timeline
- Dark theme UI with responsive design

---

## Development Best Practices

- Always post a link to the dev server after an update

**Last Updated**: 2025-07-01  
**Next.js Version**: 15.3.4  
**Environment**: WSL2 Ubuntu