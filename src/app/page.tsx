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

  // Simple clipboard paste listener
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      console.log('🎯 PASTE EVENT DETECTED');
      const items = event.clipboardData?.items;
      if (!items) {
        console.log('❌ No clipboard items found');
        return;
      }

      console.log('📋 Clipboard items:', items.length);
      let foundImage = false;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`📄 Item ${i}: type="${item.type}", kind="${item.kind}"`);
        
        if (item.type.indexOf('image') !== -1) {
          foundImage = true;
          console.log('🖼️ Found image item!');
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            console.log('📁 Got file:', file.name, file.type, file.size);
            const img = new Image();
            img.onload = () => {
              console.log('✅ Image loaded:', img.width, 'x', img.height);
              // Create a canvas to draw the image
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                
                // Simple immediate paste - draw directly on current layer
                const x = 50;
                const y = 50;
                
                // Store image data for canvas to immediately draw
                (window as any).pastedImageToCommit = {
                  imageData,
                  x,
                  y,
                  width: img.width,
                  height: img.height
                };
                
                console.log(`🎨 Immediately pasting image at ${x}, ${y}`);
                
                success(`✅ Pasted image: ${img.width}x${img.height}`);
                console.log('🎨 Image data:', imageData);
              }
            };
            img.onerror = (err) => {
              console.error('❌ Image load error:', err);
              error('Failed to load pasted image');
            };
            img.src = URL.createObjectURL(file);
          } else {
            console.log('❌ No file from clipboard item');
          }
        }
      }
      
      if (!foundImage) {
        console.log('❌ No image found in clipboard. Try copying an actual image!');
        info('No image in clipboard. Copy an image and try again.');
      }
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