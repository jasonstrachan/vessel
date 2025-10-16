/**
 * AssemblyScript module for high-performance index mapping
 * Compile with: npx asc src/wasm/indexMapper.ts -o src/wasm/indexMapper.wasm --optimize
 */

// @ts-expect-error: AssemblyScript decorators
export function applyPaletteToBuffer(
  indexPtr: usize,
  indexLength: i32,
  palettePtr: usize,
  paletteSize: i32,
  outputPtr: usize,
  offset: i32
): void {
  const shiftIndices = (offset * paletteSize) / 256;
  
  for (let i = 0; i < indexLength; i++) {
    const colorIndex = load<u8>(indexPtr + i);
    
    // Skip transparent pixels
    if (colorIndex == 0) {
      const pixelIdx = i * 4;
      store<u8>(outputPtr + pixelIdx, 0);
      store<u8>(outputPtr + pixelIdx + 1, 0);
      store<u8>(outputPtr + pixelIdx + 2, 0);
      store<u8>(outputPtr + pixelIdx + 3, 0);
      continue;
    }
    
    // Calculate shifted palette index
    const paletteIndex = ((colorIndex - 1 + shiftIndices) % paletteSize) * 4;
    const pixelIdx = i * 4;
    
    // Copy color from palette to output
    store<u8>(outputPtr + pixelIdx, load<u8>(palettePtr + paletteIndex));
    store<u8>(outputPtr + pixelIdx + 1, load<u8>(palettePtr + paletteIndex + 1));
    store<u8>(outputPtr + pixelIdx + 2, load<u8>(palettePtr + paletteIndex + 2));
    store<u8>(outputPtr + pixelIdx + 3, load<u8>(palettePtr + paletteIndex + 3));
  }
}

// @ts-expect-error: AssemblyScript decorators
export function shiftPalette(
  palettePtr: usize,
  paletteSize: i32,
  outputPtr: usize,
  offset: f32
): void {
  const normalizedOffset = ((offset % 1.0) + 1.0) % 1.0;
  const shiftIndices = i32(normalizedOffset * f32(paletteSize));
  
  for (let i = 0; i < paletteSize; i++) {
    const sourceIndex = (i + shiftIndices) % paletteSize;
    const sourceIdx = sourceIndex * 4;
    const targetIdx = i * 4;
    
    store<u8>(outputPtr + targetIdx, load<u8>(palettePtr + sourceIdx));
    store<u8>(outputPtr + targetIdx + 1, load<u8>(palettePtr + sourceIdx + 1));
    store<u8>(outputPtr + targetIdx + 2, load<u8>(palettePtr + sourceIdx + 2));
    store<u8>(outputPtr + targetIdx + 3, load<u8>(palettePtr + sourceIdx + 3));
  }
}

// @ts-expect-error: AssemblyScript decorators  
export function paintCircle(
  bufferPtr: usize,
  width: i32,
  height: i32,
  centerX: i32,
  centerY: i32,
  radius: i32,
  colorIndex: u8
): void {
  const radiusSq = radius * radius;
  const minX = max(0, centerX - radius);
  const maxX = min(width - 1, centerX + radius);
  const minY = max(0, centerY - radius);
  const maxY = min(height - 1, centerY + radius);
  
  for (let y = minY; y <= maxY; y++) {
    const dy = y - centerY;
    const dySq = dy * dy;
    
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX;
      const distSq = dx * dx + dySq;
      
      if (distSq <= radiusSq) {
        const idx = y * width + x;
        store<u8>(bufferPtr + idx, colorIndex);
      }
    }
  }
}

function max(a: i32, b: i32): i32 {
  return a > b ? a : b;
}

function min(a: i32, b: i32): i32 {
  return a < b ? a : b;
}