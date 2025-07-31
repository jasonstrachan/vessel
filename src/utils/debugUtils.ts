// Debug utilities for tracking ImageData lifecycle

export function getSamplePixels(imageData: ImageData, count: number): Array<{ r: number, g: number, b: number, a: number, index: number }> {
  if (!imageData || !imageData.data || imageData.data.length === 0) {
    return [];
  }

  const pixels = [];
  const totalPixels = imageData.width * imageData.height;

  // Always get the first pixel
  pixels.push({
    r: imageData.data[0], 
    g: imageData.data[1], 
    b: imageData.data[2], 
    a: imageData.data[3], 
    index: 0
  });

  // Get a middle pixel
  if (totalPixels > 1) {
    const midIndex = Math.floor(totalPixels / 2) * 4;
    pixels.push({
      r: imageData.data[midIndex], 
      g: imageData.data[midIndex + 1], 
      b: imageData.data[midIndex + 2], 
      a: imageData.data[midIndex + 3], 
      index: midIndex / 4
    });
  }

  // Get the last pixel
  if (totalPixels > 2) {
    const lastIndex = (totalPixels - 1) * 4;
    pixels.push({
      r: imageData.data[lastIndex], 
      g: imageData.data[lastIndex + 1], 
      b: imageData.data[lastIndex + 2], 
      a: imageData.data[lastIndex + 3], 
      index: lastIndex / 4
    });
  }

  return pixels;
}