'use client';

import dynamic from 'next/dynamic';
import { useAppStore } from '@/stores/useAppStore';
import { useEffect } from 'react';
import { Toolbar } from '@/components/toolbar/Toolbar';
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
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-slate-900 border-b border-slate-700/50 flex items-center justify-between px-6 shadow-lg">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-400 to-slate-600 rounded-lg flex items-center justify-center">
              <span className="text-slate-900 font-bold text-sm">TB</span>
            </div>
            <h1 className="text-slate-100 font-bold text-lg tracking-tight">TinyBrush</h1>
          </div>
          <div className="h-6 w-px bg-slate-600"></div>
          <span className="text-slate-400 text-sm font-medium">{project.name}</span>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleSave}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-lg"
            title="Save Project (Ctrl+S)"
          >
            Save
          </button>
          <button 
            onClick={handleExport}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-lg border border-slate-500"
            title="Export as GIF"
          >
            Export
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <Toolbar />
        <DrawingCanvas />
      </div>
      <Timeline />
      
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}