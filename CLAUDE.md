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
**Cause**: Turbopack binding issues in WSL2, build errors preventing proper initialization  
**Solution**: 
1. Fix build errors first: `npm run build`
2. Use standard Next.js: `npx next dev` (avoid --turbopack)
3. Test: `curl -I http://localhost:3000`

#### Issue: Port conflicts
**Solution**: `pkill -f next && npx next dev`

#### Issue: Build errors blocking server
**Common fixes**:
- Replace `<a href="/">` with `<Link href="/">` in Next.js pages
- Add missing imports: `import Link from 'next/link'`
- Fix TypeScript/ESLint warnings that block compilation

### Testing Commands
```bash
# Always verify server is working:
curl -I http://localhost:3000

# Check listening ports:
ss -tulpn | grep :3000

# View running Next.js processes:
ps aux | grep next
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
- Use `npx next dev` instead of `npm run dev` for better compatibility
- Server accessible at both `localhost:3000` and WSL2 network IP
- Avoid turbopack flag in WSL2 environments

### Build Requirements
- Node.js with npm
- Next.js 15.3.4
- TypeScript support
- Tailwind CSS for styling

## Troubleshooting Quick Reference

```bash
# Server won't start:
npm run build && npx next dev

# Port issues:
pkill -f next && npx next dev --port 3001

# Build errors:
npm run build  # See specific errors to fix

# Test server:
curl -I http://localhost:3000
```

## Best Practices

1. **Always fix build errors before starting server**
2. **Use standard Next.js in development** (avoid turbopack)
3. **Test server connectivity after changes**
4. **Follow dark theme design system consistently**
5. **Keep components focused and reusable**
6. **Use TypeScript for better development experience**

---

**Last Updated**: 2025-06-29  
**Next.js Version**: 15.3.4  
**Environment**: WSL2 Ubuntu