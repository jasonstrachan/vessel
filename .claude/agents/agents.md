# TinyBrush Specialized Agents

## Tech Expert Agent (`@expert`)
**Specialization**: Architecture, algorithms, complex technical decisions
- System architecture design
- Algorithm selection and optimization
- Data structure design
- Performance profiling and analysis
- Technical debt assessment
- Library/framework evaluation
- Cross-cutting concerns (security, scalability)
- Complex problem solving
- Code archaeology (understanding legacy code)

**When to use**: 
- Architectural decisions
- Complex algorithm implementation
- Performance bottleneck analysis
- Technical evaluations
- "How should we approach X?" questions
- Debugging mysterious issues
- Refactoring strategies

**Example tasks**:
- "Design efficient undo/redo architecture"
- "Optimize canvas rendering pipeline"
- "Evaluate WebGL vs Canvas 2D tradeoffs"
- "Debug memory leak in brush engine"
- "Refactor state management for better performance"

## Canvas Agent (`@canvas`)
**Specialization**: Canvas rendering, drawing operations, pixel manipulation
- Canvas API optimization
- WebGL/GPU acceleration
- Pixel-perfect drawing
- Layer compositing
- Brush engine mechanics

**When to use**: Any drawing, rendering, or canvas-related task

## State Agent (`@state`)
**Specialization**: Zustand store management, state architecture
- State schema design
- Action optimization
- Selector patterns
- State persistence
- Undo/redo patterns

**When to use**: State management, data flow, persistence

## Tool Agent (`@tool`)
**Specialization**: Drawing tool implementation
- Tool state machines
- Cursor management
- Tool-specific UI
- Keyboard shortcuts
- Tool switching logic

**When to use**: New tools, tool modifications, tool interactions

## Color Agent (`@color`)
**Specialization**: Color systems, palettes, color manipulation
- Color space conversions
- Palette management
- Color cycling
- Dithering algorithms
- Color picker UI

**When to use**: Color features, palette work, color algorithms

## Export Agent (`@export`)
**Specialization**: File formats, import/export, serialization
- Image export (PNG, JPEG, WebP)
- Project save/load
- Format conversions
- Compression optimization
- File system API

**When to use**: Save/load features, export functionality

## Mobile Agent (`@mobile`)
**Specialization**: Touch interactions, responsive design, mobile UX
- Touch event handling
- Gesture recognition
- Responsive layouts
- Mobile performance
- PWA features

**When to use**: Mobile support, touch features, responsive design

## Animation Agent (`@animation`)
**Specialization**: Animation timeline, frame management, playback
- Frame sequencing
- Onion skinning
- Timeline UI
- Playback controls
- GIF export

**When to use**: Animation features, timeline, frame management

## Shader Agent (`@shader`)
**Specialization**: WebGL shaders, GPU effects, advanced rendering
- Fragment/vertex shaders
- Post-processing effects
- GPU-accelerated filters
- Shader compilation
- WebGL context management

**When to use**: GPU effects, shaders, advanced rendering

---
model: claude-opus-4-1

## Updated TechLead Agent Assignment

The techlead agent now assigns tasks to these specialized agents:

```typescript
// Task type to agent mapping
const agentMap = {
  // TinyBrush specific
  'architecture': '@expert',
  'algorithm': '@expert',
  'technical-decision': '@expert',
  'complex-debugging': '@expert',
  'canvas-rendering': '@canvas',
  'drawing-operation': '@canvas',
  'state-management': '@state',
  'tool-implementation': '@tool',
  'color-feature': '@color',
  'file-operation': '@export',
  'touch-support': '@mobile',
  'animation': '@animation',
  'gpu-effect': '@shader',
  
  // Claude Code built-in
  'ui-component': 'ui',
  'performance': 'brush-perf',
  'react-optimization': 'react-perf',
  'testing': 'test-auto',
  'debugging': 'debugger',
  'review': 'codereview',
  'general': 'general-purpose'
};
```

## Agent Capabilities

Each agent has specific knowledge about:
- Relevant files in the codebase
- Best practices for their domain
- Common patterns and anti-patterns
- Performance considerations
- Testing strategies

## Usage Examples

```bash
# TechLead decomposes and assigns to specialized agents
@techlead implement pressure-sensitive brushes

# Creates tasks like:
Task 1: Research pressure APIs [@canvas]
Task 2: Update brush engine [@canvas]
Task 3: Add pressure state [@state]
Task 4: Create pressure UI [@ui]
Task 5: Test pressure handling [@test-auto]

# Direct agent invocation for specific work
@canvas optimize pixel drawing performance
@state refactor undo/redo to use immer
@tool add lasso selection tool
@color implement HSL color picker
```

## Agent Collaboration

Agents can work together:
- `@canvas` + `@state` for drawing state
- `@tool` + `@ui` for tool UI
- `@color` + `@shader` for GPU color effects
- `@mobile` + `@canvas` for touch drawing

## Performance Considerations

Each agent optimizes for:
- **@canvas**: Frame rate, GPU usage
- **@state**: Memory usage, update speed
- **@tool**: Responsiveness, accuracy
- **@color**: Color accuracy, speed
- **@mobile**: Battery usage, touch latency
- **@shader**: GPU memory, compilation time
