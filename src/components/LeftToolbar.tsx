import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Tool } from '../types';

const LeftToolbar = () => {
  // Force refresh - toolbar black background fix
  const { tools: toolState, setCurrentTool } = useAppStore();
  
  const tools = [
    { id: 'new-document' as Tool, icon: null, label: 'New Document' },
    { id: 'selection' as Tool, icon: null, label: 'Selection' },
    { id: 'brush' as Tool, icon: null, label: 'Brush' },
    { id: 'custom-brush' as Tool, icon: null, label: 'Custom Brush' },
    { id: 'eraser' as Tool, icon: null, label: 'Eraser' },
    { id: 'eyedropper' as Tool, icon: null, label: 'Eyedropper' },
    { id: 'fill' as Tool, icon: null, label: 'Fill' },
    { id: 'save' as Tool, icon: null, label: 'Save File' },
  ];

  return (
    <div className="w-[48px] flex flex-col pt-4 pb-0" style={{ backgroundColor: '#31313A' }}>
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setCurrentTool(tool.id)}
          title={tool.label}
          className={`w-[48px] h-32 min-h-[64px] mx-auto flex items-center justify-center bg-transparent hover:bg-gray-600 border-0 appearance-none outline-none ${
            tool.id === 'save' ? 'mb-0' : 'mb-8'
          }`}
          style={{ 
            color: toolState.currentTool === tool.id ? '#FFFFFF' : '#5A5A61', 
            fontSize: '2.8rem' 
          }}
        >
          {tool.id === 'new-document' ? (
            <svg width="14" height="15" viewBox="0 0 14 15" fill="none" xmlns="http://www.w3.org/2000/svg">
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
            <svg width="22" height="26" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="12.1394" y="0.481323" width="2.18224" height="12.9123" transform="rotate(45 12.1394 0.481323)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="0.317513" y="10.4279" width="3.48284" height="3.48284" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'custom-brush' ? (
            <svg width="24" height="26" viewBox="0 0 18 19" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="6.28595" y="6.87439" width="5.39609" height="5.39609" fill="currentColor" fillOpacity="0.8"/>
              <rect x="4.03934" y="10.0393" width="5.39609" height="5.39609" transform="rotate(45 4.03934 10.0393)" fill="currentColor" fillOpacity="0.8"/>
              <circle cx="13.9172" cy="4.68146" r="3.11872" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'eraser' ? (
            <svg width="30" height="28" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="14.6015" y="2.02002" width="9.78835" height="11.6687" transform="rotate(45 14.6015 2.02002)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="5.36685" y="11.3152" width="9.78835" height="3.34723" transform="rotate(45 5.36685 11.3152)" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'fill' ? (
            <svg width="30" height="26" viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="11.8984" y="2.64685" width="9.78835" height="12.7943" transform="rotate(45 11.8984 2.64685)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="19.4903" y="10.097" width="2.34517" height="2.34517" transform="rotate(45 19.4903 10.097)" fill="currentColor" fillOpacity="0.8"/>
              <rect x="19.4903" y="13.4137" width="2.34517" height="2.34517" transform="rotate(45 19.4903 13.4137)" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'save' ? (
            <svg width="28" height="24" viewBox="0 0 22 19" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M4.78316 2.14697H8.31316V6.43689H13.6911V2.14697H17.2168V6.43689V15.5786H13.6911H8.31316H4.78316V6.43689V2.14697Z" fill="currentColor" fillOpacity="0.8"/>
            </svg>
          ) : tool.id === 'eyedropper' ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
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