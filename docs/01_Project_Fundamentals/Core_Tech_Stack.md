# Core Tech Stack

## Frontend Framework & Runtime

### Next.js 15.3.4
- **Purpose**: React framework providing SSR, routing, and build optimization
- **Key Features Used**:
  - App Router for modern routing architecture
  - Server-side rendering for initial page load
  - Automatic code splitting and optimization
  - Built-in TypeScript support
- **Configuration**: Uses app directory structure with dynamic imports for P5.js components

### React 18+
- **Purpose**: UI library for component-based interface
- **Key Features Used**:
  - Hooks for state management and side effects
  - Context API for theme and settings
  - Suspense for dynamic component loading
  - Concurrent rendering for smooth performance

## Canvas & Graphics

### P5.js 2.0.3
- **Purpose**: High-performance canvas rendering engine
- **Key Features Used**:
  - WebGL-accelerated rendering
  - Built-in drawing primitives and transformations
  - Framebuffer support for layer management
  - Image processing and manipulation
- **Integration**: Wrapped in React components with proper lifecycle management

### Canvas API (Native)
- **Purpose**: Low-level canvas operations and custom brush rendering
- **Usage**: Custom brush pattern generation, pixel manipulation, clipboard operations

## State Management

### Zustand 5.0.6
- **Purpose**: Lightweight state management for application state
- **Key Features Used**:
  - Immutable state updates
  - Computed values and derived state
  - Persistence for user preferences
  - DevTools integration for debugging
- **Store Structure**: Single store with sliced state management

## Styling & Design

### Tailwind CSS 4
- **Purpose**: Utility-first CSS framework for responsive design
- **Key Features Used**:
  - Custom color palette for dark theme
  - Responsive design utilities
  - Component-level styling
  - Custom CSS integration
- **Configuration**: Extended with custom colors, fonts, and animations

### CSS3 (Custom)
- **Purpose**: Custom styles for canvas interactions and animations
- **Key Features**:
  - Custom scrollbar styling
  - Smooth transitions and animations
  - Grid and flexbox layouts
  - Custom font integration (Meksans)

## Language & Type Safety

### TypeScript 5
- **Purpose**: Static type checking and enhanced developer experience
- **Key Features Used**:
  - Strict type checking
  - Interface definitions for all data structures
  - Generic types for reusable components
  - IDE integration for autocomplete and error detection
- **Configuration**: Strict mode enabled with comprehensive type coverage

## Build & Development Tools

### npm
- **Purpose**: Package management and script runner
- **Key Scripts**:
  - `npm run dev`: Development server with hot reload
  - `npm run build`: Production build with optimization
  - `npm run start`: Production server startup

### ESLint
- **Purpose**: Code linting and style enforcement
- **Configuration**: Extended with React, TypeScript, and Next.js rules

## Graphics & Export Libraries

### gif.js 0.2.0
- **Purpose**: Client-side GIF generation for animation export
- **Features**: 
  - Web worker-based processing
  - Configurable quality and optimization
  - Progress tracking for large animations

### Canvas2Image (Custom)
- **Purpose**: Canvas-to-image conversion for frame export
- **Features**: PNG/JPEG export with quality control

## Runtime Environment

### Node.js 18+
- **Purpose**: JavaScript runtime for development and build processes
- **Requirements**: Modern ES modules support, npm 8+

### Modern Web Browsers
- **Target Browsers**:
  - Chrome 90+
  - Firefox 88+ 
  - Safari 14+
  - Edge 90+
- **Required Features**:
  - WebGL 2.0 support
  - ES2020 JavaScript features
  - Canvas API with ImageData support
  - Web Workers for background processing

## Key Dependencies

### Production Dependencies
```json
{
  "next": "15.3.4",
  "react": "18+",
  "react-dom": "18+",
  "p5": "2.0.3",
  "zustand": "5.0.6",
  "gif.js": "0.2.0",
  "tailwindcss": "4.0.0"
}
```

### Development Dependencies
```json
{
  "typescript": "5.0.0",
  "eslint": "8.0.0",
  "eslint-config-next": "15.3.4",
  "@types/react": "18.0.0",
  "@types/p5": "1.0.0"
}
```

## Architecture Decisions

### Why P5.js over Raw Canvas?
- **Performance**: Hardware-accelerated WebGL rendering
- **Features**: Built-in support for complex graphics operations
- **Ecosystem**: Rich set of drawing utilities and effects
- **Maintenance**: Active development and community support

### Why Zustand over Redux?
- **Simplicity**: Minimal boilerplate and setup
- **Performance**: Optimized re-renders and subscription model
- **Bundle Size**: Significantly smaller than Redux toolkit
- **TypeScript**: Excellent TypeScript integration

### Why Next.js over Create React App?
- **Performance**: Built-in optimization and code splitting
- **SEO**: Server-side rendering capabilities
- **Routing**: Built-in routing with file-based structure
- **Deployment**: Optimized for modern deployment platforms

### Why Tailwind over CSS-in-JS?
- **Performance**: No runtime CSS generation
- **Consistency**: Utility-first approach ensures design consistency
- **Maintainability**: Easier to maintain and update styles
- **Bundle Size**: Purged CSS reduces final bundle size

## Environment Configuration

### Development Environment
- **Server**: Next.js development server with hot reload
- **Port**: 3000 (configurable)
- **Host**: 0.0.0.0 for WSL2 compatibility
- **Source Maps**: Enabled for debugging

### Production Environment
- **Build**: Optimized production build with code splitting
- **Deployment**: Static export or server-side rendering
- **CDN**: Optimized for CDN deployment
- **Performance**: Automatic performance optimizations

---

*This tech stack provides a robust foundation for TinyBrush's drawing and animation capabilities while maintaining excellent performance and developer experience.*