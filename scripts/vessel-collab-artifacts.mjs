import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const decodePngDataUrl = (dataUrl) => {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Vessel returned an invalid PNG frame');
  return Buffer.from(match[1], 'base64');
};

const withIndexedFramePath = (framePath, suffix) => {
  const extension = path.extname(framePath) || '.png';
  const base = extension === framePath ? framePath : framePath.slice(0, -extension.length);
  return `${base}-${suffix}${extension}`;
};

export const materializeVesselCollaborationFrames = async (
  result,
  { session, framePath, frameDir },
) => {
  const defaultFramePath = path.join(os.tmpdir(), `vessel-collab-${session}-latest.png`);
  if (result.frame?.dataUrl) {
    const outputPath = path.resolve(String(framePath ?? defaultFramePath));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, decodePngDataUrl(result.frame.dataUrl));
    result.frame = { ...result.frame, dataUrl: undefined, path: outputPath };
  }
  if (Array.isArray(result.frames)) {
    const outputDirectory = path.resolve(String(frameDir ?? os.tmpdir()));
    await fs.mkdir(outputDirectory, { recursive: true });
    for (const captured of result.frames) {
      if (!captured.frame?.dataUrl) continue;
      const outputPath = framePath
        ? withIndexedFramePath(path.resolve(String(framePath)), `operation-${captured.operationIndex}`)
        : path.join(
            outputDirectory,
            `vessel-collab-${session}-revision-${captured.revision}-operation-${captured.operationIndex}.png`,
          );
      await fs.writeFile(outputPath, decodePngDataUrl(captured.frame.dataUrl));
      captured.frame = { ...captured.frame, dataUrl: undefined, path: outputPath };
    }
  }
  return result;
};

export const materializeVesselCollaborationEventFrame = async (
  event,
  { session, frameDir },
) => {
  if (!event.frame?.dataUrl) return event;
  const outputDirectory = path.resolve(String(frameDir ?? os.tmpdir()));
  await fs.mkdir(outputDirectory, { recursive: true });
  const suffix = Number.isInteger(event.operationIndex)
    ? `operation-${event.operationIndex}`
    : String(event.eventId ?? 'event').replace(/[^a-z0-9._-]/gi, '-');
  const outputPath = path.join(
    outputDirectory,
    `vessel-collab-${session}-${event.commandId}-${suffix}.png`,
  );
  await fs.writeFile(outputPath, decodePngDataUrl(event.frame.dataUrl));
  event.frame = { ...event.frame, dataUrl: undefined, path: outputPath };
  return event;
};

export const compactVesselCollaborationState = (state) => state ? {
  project: state.project,
  activeLayerId: state.activeLayerId,
  referenceLayerId: state.referenceLayerId,
  preferReferenceSampling: state.preferReferenceSampling,
  currentTool: state.currentTool,
  currentBrushPresetId: state.currentBrushPresetId,
  currentBrushCapabilities: state.currentBrushCapabilities,
  availableBrushPresets: state.availableBrushPresets,
  palette: state.palette,
  gradient: state.gradient,
  colorCycle: state.colorCycle,
  brush: state.brush,
  eraser: state.eraser,
  layers: state.layers,
} : undefined;

export const compactVesselCollaborationResult = (result, { resultPath } = {}) => ({
  type: 'completed',
  ok: result.ok,
  commandId: result.commandId,
  action: result.action,
  revision: result.revision,
  checkpointId: result.checkpointId,
  committedOperationIds: result.committedOperationIds,
  priorityCoverage: result.priorityCoverage,
  completedOperations: result.completedOperations,
  cancelled: result.cancelled,
  timedOut: result.timedOut,
  state: [
    'observe',
    'new-project',
    'open-project',
    'import-reference-image',
    'create-layer',
    'set-layer-visibility',
    'batch',
    'artwork-job',
  ].includes(result.action) ? compactVesselCollaborationState(result.state) : undefined,
  frame: result.frame ? {
    kind: result.frame.kind,
    width: result.frame.width,
    height: result.frame.height,
    path: result.frame.path,
  } : undefined,
  frames: Array.isArray(result.frames) ? result.frames.map((captured) => ({
    operationIndex: captured.operationIndex,
    revision: captured.revision,
    checkpointName: captured.checkpointName,
    checkpointId: captured.checkpointId,
    priorityCoverage: captured.priorityCoverage,
    kind: captured.frame.kind,
    width: captured.frame.width,
    height: captured.frame.height,
    path: captured.frame.path,
  })) : undefined,
  profile: result.profile ? {
    mutationMs: result.profile.mutationMs,
    presentationMs: result.profile.presentationMs,
    captureMs: result.profile.captureMs,
    totalMs: result.profile.totalMs,
  } : undefined,
  runtime: result.runtime,
  outcome: result.outcome,
  error: result.error,
  resultPath,
});

export const writeVesselCollaborationResultArtifact = async (
  result,
  { session, resultDir },
) => {
  if (!COMMAND_ID_PATTERN.test(String(result.commandId ?? ''))) {
    throw new Error('Vessel returned an invalid command ID');
  }
  const outputDirectory = path.resolve(String(
    resultDir ?? path.join(os.tmpdir(), `vessel-collab-${session}-results`),
  ));
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${result.commandId}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return outputPath;
};
