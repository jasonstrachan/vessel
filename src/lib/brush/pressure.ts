/**
 * Pressure handling and curve calculations
 * Extracted for better readability and testability
 */

export interface PressureCurve {
  type: 'linear' | 'exponential' | 'smooth' | 'hard';
  min: number;
  max: number;
}

/**
 * Apply pressure curve transformation
 */
export function applyPressureCurve(
  pressure: number,
  curve: PressureCurve = { type: 'linear', min: 0, max: 1 }
): number {
  // Clamp input pressure
  pressure = Math.max(0, Math.min(1, pressure));
  
  // Apply curve transformation
  let transformed: number;
  switch (curve.type) {
    case 'exponential':
      transformed = Math.pow(pressure, 2);
      break;
    case 'smooth':
      transformed = pressure * pressure * (3 - 2 * pressure);
      break;
    case 'hard':
      transformed = pressure > 0.5 ? 1 : pressure * 2;
      break;
    case 'linear':
    default:
      transformed = pressure;
  }
  
  // Scale to min/max range
  return curve.min + transformed * (curve.max - curve.min);
}

/**
 * Smooth pressure values over time
 */
export function smoothPressure(
  currentPressure: number,
  history: number[],
  maxHistory: number = 5
): number {
  // Add current to history
  history.push(currentPressure);
  
  // Maintain history size
  while (history.length > maxHistory) {
    history.shift();
  }
  
  // Weighted average (more recent = higher weight)
  const weights = [0.1, 0.15, 0.2, 0.25, 0.3];
  let weightedSum = 0;
  let weightSum = 0;
  
  for (let i = 0; i < history.length; i++) {
    const weight = weights[i] || weights[weights.length - 1];
    weightedSum += history[i] * weight;
    weightSum += weight;
  }
  
  return weightSum > 0 ? weightedSum / weightSum : currentPressure;
}

/**
 * Calculate brush size from pressure
 */
export function calculateBrushSize(
  baseSize: number,
  pressure: number,
  pressureSensitivity: number = 1.0,
  minSize?: number,
  maxSize?: number
): number {
  // Apply pressure sensitivity
  const scale = 1 - (1 - pressure) * pressureSensitivity;
  let size = baseSize * scale;
  
  // Apply bounds if specified
  if (minSize !== undefined) {
    size = Math.max(minSize, size);
  }
  if (maxSize !== undefined) {
    size = Math.min(maxSize, size);
  }
  
  return size;
}

/**
 * Calculate opacity from pressure
 */
export function calculateOpacityFromPressure(
  baseOpacity: number,
  pressure: number,
  pressureSensitivity: number = 0.5
): number {
  const scale = 1 - (1 - pressure) * pressureSensitivity;
  return Math.max(0, Math.min(1, baseOpacity * scale));
}

/**
 * Velocity-based pressure adjustment (for ink brushes)
 */
export function adjustPressureByVelocity(
  pressure: number,
  velocity: number,
  maxVelocity: number = 1000,
  influence: number = 0.3
): number {
  const normalizedVelocity = Math.min(1, velocity / maxVelocity);
  const velocityFactor = 1 - normalizedVelocity * influence;
  return pressure * velocityFactor;
}