/**
 * PerformanceIndicator - Real-time performance monitoring display
 */

import React, { useState, useEffect, useCallback } from 'react';
import { RecolorManager, RecolorPerformanceStats } from '../../../lib/colorCycle/RecolorManager';

export interface PerformanceIndicatorProps {
  recolorManager: RecolorManager | null;
  compact?: boolean;
  performanceStats?: RecolorPerformanceStats;
}

interface PerformanceData {
  fps: number;
  frameTime: number;
  memoryUsageMb: number;
  gradientQuality: number;
  activeLayers: number;
}

export const PerformanceIndicator: React.FC<PerformanceIndicatorProps> = ({
  recolorManager,
  compact = false
}) => {
  const [perfData, setPerfData] = useState<PerformanceData>({
    fps: 0,
    frameTime: 0,
    memoryUsageMb: 0,
    gradientQuality: 0,
    activeLayers: 0
  });
  
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Update performance data
  const updatePerformance = useCallback(() => {
    if (!recolorManager) return;
    
    try {
      const stats = recolorManager.getStats();
      const layers = recolorManager.getRecolorLayers();
      
      setPerfData({
        fps: Math.round(stats.fps || 0),
        frameTime: Math.round(stats.frameTime || 0),
        memoryUsageMb: Math.round((stats.memoryUsage || 0) / (1024 * 1024)),
        gradientQuality: Math.round(
          Math.min(1, Math.max(0, stats.lastExtraction?.gradientAnalysis.quality ?? 0)) * 100
        ),
        activeLayers: layers.length
      });
    } catch (error) {
      console.warn('Performance stats update failed:', error);
    }
  }, [recolorManager]);

  // Setup monitoring interval
  useEffect(() => {
    if (isMonitoring) {
      const interval = setInterval(updatePerformance, 1000);
      return () => clearInterval(interval);
    }
  }, [isMonitoring, updatePerformance]);

  // Start/stop monitoring when animation state changes
  useEffect(() => {
    if (!recolorManager) return;
    
    const checkAnimationState = () => {
      try {
        const isAnimating = recolorManager.isAnimating();
        if (isAnimating !== isMonitoring) {
          setIsMonitoring(isAnimating);
          if (isAnimating) {
            updatePerformance(); // Immediate update
          }
        }
      } catch (error) {
        console.warn('Animation state check failed:', error);
      }
    };

    // Check initially and set up interval
    checkAnimationState();
    const interval = setInterval(checkAnimationState, 500);
    
    return () => clearInterval(interval);
  }, [recolorManager, isMonitoring, updatePerformance]);

  // Get color for metrics
  const getMetricColor = (value: number, thresholds: [number, number]) => {
    if (value >= thresholds[1]) return 'text-green-400';
    if (value >= thresholds[0]) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getFPSColor = (fps: number) => getMetricColor(fps, [30, 60]);
  const getFrameTimeColor = (frameTime: number) => {
    if (frameTime <= 16) return 'text-green-400';
    if (frameTime <= 33) return 'text-yellow-400';
    return 'text-red-400';
  };
  const getQualityColor = (quality: number) => getMetricColor(quality, [60, 85]);
  const getMemoryColor = (usageMb: number) => {
    if (usageMb <= 32) return 'text-green-400';
    if (usageMb <= 64) return 'text-yellow-400';
    return 'text-red-400';
  };

  if (compact) {
    return (
      <div className="performance-indicator-compact">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>Performance</span>
          {isMonitoring ? (
            <div className="flex items-center gap-3">
              <span className={getFPSColor(perfData.fps)}>
                {perfData.fps} FPS
              </span>
              <span className={getQualityColor(perfData.gradientQuality)}>
                {perfData.gradientQuality}% Quality
              </span>
              {perfData.activeLayers > 0 && (
                <span className="text-blue-400">
                  {perfData.activeLayers} Layer{perfData.activeLayers !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          ) : (
            <span>Idle</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="performance-indicator">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-300">
          Performance
        </label>
        <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-green-400' : 'bg-gray-600'}`} />
      </div>

      {isMonitoring ? (
        <div className="space-y-2">
          {/* FPS & Frame Time */}
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Frame Rate</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${getFPSColor(perfData.fps)}`}>
                {perfData.fps} FPS
              </span>
              <span className={`text-xs ${getFrameTimeColor(perfData.frameTime)}`}>
                ({perfData.frameTime}ms)
              </span>
            </div>
          </div>

          {/* Gradient Quality */}
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Gradient</span>
            <span className={`text-xs font-medium ${getQualityColor(perfData.gradientQuality)}`}>
              {perfData.gradientQuality}% quality
            </span>
          </div>

          {/* Memory Usage */}
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Memory</span>
            <span className={`text-xs font-medium ${getMemoryColor(perfData.memoryUsageMb)}`}>
              {perfData.memoryUsageMb} MB
            </span>
          </div>

          {/* Active Layers */}
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Active</span>
            <span className="text-xs font-medium text-blue-400">
              {perfData.activeLayers} layer{perfData.activeLayers !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Performance Bar with visual feedback */}
          <div className="mt-3">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden relative">
              <div 
                className={`h-full transition-all duration-500 ${
                  perfData.fps >= 60 ? 'bg-green-400' :
                  perfData.fps >= 30 ? 'bg-yellow-400' : 'bg-red-400'
                } ${perfData.fps > 0 ? 'animate-pulse' : ''}`}
                style={{ 
                  width: `${Math.min(100, (perfData.fps / 60) * 100)}%`,
                  transition: 'width 0.5s ease-out'
                }}
              />
              {/* Performance target line */}
              <div 
                className="absolute top-0 h-full w-0.5 bg-white opacity-30"
                style={{ left: '50%' }}
                title="30 FPS target"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Performance</span>
              <span className={perfData.fps >= 30 ? 'text-green-400' : 'text-yellow-400'}>
                {perfData.fps >= 60 ? 'Excellent' : perfData.fps >= 30 ? 'Good' : 'Needs optimization'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-xs text-gray-500 py-4">
          Start animation to monitor performance
        </div>
      )}
    </div>
  );
};
