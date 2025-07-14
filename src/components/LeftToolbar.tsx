import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Tool } from '../types';

const LeftToolbar = () => {
  // Force refresh - toolbar black background fix
  const { tools: toolState, setCurrentTool, saveProject, loadProject } = useAppStore();
  
  const tools = [
    { id: 'new-document' as Tool, icon: null, label: 'New Document' },
    { id: 'selection' as Tool, icon: null, label: 'Selection' },
    { id: 'brush' as Tool, icon: null, label: 'Brush' },
    { id: 'custom' as Tool, icon: null, label: 'Custom Brush' },
    { id: 'eraser' as Tool, icon: null, label: 'Eraser' },
    { id: 'eyedropper' as Tool, icon: null, label: 'Eyedropper' },
    { id: 'fill' as Tool, icon: null, label: 'Fill' },
    { id: 'save' as Tool, icon: null, label: 'Save File' },
    { id: 'load' as Tool, icon: null, label: 'Load File' },
  ];

  const handleToolClick = async (toolId: Tool) => {
    if (toolId === 'save') {
      console.log('=== SAVE BUTTON CLICKED ===');
      try {
        // Debug current state before saving
        if (typeof window !== 'undefined' && (window as any).tinybrushDebug) {
          (window as any).tinybrushDebug.debugProjectState();
        }
        
        await saveProject();
        console.log('Save completed successfully');
      } catch (error) {
        console.error('Failed to save project:', error);
        alert(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (toolId === 'load') {
      console.log('=== LOAD BUTTON CLICKED ===');
      try {
        await loadProject();
        console.log('Load completed successfully');
        
        // Debug state after loading
        if (typeof window !== 'undefined' && (window as any).tinybrushDebug) {
          setTimeout(() => (window as any).tinybrushDebug.debugProjectState(), 100);
        }
      } catch (error) {
        console.error('Failed to load project:', error);
        alert(`Load failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      setCurrentTool(toolId);
    }
  };

  return (
    <div className="w-[48px] flex flex-col pt-4 pb-0" style={{ backgroundColor: '#31313A' }}>
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => handleToolClick(tool.id)}
          title={tool.label}
          className={`w-[48px] h-32 min-h-[64px] mx-auto flex items-center justify-center bg-transparent hover:bg-gray-600 border-0 appearance-none outline-none ${
            (tool.id === 'save' || tool.id === 'load') ? 'mb-0' : 'mb-8'
          }`}
          style={{ 
            color: toolState.currentTool === tool.id ? '#FFFFFF' : '#5A5A61', 
            fontSize: '2.8rem' 
          }}
        >
          {tool.id === 'new-document' ? (
            <svg width="18" height="19" viewBox="0 0 14 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0.5" y="0.458496" width="13" height="14" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'selection' ? (
            <svg width="24" height="22" viewBox="0 0 18 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="12.4488" y="1.31458" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
              <rect x="7.36399" y="1.31458" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
              <rect x="2.27879" y="1.31458" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
              <rect x="12.4488" y="6.13208" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
              <rect x="2.27879" y="6.13208" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
              <rect x="12.4488" y="10.9498" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
              <rect x="2.27879" y="10.9498" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
              <rect x="7.36379" y="10.9498" width="3.27243" height="3.27243" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'brush' ? (
            <svg width="26" height="30" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="12.1394" y="0.481323" width="2.18224" height="12.9123" transform="rotate(45 12.1394 0.481323)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="0.317513" y="10.4279" width="3.48284" height="3.48284" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'custom' ? (
            <svg width="24" height="24" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="6.28595" y="6.33766" width="5.39609" height="5.39609" fill="currentColor" fillOpacity="0.8"/>
              <rect x="4.03933" y="9.50257" width="5.39609" height="5.39609" transform="rotate(45 4.03933 9.50257)" fill="currentColor" fillOpacity="0.8"/>
              <circle cx="13.9172" cy="4.14477" r="3.11872" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'eraser' ? (
            <svg width="30" height="28" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="14.6015" y="2.02002" width="9.78835" height="11.6687" transform="rotate(45 14.6015 2.02002)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="5.36685" y="11.3152" width="9.78835" height="3.34723" transform="rotate(45 5.36685 11.3152)" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'fill' ? (
            <svg width="34" height="30" viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="11.8984" y="2.64685" width="9.78835" height="12.7943" transform="rotate(45 11.8984 2.64685)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="19.4903" y="10.097" width="2.34517" height="2.34517" transform="rotate(45 19.4903 10.097)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="19.4903" y="13.4137" width="2.34517" height="2.34517" transform="rotate(45 19.4903 13.4137)" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'save' ? (
            <svg width="32" height="28" viewBox="0 0 22 19" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M4.78316 2.14697H8.31316V6.43689H13.6911V2.14697H17.2168V6.43689V15.5786H13.6911H8.31316H4.78316V6.43689V2.14697Z" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'load' ? (
            <svg width="32" height="28" viewBox="0 0 22 19" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M4.78316 2.14697H8.31316V6.43689H13.6911V2.14697H17.2168V6.43689V15.5786H13.6911H8.31316H4.78316V6.43689V2.14697Z" fill="currentColor" fillOpacity="0.8"/>
              <path d="M11 8.5L8.5 11L11 13.5M11 11H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : tool.id === 'eyedropper' ? (
            <svg width="24" height="24" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="8.83139" y="6.39124" width="3.8025" height="8.94704" transform="rotate(45 8.83139 6.39124)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="14.6525" y="0.575439" width="3.8025" height="3.23298" transform="rotate(45 14.6525 0.575439)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="10.7193" y="2.28223" width="6.95118" height="3.42348" transform="rotate(45 10.7193 2.28223)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="0.433517" y="14.1926" width="3.48284" height="3.48284" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : (
            tool.icon
          )}
        </button>
      ))}
    </div>
  );
};

export default LeftToolbar;