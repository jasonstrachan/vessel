import { buildLostEdgePolygon } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import { computeStrokeCapturePadding } from '@/hooks/canvas/utils/strokeCapturePadding';
import {
  AUTO_SAMPLE_MAX_STOPS,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computeAutoSampleStopsFromPolyline,
  computeDitherGradSampleStopsFromPolyline,
  computePolylineLength,
  dedupePolylineForSampling,
} from '@/hooks/canvas/utils/autoSampleGradient';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';

export const __TESTING__ = {
  computeStrokeCapturePadding,
  resolveActiveCustomBrushData,
  dedupePolylineForSampling,
  computePolylineLength,
  computeAutoSampleStopsFromPolyline,
  computeDitherGradSampleStopsFromPolyline,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  AUTO_SAMPLE_MAX_STOPS,
  buildLostEdgePolygon,
};
