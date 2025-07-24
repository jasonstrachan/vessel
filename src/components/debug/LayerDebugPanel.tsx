'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

const LayerDebugPanel = () => {
  const { 
    layers, 
    activeLayerId, 
    layersNeedRecomposition,
    project 
  } = useAppStore();

  if (process.env.NODE_ENV !== 'development') {
    return null; // Only show in development
  }

  const activeLayer = layers.find(l => l.id === activeLayerId);

  return (
    <div 
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '4px',
        fontSize: '12px',
        zIndex: 9999,
        fontFamily: 'monospace',
        maxWidth: '300px'
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
        🐛 Layer Debug Panel
      </div>
      
      <div>Project: {project?.name || 'None'}</div>
      <div>Layer Count: {layers.length}</div>
      <div>Active Layer: {activeLayer?.name || 'None'} ({activeLayerId})</div>
      <div>Recomposition Needed: {layersNeedRecomposition ? '🔄 YES' : '✅ NO'}</div>
      
      <div style={{ marginTop: '10px', fontSize: '11px' }}>
        <div style={{ fontWeight: 'bold' }}>Layers:</div>
        {layers.map((layer, index) => (
          <div 
            key={layer.id}
            style={{ 
              marginLeft: '10px',
              color: layer.id === activeLayerId ? '#4CAF50' : '#ccc',
              opacity: layer.visible ? 1 : 0.5
            }}
          >
            {index}: {layer.name} 
            {layer.visible ? '👁️' : '🚫'} 
            {layer.imageData ? '🖼️' : '📄'}
            {layer.id === activeLayerId ? ' ⭐' : ''}
          </div>
        ))}
      </div>
    </div>
  );
};

export default LayerDebugPanel;