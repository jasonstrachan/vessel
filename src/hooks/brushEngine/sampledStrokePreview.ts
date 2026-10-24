import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { alignSampledStampPositions, measureSampledInkCoverage } from '@/hooks/canvas/handlers/colorCycle/alignSampledStroke';
import {
  getActiveMarkGradientSession,
  resolveSampledStrokeInkPalettes,
  type MarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { IndexBuffer } from '@/lib/IndexBuffer';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { finalizeStampDither, type StampDitherConfig, type StampDitherRuntime } from './strokeStampDither';

export type SampledStrokePreviewDither = {
  config: StampDitherConfig;
  runtime: StampDitherRuntime;
  ditherStrength: number;
  cycleSpeed: number;
};

// Slot 255 is reserved for transient editor presentation, never committed paint.
const SECONDARY_PREVIEW_SLOT = 255;
type PreviewCache = {
  stops: MarkGradientSession['previewStopsStored'];
  contrast: number | undefined;
  inks: ReturnType<typeof resolveSampledStrokeInkPalettes>;
  version?: number;
  stamp?: number;
  buffer?: IndexBuffer;
  defIds?: Uint16Array;
};
const previews = new WeakMap<MarkGradientSession, PreviewCache>();

/** Render the final ink mapping on the derived surface only; authoring stays intact. */
export const createSampledStrokePreview = (
  layerId: string,
  animator: ColorCycleAnimator,
  stroke: LayerStrokeState | undefined,
  version?: number,
  getDither?: (stroke: LayerStrokeState) => SampledStrokePreviewDither,
): ((draw: () => void) => void) | undefined => {
  const session = getActiveMarkGradientSession(layerId);
  const ownership = stroke?.stampDither;
  const stops = session?.previewStopsStored;
  if (!session?.sampledPairedInks || !stops?.length || !stroke ||
      !ownership?.stampDitherTag || !ownership.stampDitherPrimaryBuffer) {
    return undefined;
  }
  const contrast = getAppStoreState().tools.brushSettings.ccGradientRangeContrast;
  let cached = previews.get(session);
  if (!cached || cached.stops !== stops || cached.contrast !== contrast) {
    cached = { ...cached, stops, contrast, inks: resolveSampledStrokeInkPalettes(session, stops, contrast) };
    previews.set(session, cached);
  }
  // Sampling/colour edits do not require rebuilding the pixel mapping. Reuse it
  // until authored pixels change, including dither recomposition and overlaps.
  if (!cached.buffer || version === undefined || cached.version !== version ||
      cached.stamp !== ownership.stampDitherStampSeq) {
    const source = stroke.buffers;
    cached.buffer ??= new IndexBuffer(animator.width, animator.height);
    const buffer = cached.buffer;
    buffer.getDirectData().set(source.paint);
    buffer.getDirectGradientIdData().set(source.gid);
    buffer.getDirectSpeedData().set(source.spd);
    buffer.getDirectFlowData().set(source.flow);
    buffer.getDirectPhaseData().set(source.phase);
    const previewDefs = source.def.slice();
    const dither = getDither?.(stroke);
    if (dither) {
      let previewFlowBits = ownership.stampDitherFlowBits;
      if (previewFlowBits === undefined) {
        for (let index = 0; index < source.paint.length; index++) {
          const tag = ownership.stampDitherTag[index];
          if (!source.paint[index] || source.gid[index] !== TEMP_SAMPLE_SLOT ||
              (tag >>> 16) !== ((ownership.stampDitherStrokeEpoch ?? 1) & 0xffff) ||
              !(tag & 0xffff) || !ownership.stampDitherPrimaryBuffer[index]) continue;
          if (previewFlowBits === undefined) previewFlowBits = source.flow[index];
          else if (previewFlowBits !== source.flow[index]) {
            previewFlowBits = undefined;
            break;
          }
        }
      }
      animator.withPreviewIndexBuffer(buffer, previewDefs, () => {
        finalizeStampDither({
          ...dither, animator, width: animator.width, height: animator.height, flowSlot: TEMP_SAMPLE_SLOT,
          state: {
            ...ownership,
            paint: buffer.getDirectData(), gradientIdBuffer: buffer.getDirectGradientIdData(),
            gradientDefIdBuffer: previewDefs, speedBuffer: buffer.getDirectSpeedData(),
            flowBuffer: buffer.getDirectFlowData(), phaseBuffer: buffer.getDirectPhaseData(),
            // Replay only reads intent; legacy paired Bristles stored it in canonical phase.
            stampDitherPhaseIntent: ownership.stampDitherPhaseIntent ??
              (session.sampledBristles && dither.config.bgFill ? source.phase : undefined),
            stampDitherFlowBits: previewFlowBits,
            // The finalizer's scratch state must not write through live handles or caches.
            stampDitherFillHandle: undefined, stampDitherChoice: undefined, stampSeqToTileScale: undefined,
          },
        });
      });
    }
    session.sampledPrimaryCoverage = measureSampledInkCoverage(
      buffer.getDirectData(), buffer.getDirectGradientIdData(), {
        tags: ownership.stampDitherTag, primary: ownership.stampDitherPrimaryBuffer,
        epoch: ownership.stampDitherStrokeEpoch ?? 1,
      },
    );
    cached.inks = resolveSampledStrokeInkPalettes(session, stops, contrast);
    // The live palette is bounded; project it onto source positions while drawing.
    // Release stores the full sequence in sections, retaining every physical band.
    const distances = ownership.stampSourceDistances;
    const bandPx = session.sampledAlignment?.bandPx;
    const total = distances?.at(-1) ?? 0;
    const previewSourceIndices = distances && bandPx && !session.sampledBristles
      ? Uint8Array.from(distances, distance => 1 + Math.round(total > 0
        ? Math.min(total, (Math.floor(distance / bandPx) + 0.5) * bandPx) / total * 254 : 0))
      : undefined;
    const aligned = alignSampledStampPositions({
      paintBuffer: buffer.getDirectData().buffer as ArrayBuffer,
      gradientIdBuffer: buffer.getDirectGradientIdData().buffer as ArrayBuffer,
      gradientDefIdBuffer: previewDefs.buffer,
      phaseBuffer: buffer.getDirectPhaseData().buffer as ArrayBuffer,
      speedBuffer: buffer.getDirectSpeedData().buffer as ArrayBuffer,
      flowBuffer: buffer.getDirectFlowData().buffer as ArrayBuffer,
    }, {
      tags: ownership.stampDitherTag,
      primary: ownership.stampDitherPrimaryBuffer,
      epoch: ownership.stampDitherStrokeEpoch ?? 1,
    }, { slot: SECONDARY_PREVIEW_SLOT, defId: 0 },
    session.sampledAlignment ? encodeColorCycleSpeedByte(session.sampledAlignment.speedCps) : undefined,
    session.sampledBristles, previewSourceIndices);
    cached.buffer.getDirectData().set(new Uint8Array(aligned.paintBuffer));
    cached.buffer.getDirectGradientIdData().set(new Uint8Array(aligned.gradientIdBuffer!));
    cached.buffer.getDirectSpeedData().set(new Uint8Array(aligned.speedBuffer!));
    cached.buffer.getDirectFlowData().set(new Uint8Array(aligned.flowBuffer!));
    cached.buffer.getDirectPhaseData().set(new Uint8Array(aligned.phaseBuffer!));
    cached.buffer.setHasNonZeroGradientIds(true);
    cached.buffer.setHasNonZeroSpeed(source.spd.some((speed) => speed !== 0) || Boolean(session.sampledAlignment));
    cached.buffer.markDirty();
    cached.defIds = new Uint16Array(aligned.gradientDefIdBuffer!);
    cached.version = version;
    cached.stamp = ownership.stampDitherStampSeq;
  }
  const { buffer, defIds, inks } = cached;
  return (draw) => animator.withPreviewIndexBuffer(buffer, defIds!, () => {
    animator.setGradientSlot(TEMP_SAMPLE_SLOT, inks.primary, session.seamProfile);
    animator.setGradientSlot(SECONDARY_PREVIEW_SLOT, inks.secondary, session.seamProfile);
    draw();
  });
};
