import React from 'react';

interface RulerOverlayProps {
  enabled: boolean;
  projectWidth: number;
  projectHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

const STRIP_SIZE = 20;
const MAX_TICKS = 4096;

const getSteps = (zoom: number) => {
  const target = Math.max(1, 48 / zoom);
  const power = 10 ** Math.floor(Math.log10(target));
  const major = [1, 2, 5, 10].map(value => value * power).find(value => value >= target) ?? target;
  const minor = [5, 2, 1]
    .map(divisor => major / divisor)
    .find(value => Number.isSafeInteger(value) && value >= 1 && value * zoom >= 8) ?? major;
  return { major, minor };
};

const getTicks = (dimension: number, extent: number, offset: number, zoom: number, step: number) => {
  const minimum = Math.max(0, (STRIP_SIZE - offset) / zoom);
  const maximum = Math.min(dimension, (extent - offset) / zoom);
  const first = Math.ceil(minimum / step);
  const last = Math.floor(maximum / step);
  const count = last - first + 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || count <= 0 || count > MAX_TICKS) {
    return [];
  }
  return Array.from({ length: count }, (_, index) => (first + index) * step);
};

export const RulerOverlay = ({
  enabled,
  projectWidth,
  projectHeight,
  viewportWidth,
  viewportHeight,
  zoom,
  offsetX,
  offsetY,
}: RulerOverlayProps) => {
  const id = React.useId().replace(/:/g, '');
  const dimensions = [projectWidth, projectHeight, viewportWidth, viewportHeight];
  if (!enabled || !dimensions.every(value => Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER)
    || !Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    return null;
  }
  const { major, minor } = getSteps(zoom);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 6 }}>
      {(['horizontal', 'vertical'] as const).map(axis => {
        const horizontal = axis === 'horizontal';
        const extent = horizontal ? viewportWidth : viewportHeight;
        const offset = horizontal ? offsetX : offsetY;
        const dimension = horizontal ? projectWidth : projectHeight;
        const ticks = getTicks(dimension, extent, offset, zoom, minor);
        const clip = `ruler-${axis}-${id}`;
        return (
          <svg
            key={axis}
            role="img"
            aria-label={horizontal ? 'Horizontal ruler' : 'Vertical ruler'}
            data-ruler-axis={axis}
            data-major-step={major}
            data-minor-step={minor}
            className="pointer-events-none absolute left-0 top-0 overflow-hidden bg-[#202020] text-[#b5b5b5]"
            width={horizontal ? viewportWidth : STRIP_SIZE}
            height={horizontal ? STRIP_SIZE : viewportHeight}
            viewBox={`0 0 ${horizontal ? viewportWidth : STRIP_SIZE} ${horizontal ? STRIP_SIZE : viewportHeight}`}
          >
            <defs>
              <clipPath id={clip}>
                <rect
                  x={horizontal ? STRIP_SIZE : 0}
                  y={horizontal ? 0 : STRIP_SIZE}
                  width={horizontal ? Math.max(0, extent - STRIP_SIZE) : STRIP_SIZE}
                  height={horizontal ? STRIP_SIZE : Math.max(0, extent - STRIP_SIZE)}
                />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clip})`}>
              {ticks.map(coordinate => {
                const screen = offset + coordinate * zoom;
                const isMajor = coordinate % major === 0;
                const textX = horizontal ? screen + 2 : 2;
                const textY = horizontal ? 9 : screen - 2;
                return (
                  <g key={coordinate}>
                    <line
                      data-coordinate={coordinate === 0 ? 0 : coordinate}
                      x1={horizontal ? screen : isMajor ? 10 : 15}
                      x2={horizontal ? screen : STRIP_SIZE}
                      y1={horizontal ? isMajor ? 10 : 15 : screen}
                      y2={horizontal ? STRIP_SIZE : screen}
                      stroke="currentColor"
                    />
                    {isMajor ? (
                      <text
                        x={textX}
                        y={textY}
                        fontSize={9}
                        fill="currentColor"
                        transform={horizontal ? undefined : `rotate(-90 ${textX} ${textY})`}
                      >
                        {coordinate === 0 ? 0 : coordinate}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        );
      })}
      <div data-ruler-corner className="pointer-events-none absolute left-0 top-0 bg-[#202020]" style={{ width: STRIP_SIZE, height: STRIP_SIZE }} />
    </div>
  );
};
