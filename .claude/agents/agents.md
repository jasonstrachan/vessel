# Vessel Core Agents

## Canvas Agent (`@canvas`)
**Handles**: All drawing, rendering, pixel operations
- Canvas/WebGL rendering
- Brush engine & drawing tools
- Pixel manipulation
- Layer compositing
- Drawing performance

## UI/State Agent (`@ui-state`)
**Handles**: Interface and state management
- React components & hooks
- Zustand store management
- Tool UI & interactions
- Keyboard shortcuts
- Responsive design & touch

## Features Agent (`@features`)
**Handles**: High-level features
- Animation & timeline
- Color systems & palettes
- File import/export
- Undo/redo
- Project management

## Agent Assignment

```typescript
// Simplified task mapping
const agentMap = {
  // Drawing & rendering
  'canvas': '@canvas',
  'drawing': '@canvas',
  'rendering': '@canvas',
  'brush': '@canvas',
  'tools': '@canvas',
  
  // UI & State
  'ui': '@ui-state',
  'state': '@ui-state',
  'components': '@ui-state',
  'interaction': '@ui-state',
  
  // Features
  'animation': '@features',
  'color': '@features',
  'export': '@features',
  'import': '@features',
  'undo': '@features',
  
  // Built-in Claude Code agents
  'performance': 'brush-perf',
  'testing': 'test-auto',
  'debugging': 'debugger',
  'review': 'codereview'
};
```

## Usage

```bash
# Direct invocation
@canvas optimize brush performance
@ui-state add toolbar component
@features implement GIF export

# TechLead delegation
@techlead add pressure sensitivity
# Assigns to @canvas for implementation
```
