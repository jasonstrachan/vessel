# Warp Rules for Vessel Project

## Project Overview
Vessel is a sophisticated web-based drawing application built with Next.js 15, React 19, TypeScript, and P5.js. It features advanced brush tools, layer management, animation capabilities, and pixel-perfect rendering.

## Development Workflow

### Starting Development
- Use 
pm run dev to start the custom development server (preferred)
- Alternative: 
pm run dev:raw for standard Next.js dev server
- For clean start: 
pm run dev:clean (removes .next cache first)
- Memory issues: 
pm run dev:memory or 
pm run dev:safe

### Code Quality & Testing
- Run 
pm run lint before committing changes
- Use 
pm run type-check to validate TypeScript
- Run 
pm test for Jest tests
- Test files are in 	ests/ and __tests__/ directories

### Build & Deployment
- Production build: 
pm run build
- GitHub Pages build: 
pm run build:github
- Start production server: 
pm start

### Maintenance Commands
- Clear caches: 
pm run cache:clear
- Full cleanup: 
pm run clean
- Auto-commit: 
pm run commit or 
pm run cc

## File Structure Guidelines

### Core Directories
- src/ - Main application source code
- public/ - Static assets and HTML files
- 	ests/ & __tests__/ - Test files
- docs/ - Project documentation
- scripts/ - Build and development scripts
- ssets/ - Project assets and resources

### Configuration Files
- 
ext.config.ts - Next.js configuration
- 	ailwind.config.ts - Tailwind CSS setup
- 	sconfig.json - TypeScript configuration
- jest.config.js - Jest testing setup
- eslint.config.mjs - ESLint rules

## Development Rules

### Code Standards
1. **TypeScript First**: All new code should be written in TypeScript
2. **Component Structure**: Use React functional components with hooks
3. **State Management**: Utilize Zustand for global state management
4. **Styling**: Use Tailwind CSS classes and HeroUI components
5. **Testing**: Write tests for critical drawing functions and UI components

### Canvas & Drawing Logic
- Drawing functionality should be in src/ with proper P5.js integration
- Brush tools should be modular and extensible
- Layer management should maintain performance with large canvases
- Animation features should be optimized for 60fps rendering

### Environment Variables
- Use .env.local for local development secrets
- .env.development for development-specific config
- Never commit sensitive API keys or credentials

## Git Workflow

### Commit Guidelines
- Use the auto-commit script: 
pm run cc
- Write descriptive commit messages
- Test before committing major changes
- Keep commits focused on single features/fixes

## Performance Considerations

### Canvas Optimization
- Monitor memory usage with large canvases
- Optimize brush rendering for real-time performance
- Use efficient algorithms for flood fill and selection tools
- Implement layer caching strategies

## Scripts & Automation

### Available Scripts
- ./start-vessel.sh - Project startup script
- ./stop-vessel.sh - Project shutdown script
- crop-image.js - Image processing utility
- emove_bg.py - Background removal tool

## Dependencies Management

### Key Dependencies
- **Next.js 15** - React framework
- **React 19** - UI library
- **TypeScript 5** - Type safety
- **Tailwind CSS 4** - Styling
- **HeroUI** - Component library
- **Zustand** - State management
- **Framer Motion** - Animations
- **Sharp** - Image processing
