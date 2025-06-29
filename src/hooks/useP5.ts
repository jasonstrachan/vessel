import { useEffect, useRef } from 'react';
import p5 from 'p5';

interface UseP5Props {
  setup?: (p: p5) => void;
  draw?: (p: p5) => void;
  preload?: (p: p5) => void;
  mousePressed?: (p: p5) => void;
  mouseDragged?: (p: p5) => void;
  mouseReleased?: (p: p5) => void;
  keyPressed?: (p: p5) => void;
  keyReleased?: (p: p5) => void;
  windowResized?: (p: p5) => void;
  mouseWheel?: (p: p5, event: any) => void;
  width?: number;
  height?: number;
}

export const useP5 = ({
  setup,
  draw,
  preload,
  mousePressed,
  mouseDragged,
  mouseReleased,
  keyPressed,
  keyReleased,
  windowResized,
  mouseWheel,
  width = 800,
  height = 600,
}: UseP5Props) => {
  const sketchRef = useRef<p5 | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Prevent duplicate canvas creation by checking if one already exists
    if (sketchRef.current) {
      console.log('P5 instance already exists, skipping creation');
      return;
    }

    // Clear any existing canvases in container ONLY
    const existingCanvas = containerRef.current.querySelector('canvas');
    if (existingCanvas) {
      console.log('Removing existing canvas from container');
      existingCanvas.remove();
    }

    const sketch = (p: p5) => {
      if (preload) {
        p.preload = () => preload(p);
      }

      p.setup = () => {
        p.createCanvas(width, height);
        console.log('Canvas created');
        if (setup) setup(p);
      };

      p.draw = () => {
        if (draw) draw(p);
      };

      if (mousePressed) {
        p.mousePressed = () => mousePressed(p);
      }

      if (mouseDragged) {
        p.mouseDragged = () => mouseDragged(p);
      }

      if (mouseReleased) {
        p.mouseReleased = () => mouseReleased(p);
      }

      if (keyPressed) {
        p.keyPressed = () => keyPressed(p);
      }

      if (keyReleased) {
        p.keyReleased = () => keyReleased(p);
      }

      if (windowResized) {
        p.windowResized = () => windowResized(p);
      }

      if (mouseWheel) {
        p.mouseWheel = (event: any) => mouseWheel(p, event);
      }
    };

    console.log('Creating new p5 instance');
    sketchRef.current = new p5(sketch, containerRef.current);

    return () => {
      console.log('Cleaning up p5 instance');
      if (sketchRef.current) {
        sketchRef.current.remove();
        sketchRef.current = null;
      }
    };
  }, [width, height]); // Only recreate when canvas size changes

  // Update event handlers without recreating the canvas
  useEffect(() => {
    if (!sketchRef.current) return;

    const p = sketchRef.current;
    
    p.mousePressed = mousePressed ? () => mousePressed(p) : () => {};
    p.mouseDragged = mouseDragged ? () => mouseDragged(p) : () => {};
    p.mouseReleased = mouseReleased ? () => mouseReleased(p) : () => {};
    p.keyPressed = keyPressed ? () => keyPressed(p) : () => {};
    p.keyReleased = keyReleased ? () => keyReleased(p) : () => {};
    p.mouseWheel = mouseWheel ? (event: any) => mouseWheel(p, event) : () => {};
    p.draw = draw ? () => draw(p) : () => {};
  }, [mousePressed, mouseDragged, mouseReleased, keyPressed, keyReleased, mouseWheel, draw]);

  return { containerRef, p5Instance: sketchRef.current };
};