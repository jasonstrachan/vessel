'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type ToneCurvePoint = { x: number; y: number };

interface ToneCurveEditorProps {
  points: ToneCurvePoint[];
  onChange: (points: ToneCurvePoint[]) => void;
  width?: number;
  height?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const DEFAULT_POINTS: ToneCurvePoint[] = [
  { x: 0.25, y: 0.2 },
  { x: 0.5, y: 0.5 },
  { x: 0.75, y: 0.8 },
];

const ToneCurveEditor: React.FC<ToneCurveEditorProps> = ({
  points,
  onChange,
  width = 280,
  height = 180,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragTarget, setDragTarget] = useState<
    | { kind: 'start' }
    | { kind: 'end' }
    | { kind: 'point'; index: number }
    | null
  >(null);

  // Seed a few control points so the curve is editable even when no points are stored yet.
  useEffect(() => {
    if (points.length === 0) {
      onChange(DEFAULT_POINTS);
    }
  }, [points.length, onChange]);

  const EPS = 0.0001;

  const { startPoint, endPoint, middlePoints, allPoints } = useMemo(() => {
    const clamped = points
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
      .sort((a, b) => a.x - b.x);

    const startCandidate = clamped.find((p) => p.x <= EPS);
    const endCandidate = [...clamped].reverse().find((p) => p.x >= 1 - EPS);

    const start = startCandidate ? { x: 0, y: startCandidate.y } : { x: 0, y: 0 };
    const end = endCandidate ? { x: 1, y: endCandidate.y } : { x: 1, y: 1 };

    const middle = clamped.filter((p) => p.x > EPS && p.x < 1 - EPS);

    return {
      startPoint: start,
      endPoint: end,
      middlePoints: middle,
      allPoints: [start, ...middle, end],
    };
  }, [points]);

  const PADDING = 12;
  const innerWidth = Math.max(1, width - PADDING * 2);
  const innerHeight = Math.max(1, height - PADDING * 2);

  const toPx = useCallback(
    (p: ToneCurvePoint) => `${PADDING + p.x * innerWidth},${PADDING + (1 - p.y) * innerHeight}`,
    [innerWidth, innerHeight]
  );

  const pathD = useMemo(() => {
    return `M ${toPx(allPoints[0])} ` + allPoints.slice(1).map((p) => `L ${toPx(p)}`).join(' ');
  }, [allPoints, toPx]);

  const handlePointerDown = useCallback(
    (target: { kind: 'start' } | { kind: 'end' } | { kind: 'point'; index: number }) =>
      (e: React.PointerEvent) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        setDragTarget(target);
      },
    []
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragTarget || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * width;
    const ySvg = ((e.clientY - rect.top) / rect.height) * height;
    const xNorm = clamp01((xSvg - PADDING) / innerWidth);
    const yNorm = clamp01(1 - (ySvg - PADDING) / innerHeight);

    const nextMiddle = [...middlePoints];
    let nextStart = startPoint;
    let nextEnd = endPoint;

    if (dragTarget.kind === 'start') {
      nextStart = { x: 0, y: yNorm };
    } else if (dragTarget.kind === 'end') {
      nextEnd = { x: 1, y: yNorm };
    } else {
      const pointIndex = dragTarget.index;
      const prevX = pointIndex === 0 ? 0 : nextMiddle[pointIndex - 1].x + 0.01;
      const nextX = pointIndex === nextMiddle.length - 1 ? 1 : nextMiddle[pointIndex + 1].x - 0.01;
      nextMiddle[pointIndex] = {
        x: Math.min(nextX, Math.max(prevX, xNorm)),
        y: yNorm,
      };
    }

    const payload = [nextStart, ...nextMiddle, nextEnd];
    onChange(payload);
  }, [dragTarget, innerWidth, innerHeight, middlePoints, startPoint, endPoint, onChange, height, width]);

  const handlePointerUp = useCallback(() => setDragTarget(null), []);

  return (
    <div className="bg-[#0F0F0F] border border-[#2A2A2A] p-3 flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[#9C9C9C]">
        <span>Tone Curve</span>
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full bg-[#0A0A0A] touch-none select-none"
        style={{ overflow: 'visible' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <defs>
          <linearGradient id="tone-grid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f1f1f" />
            <stop offset="100%" stopColor="#0f0f0f" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={width} height={height} fill="url(#tone-grid)" />
        {[0.25, 0.5, 0.75].map((t) => {
          const x = PADDING + t * innerWidth;
          const y = PADDING + t * innerHeight;
          return (
            <g key={t}>
              <line x1={x} x2={x} y1={PADDING} y2={height - PADDING} stroke="#1F1F1F" strokeWidth={1} />
              <line x1={PADDING} x2={width - PADDING} y1={y} y2={y} stroke="#1F1F1F" strokeWidth={1} />
            </g>
          );
        })}
        <path d={pathD} fill="none" stroke="#6DD3FF" strokeWidth={2} />
        {allPoints.map((p, idx) => {
          const cx = PADDING + p.x * innerWidth;
          const cy = PADDING + (1 - p.y) * innerHeight;
          const isEndpoint = idx === 0 || idx === allPoints.length - 1;
          const target = isEndpoint
            ? idx === 0
              ? { kind: 'start' as const }
              : { kind: 'end' as const }
            : { kind: 'point' as const, index: idx - 1 };
          return (
            <circle
              key={`${idx}-${p.x}`}
              cx={cx}
              cy={cy}
              r={isEndpoint ? 6 : 6}
              fill={isEndpoint ? '#0EA5E9' : '#0EA5E9'}
              stroke="white"
              strokeWidth={isEndpoint ? 1.5 : 1.5}
              style={{ cursor: 'grab' }}
              onPointerDown={handlePointerDown(target)}
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-[#9C9C9C]">
        <span>Shadows</span>
        <span>Highlights</span>
      </div>
    </div>
  );
};

export default ToneCurveEditor;
