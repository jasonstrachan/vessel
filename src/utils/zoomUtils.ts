export function calculateZoomIncrement(currentZoom: number, direction: 'in' | 'out'): number {
  const baseRate = 0.2;
  const minIncrement = 0.01;
  const maxIncrement = 1.0;
  
  const increment = Math.max(minIncrement, Math.min(maxIncrement, currentZoom * baseRate));
  
  return direction === 'in' ? currentZoom + increment : currentZoom - increment;
}

export function calculateZoomSteps(currentZoom: number, direction: 'in' | 'out', steps: number = 1): number {
  let newZoom = currentZoom;
  
  for (let i = 0; i < steps; i++) {
    newZoom = calculateZoomIncrement(newZoom, direction);
  }
  
  return newZoom;
}