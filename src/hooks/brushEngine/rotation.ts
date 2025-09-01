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
  smoothing: number = 0.5
): number {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  
  // Detect input type based on distance
  const isStylusInput = distance < 2; // Stylus typically has smaller movements
  
  // Adaptive parameters
  const minDistance = isStylusInput ? 1.5 : 3;
  const historySize = Math.round(3 + smoothing * 7); // 3-10 based on smoothing
  
  // Keep last direction for very small movements
  if (distance < minDistance && state.lastDirection !== 0) {
    return state.lastDirection;
  }
  
  // Calculate raw direction
  const direction = Math.atan2(deltaY, deltaX);
  
  // Add to history
  state.history.push(direction);
  if (state.history.length > historySize) {
    state.history.shift();
  }
  
  // Apply smoothing if we have history
  if (state.history.length > 1 && smoothing > 0) {
    // Create adaptive weights based on smoothing parameter
    const weights: number[] = [];
    for (let i = 0; i < state.history.length; i++) {
      const weight = Math.pow(1 - smoothing * 0.8, state.history.length - 1 - i);
      weights.push(weight);
    }
    
    // Circular averaging for angle wraparound
    let sinSum = 0;
    let cosSum = 0;
    let weightSum = 0;
    
    for (let i = 0; i < state.history.length; i++) {
      const angle = state.history[i];
      const weight = weights[i];
      sinSum += Math.sin(angle) * weight;
      cosSum += Math.cos(angle) * weight;
      weightSum += weight;
    }
    
    if (weightSum > 0) {
      const smoothedDirection = Math.atan2(sinSum / weightSum, cosSum / weightSum);
      
      // Apply final smoothing with last direction
      if (state.lastDirection !== 0) {
        let angleDiff = smoothedDirection - state.lastDirection;
        
        // Normalize to [-PI, PI]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Clamp maximum rotation per frame
        const maxRotation = Math.PI / 12; // 15 degrees max
        const clampedDiff = Math.max(-maxRotation, Math.min(maxRotation, angleDiff));
        
        // Apply smoothing factor
        const finalDirection = state.lastDirection + clampedDiff * (1 - smoothing * 0.3);
        state.lastDirection = finalDirection;
        return finalDirection;
      }
      
      state.lastDirection = smoothedDirection;
      return smoothedDirection;
    }
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
      rotation = calculateDirectionAngle(input.from, input.to, state, smoothing);
      
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