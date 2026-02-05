/**
 * Rotation Module for Brush Engine
 * Handles all rotation calculations for stroke-based brushes
 */

/**
 * Rotation configuration for brushes
 */
export interface RotationConfig {
  enabled: boolean;
  mode: 'direction' | 'fixed' | 'random';
  fixedAngle?: number;        // For fixed mode (0-360 degrees, converted to radians)
  jitter?: number;             // Random variation (0-100%)
  smoothing?: number;          // Direction smoothing (0-1, higher = smoother)
  offset?: number;             // Angle offset from direction (degrees)
}

/**
 * Input for rotation calculation
 */
export interface RotationInput {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pressure?: number;
  velocity?: number;
  timestamp?: number;
}

/**
 * State for direction smoothing
 */
export interface DirectionState {
  history: number[];
  lastDirection: number;
  lastPosition: { x: number; y: number } | null;
}

/**
 * Create initial direction state
 */
export function createDirectionState(): DirectionState {
  return {
    history: [],
    lastDirection: 0,
    lastPosition: null
  };
}

/**
 * Convert degrees to radians
 */
function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate direction angle from stroke movement
 */
function calculateDirectionAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  state: DirectionState,
  smoothing: number = 0.5,
  velocity?: number
): number {
  const baseFrom = state.lastPosition ?? from;
  const deltaX = to.x - baseFrom.x;
  const deltaY = to.y - baseFrom.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  // Update last position for adaptive smoothing and coarse sampling
  state.lastPosition = { x: to.x, y: to.y };

  // Keep last direction for truly negligible movements
  const minDistance = 0.25;
  if (distance < minDistance && state.lastDirection !== 0) {
    return state.lastDirection;
  }

  // Calculate raw direction
  const direction = Math.atan2(deltaY, deltaX);

  // Adaptive smoothing: smoother when slow, more responsive when fast
  const speed = Number.isFinite(velocity) ? Math.max(velocity as number, distance) : distance;
  const slow = 0.5;
  const fast = 6;
  const speedFactor = Math.max(0, Math.min(1, (speed - slow) / (fast - slow)));
  const minSmoothing = 0.05;
  const effectiveSmoothing = Math.max(minSmoothing, Math.min(1, smoothing)) * (1 - speedFactor);
  const alpha = 1 - effectiveSmoothing;

  if (state.lastDirection !== 0) {
    const prevX = Math.cos(state.lastDirection);
    const prevY = Math.sin(state.lastDirection);
    const nextX = Math.cos(direction);
    const nextY = Math.sin(direction);

    const mixX = prevX * (1 - alpha) + nextX * alpha;
    const mixY = prevY * (1 - alpha) + nextY * alpha;

    const smoothed = Math.atan2(mixY, mixX);
    state.lastDirection = smoothed;
    return smoothed;
  }

  state.lastDirection = direction;
  return direction;
}

/**
 * Apply random jitter to rotation angle
 */
function applyJitter(baseAngle: number, jitterAmount: number): number {
  if (jitterAmount <= 0) return baseAngle;
  
  // Convert jitter percentage to radians (0-100% = 0-2PI)
  const maxJitter = (jitterAmount / 100) * Math.PI * 2;
  const jitter = (Math.random() - 0.5) * maxJitter;
  
  return baseAngle + jitter;
}

/**
 * Calculate rotation angle based on configuration
 */
export function calculateRotation(
  config: RotationConfig,
  input: RotationInput,
  state: DirectionState
): number {
  if (!config.enabled) {
    return 0;
  }
  
  let rotation = 0;
  
  switch (config.mode) {
    case 'direction': {
      // Calculate direction-based rotation
      const smoothing = config.smoothing ?? 0.5;
      rotation = calculateDirectionAngle(input.from, input.to, state, smoothing, input.velocity);
      
      // Apply offset if specified
      if (config.offset) {
        rotation += degreesToRadians(config.offset);
      }
      break;
    }
    
    case 'fixed': {
      // Use fixed angle
      rotation = degreesToRadians(config.fixedAngle ?? 0);
      break;
    }
    
    case 'random': {
      // Generate random angle
      rotation = Math.random() * Math.PI * 2;
      break;
    }
  }
  
  // Apply jitter if specified
  if (config.jitter && config.jitter > 0) {
    rotation = applyJitter(rotation, config.jitter);
  }
  
  return rotation;
}

/**
 * Check if a brush shape supports rotation
 */
export function isRotatableBrush(brushShape: string): boolean {
  const STROKE_BRUSHES = [
    'round',
    'square',
    'pixel_round',
    'custom',
    'resampler',
    'color_cycle',
    'risograph_soft',
    'risograph_ultra'
  ];
  
  return STROKE_BRUSHES.includes(brushShape.toLowerCase());
}

/**
 * Create default rotation config
 */
export function createDefaultRotationConfig(): RotationConfig {
  return {
    enabled: false,
    mode: 'direction',
    fixedAngle: 0,
    jitter: 0,
    smoothing: 0.5,
    offset: 0
  };
}
