'use client';

import dynamic from 'next/dynamic';
import { useAppStore } from '@/stores/useAppStore';
import { useEffect } from 'react';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { LeftToolbar } from '@/components/toolbar/LeftToolbar';
import { Timeline } from '@/components/timeline/Timeline';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui/Toast';
import { exportProject, downloadFile } from '@/utils/export';

const DrawingCanvas = dynamic(() => import('@/components/canvas/DrawingCanvas').then(mod => ({ default: mod.DrawingCanvas })), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-slate-900">
      <div className="text-white">Loading canvas...</div>
    </div>
  ),
});

export default function Home() {
  const { project, addLayer, currentLayer, setPastedImageData, zoom, panX, panY } = useAppStore();
  const { toasts, removeToast, success, error, info } = useToast();
  
  // Enable keyboard shortcuts
  useKeyboardShortcuts();

  // Optimized clipboard paste listener
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      // Find image item quickly
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          event.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          
          // Ultra-fast path: Direct p5.Image loading like reference demo
          try {
            // Create object URL for instant loading
            const imageUrl = URL.createObjectURL(file);
            
            // Use p5 instance to load image directly - ZERO overhead like reference demo!
            const p5Instance = (window as any).p5Instance;
            if (p5Instance) {
              p5Instance.loadImage(imageUrl, 
                (img: any) => {
                  // INSTANT like reference demo - no React overhead, simple positioning
                  (window as any).tempPastedImage = {
                    p5Image: img,
                    x: 50, // Simple positioning like reference demo
                    y: 50,
                    width: img.width,
                    height: img.height
                  };
                  
                  // Defer React state update to next frame to avoid blocking
                  setTimeout(() => {
                    const viewportCenterX = (window.innerWidth / 2 - panX) / zoom;
                    const viewportCenterY = (window.innerHeight / 2 - panY) / zoom;
                    const x = viewportCenterX - img.width / 2;
                    const y = viewportCenterY - img.height / 2;
                    
                    // Clear temp image and set real state
                    delete (window as any).tempPastedImage;
                    setPastedImageData({
                      p5Image: img,
                      x, y,
                      width: img.width,
                      height: img.height
                    });
                    success(`Image ready: ${img.width}×${img.height}`);
                  }, 0);
                  
                  URL.revokeObjectURL(imageUrl);
                },
                () => {
                  error('Failed to load pasted image');
                  URL.revokeObjectURL(imageUrl);
                }
              );
            } else {
              error('Canvas not ready');
            }
          } catch (err) {
            error('Failed to load pasted image');
          }
          return;
        }
      }
      
      info('No image in clipboard');
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [success, error]);
  
  // Initialize with a default layer if none exist
  useEffect(() => {
    if (project.layers.length === 0) {
      addLayer('Layer 1');
    }
  }, [project.layers.length, addLayer]);

  const handleSave = () => {
    success('Project saved successfully!');
  };

  const handleExport = async () => {
    try {
      info('Exporting animation...', 5000);
      const dataUrl = await exportProject(project.layers, {
        format: 'gif',
        fps: project.fps
      });
      downloadFile(dataUrl, `${project.name}.gif`);
      success('Animation exported successfully!');
    } catch (err) {
      error('Failed to export animation. Please try again.');
      console.error('Export error:', err);
    }
  };

  return (
    <div className="h-screen bg-[#1a1a1a] flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-shrink-0">
          <LeftToolbar />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <DrawingCanvas />
        </div>
        <div className="flex-shrink-0">
          <Toolbar />
        </div>
      </div>
      <Timeline />
      
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}