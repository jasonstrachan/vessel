'use client';

import { useAppStore } from '@/stores/useAppStore';

export const LayerPanel = () => {
  const { 
    project, 
    currentLayer, 
    setCurrentLayer, 
    addLayer, 
    removeLayer, 
    toggleLayerVisibility,
    renameLayer 
  } = useAppStore();

  const handleAddLayer = () => {
    const layerNumber = project.layers.length + 1;
    addLayer(`Layer ${layerNumber}`);
  };

  const handleRemoveLayer = (layerIndex: number) => {
    if (project.layers.length > 1) {
      removeLayer(layerIndex);
      // Adjust current layer if needed
      if (currentLayer >= project.layers.length - 1) {
        setCurrentLayer(Math.max(0, project.layers.length - 2));
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-slate-300 font-medium text-xs">Layers</h3>
        <button
          onClick={handleAddLayer}
          className="text-xs bg-slate-600 hover:bg-slate-500 text-white px-2 py-1 rounded"
          title="Add Layer"
        >
          +
        </button>
      </div>
      
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {project.layers.map((layer, index) => (
          <div
            key={layer.id}
            className={`flex items-center gap-2 p-2 rounded text-xs ${
              currentLayer === index 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {/* Visibility Toggle */}
            <button
              onClick={() => toggleLayerVisibility(index)}
              className="w-4 h-4 flex items-center justify-center"
              title={layer.visible ? 'Hide Layer' : 'Show Layer'}
            >
              {layer.visible ? '👁' : '🚫'}
            </button>
            
            {/* Layer Name */}
            <button
              onClick={() => setCurrentLayer(index)}
              className="flex-1 text-left truncate"
              title={layer.name}
            >
              {layer.name}
            </button>
            
            {/* Remove Button */}
            {project.layers.length > 1 && (
              <button
                onClick={() => handleRemoveLayer(index)}
                className="w-4 h-4 flex items-center justify-center text-red-400 hover:text-red-300"
                title="Remove Layer"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};