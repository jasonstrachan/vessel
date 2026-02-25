# Vessel

Web-based drawing application for high-quality digital artwork with pixel-perfect and antialiased drawing capabilities.

## Development Workflow

### 1. Research → Plan → Implement
**ALWAYS follow this sequence:**
1. Research the codebase and /docs
2. Create todo list for the task  
3. Implement with simplicity as the goal
4. Update /docs/project.md for significant features

### Core Principles
- **SIMPLICITY FIRST**: Every change should impact minimal code
- **NO LAZY FIXES**: Find and fix root causes
- **DELETE OLD CODE**: No versioned functions or compatibility layers
- **COMPLETE WORK**: All tests pass, linters clean, feature works end-to-end

## React/TypeScript Standards

### Code Quality
- Run `npm run lint` and `npm run type-check` before completing tasks
- Fix ALL hook failures immediately - they are BLOCKING
- Use existing patterns and components from the codebase
- Meaningful variable names and early returns

### Project Structure
```
src/
  components/   # React components
  hooks/        # Custom React hooks  
  stores/       # Zustand state management
  types/        # TypeScript types
  lib/          # Utilities and helpers
docs/           # Project documentation
```

## Development Server
- Normal: `npm run dev` (don't restart if already running)
- Clean start: `npm run dev:clean`
- Nuclear option: `npm run clean && npm run dev`

## Canvas & Drawing Features
- Always use GPU for performance-critical operations
- Respect existing brush engine architecture in `useBrushEngine.ts`
- Canvas interactions handled via `useCanvasInteraction.ts`
- State management through Zustand in `useAppStore.ts`

## TechLead Agent System

When you need to break down complex work, use "@techlead":

```
@techlead implement [feature description]
```

This will:
1. Decompose the task into subtasks
2. Create a todo list
3. Spawn specialized agents for each part
4. Execute tasks in parallel where possible
5. Validate all work

Example:
```
@techlead add undo/redo functionality with keyboard shortcuts
```

The techlead agent will break this down and invoke appropriate subagents (ui, test-auto, etc.) to complete the work efficiently.

## Problem Solving
When stuck:
1. Stop and simplify
2. Use @techlead for complex multi-part tasks
3. Spawn agents for parallel research when needed
4. Ask: "I see two approaches: [A] vs [B]. Which do you prefer?"

## Tone
Terse. Direct. Results-focused. Minimal patience for complexity.