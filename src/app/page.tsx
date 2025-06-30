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
  const { project, addLayer } = useAppStore();
  const { toasts, removeToast, success, error, info } = useToast();
  
  // Enable keyboard shortcuts
  useKeyboardShortcuts();
  
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