# Next.js Cache Management

## Overview

This document covers cache management strategies for TinyBrush to prevent and resolve Next.js build cache corruption issues.

## Cache Types

### 1. Next.js Build Cache (`.next/`)
- **Location**: `.next/` directory
- **Purpose**: Stores compiled pages, static assets, and build artifacts
- **Issues**: Can become corrupted causing stale content or build failures

### 2. Node Modules Cache (`node_modules/.cache/`)
- **Location**: `node_modules/.cache/`
- **Purpose**: Webpack and other build tool caches
- **Issues**: Can cause compilation inconsistencies

### 3. NPM Cache
- **Location**: `~/.npm/_cacache/`
- **Purpose**: Package installation cache
- **Issues**: Can cause dependency resolution problems

## Available Commands

### Development
```bash
npm run dev:clean          # Clean cache before starting dev server
npm run dev:safe           # Comprehensive dev server startup with diagnostics
npm run cache:clear        # Clear all caches manually
npm run cache:status       # Show detailed cache status
```

### Production Builds
```bash
npm run build              # Standard build
npm run build:clean        # Build with no cache
npm run build:fresh        # Full cleanup + clean build
```

### Diagnostics
```bash
npm run cache:monitor      # Detailed cache health report
npm run dev:diagnose       # Network and process diagnostics
```

## Cache Corruption Prevention

### 1. Webpack Configuration
The `next.config.ts` includes:
- Disabled webpack caching in development (`config.cache = false`)
- Force SWC transforms for consistency
- Proper watch options for file polling

### 2. Enhanced Cleanup Scripts
The `scripts/cleanup.sh` script removes:
- `.next/` directory and subdirectories
- `node_modules/.cache/`
- NPM cache files
- Temporary Next.js and webpack files

### 3. Monitoring
The `scripts/cache-monitor.sh` script provides:
- Cache size and status reporting
- Process monitoring
- Port usage checking
- Health assessment with recommendations

## Troubleshooting

### Common Issues

1. **Stale Content**
   - **Symptom**: Changes not reflected in browser
   - **Solution**: `npm run cache:clear && npm run dev`

2. **Build Failures**
   - **Symptom**: "Cannot resolve module" or compilation errors
   - **Solution**: `npm run build:fresh`

3. **Multiple Dev Servers**
   - **Symptom**: Port conflicts or multiple processes
   - **Solution**: `npm run dev:safe`

4. **Dependency Issues**
   - **Symptom**: Module resolution errors
   - **Solution**: `rm -rf node_modules && npm install`

### Emergency Recovery

For severe cache corruption:
```bash
# Nuclear option - clean everything
npm run cache:clear
rm -rf node_modules
npm install
npm run build:fresh
```

## Best Practices

1. **Regular Cleanup**: Run `npm run cache:clear` weekly
2. **Monitor Health**: Use `npm run cache:status` to check cache health
3. **Clean Builds**: Use `npm run build:clean` for production deployments
4. **Process Management**: Always use `npm run dev:safe` for development

## Implementation Details

### Scripts Location
- `scripts/cleanup.sh` - Main cleanup script
- `scripts/cache-monitor.sh` - Monitoring and diagnostics
- `scripts/dev-start.sh` - Safe development startup

### Configuration
- `next.config.ts` - Webpack cache configuration
- `package.json` - Cache management scripts

This comprehensive approach ensures cache corruption is prevented and can be quickly resolved when it occurs.