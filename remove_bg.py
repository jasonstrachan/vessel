#!/usr/bin/env python3
"""
Script to remove background from screenshot and make it transparent
"""

from PIL import Image
import numpy as np

def remove_background(input_path, output_path, threshold=30):
    """
    Remove dark background from image and make it transparent
    """
    # Open the image
    img = Image.open(input_path)
    
    # Convert to RGBA if not already
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # Convert to numpy array
    data = np.array(img)
    
    # Get the background color (sample from corners)
    # Sample multiple corner pixels to get average background color
    corners = [
        data[0, 0],      # top-left
        data[0, -1],     # top-right  
        data[-1, 0],     # bottom-left
        data[-1, -1]     # bottom-right
    ]
    
    # Calculate average background color (RGB only)
    bg_color = np.mean(corners, axis=0)[:3]
    print(f"Detected background color: {bg_color}")
    
    # Create mask for pixels similar to background
    # Calculate distance from background color
    diff = np.sqrt(np.sum((data[:, :, :3] - bg_color) ** 2, axis=2))
    
    # Make pixels with small difference transparent
    mask = diff < threshold
    data[mask, 3] = 0  # Set alpha to 0 (transparent)
    
    # Convert back to PIL Image
    result = Image.fromarray(data, 'RGBA')
    
    # Save the result
    result.save(output_path, 'PNG')
    print(f"Background removed and saved to: {output_path}")

if __name__ == "__main__":
    input_file = "/home/jason/projects/vessel/screenshots/image copy.png"
    output_file = "/home/jason/projects/vessel/screenshots/image copy - no bg.png"
    
    try:
        remove_background(input_file, output_file)
    except Exception as e:
        print(f"Error: {e}")