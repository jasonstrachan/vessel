'use client';

import React from 'react';

interface GridOverlayProps {
  enabled: boolean;
  projectWidth: number;
  projectHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rows: number;
  columns: number;
}

const strokeOuter = 'rgba(0, 0, 0, 0.78)';
const strokeInner = 'rgba(255, 255, 255, 0.88)';

const GridOverlay: React.FC<GridOverlayProps> = ({
  enabled,
  projectWidth,
  projectHeight,
  zoom,
  offsetX,
  offsetY,
  rows,
  columns,
}) => {
  if (!enabled || projectWidth <= 0 || projectHeight <= 0) {
    return null;
  }

  const safeZoom = zoom || 1;
  const width = projectWidth * safeZoom;
  const height = projectHeight * safeZoom;
  const safeRows = Math.max(1, Math.round(rows));
  const safeColumns = Math.max(1, Math.round(columns));
  const cellWidth = width / safeColumns;
  const cellHeight = height / safeRows;
  const verticalLines = Array.from({ length: safeColumns - 1 }, (_, index) => cellWidth * (index + 1));
  const horizontalLines = Array.from({ length: safeRows - 1 }, (_, index) => cellHeight * (index + 1));

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 4 }}
      data-testid="grid-overlay-root"
      aria-hidden="true"
    >
      <svg
        data-testid="grid-overlay"
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width,
          height,
          overflow: 'visible',
        }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <rect x={0} y={0} width={width} height={height} fill="none" stroke={strokeOuter} strokeWidth={1.5} />
        <rect x={0} y={0} width={width} height={height} fill="none" stroke={strokeInner} strokeWidth={0.75} />

        {verticalLines.map((x) => (
          <React.Fragment key={`v-${x}`}>
            <line x1={x} y1={0} x2={x} y2={height} stroke={strokeOuter} strokeWidth={1.25} />
            <line x1={x} y1={0} x2={x} y2={height} stroke={strokeInner} strokeWidth={0.5} />
          </React.Fragment>
        ))}

        {horizontalLines.map((y) => (
          <React.Fragment key={`h-${y}`}>
            <line x1={0} y1={y} x2={width} y2={y} stroke={strokeOuter} strokeWidth={1.25} />
            <line x1={0} y1={y} x2={width} y2={y} stroke={strokeInner} strokeWidth={0.5} />
          </React.Fragment>
        ))}
      </svg>
    </div>
  );
};

export default React.memo(GridOverlay);
