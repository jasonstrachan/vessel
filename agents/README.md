# TinyBrush Specialized Agent System

This directory contains specialized agent definitions for automated issue triage and assignment in the TinyBrush project.

## How It Works

The GitHub Actions workflow `.github/workflows/issue-triage.yml` automatically analyzes new issues and assigns them to appropriate specialist agents based on:

1. **Content Analysis**: Keywords in issue title and description
2. **Technical Terms**: Mentions of specific functions, files, or technologies
3. **File References**: Mentions of specific source files
4. **Confidence Scoring**: Weighted matching algorithm determines best fit

## Specialized Agents

### 🎯 Canvas Rendering Specialist
- **Focus**: Coordinate systems, cursor alignment, drawing transformations
- **Triggers**: cursor, alignment, offset, coordinate, transform, zoom, pan
- **Files**: DrawingCanvas.tsx, BrushCursor.tsx
- **Label**: `agent:canvas_rendering`

### 🖌️ Brush Engine Specialist  
- **Focus**: Drawing algorithms, brush caching, stroke rendering
- **Triggers**: brush, drawing, stroke, pressure, pixel, antialiasing
- **Files**: useBrushEngine.ts, scaledBrushCache.ts, brushCache.ts
- **Label**: `agent:brush_engine`

### 📊 State Management Specialist
- **Focus**: Zustand store, persistence, settings management
- **Triggers**: settings, persist, save, load, state, sync, reset
- **Files**: useAppStore.ts, BrushLibrary.tsx
- **Label**: `agent:state_management`

### 🎨 UI Layout Specialist
- **Focus**: React components, CSS layout, component lifecycle
- **Triggers**: layout, component, ui, render, mount, visible
- **Files**: components/\*.tsx, CSS files
- **Label**: `agent:ui_layout`

### ⚡ Performance Specialist
- **Focus**: Memory management, cache optimization, rendering performance
- **Triggers**: performance, memory, slow, lag, cache, optimization
- **Files**: memoryCleanup.ts, performanceMonitor.ts
- **Label**: `agent:performance`

### 💾 File I/O Specialist
- **Focus**: Project serialization, import/export, backup systems
- **Triggers**: save, load, export, import, file, project, backup
- **Files**: projectIO.ts, autosave.ts, fileBackupService.ts
- **Label**: `agent:file_io`

### 🛠️ Development Environment Specialist
- **Focus**: Next.js configuration, build systems, development server
- **Triggers**: server, build, dev, compile, error, crash
- **Files**: next.config.ts, package.json
- **Label**: `agent:dev_environment`

## Confidence Levels

- **High Confidence** (>50%): Direct assignment, ready to work
- **Medium Confidence** (10-50%): Assignment with manual review flag
- **Low Confidence** (<10%): General debugging team assignment

## Labels Applied

- `agent:[category]` - Primary agent assignment
- `agent:[category]-secondary` - Secondary agent (if confidence >30%)
- `priority:high-confidence` - High confidence assignment (>50%)
- `priority:medium-confidence` - Medium confidence assignment (10-50%)
- `priority:low-confidence` - Low confidence, needs manual review
- `needs:manual-review` - Human verification recommended

## Manual Override

You can manually reassign issues by:
1. Removing existing `agent:*` labels
2. Adding the desired `agent:[category]` label
3. The system respects manual assignments

## Adding New Agents

To add a new specialist agent:

1. Create `agents/[agent-name]-specialist.md` with agent description
2. Update `.github/workflows/issue-triage.yml` with new category in `bugCategories`
3. Define keywords, bodyKeywords, and files for the new category
4. Test with sample issues

## Statistics

The system tracks assignment accuracy and can be improved based on:
- Manual reassignments (indicates misclassification)
- Issue resolution time by agent type
- Agent workload distribution
- Confidence score vs actual accuracy

## Debugging

To debug the assignment system:
1. Check GitHub Actions logs for the workflow run
2. Review confidence scores in the workflow output
3. Verify keyword matching logic
4. Test with sample issue content locally