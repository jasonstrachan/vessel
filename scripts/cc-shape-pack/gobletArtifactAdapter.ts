import JSZip from 'jszip';
import { deflateSync, inflateSync } from 'fflate';

import {
  CcShapePackingError,
  applyMergedColorCycleMetadata,
  assertCompatibleCcLayerPresentation,
  assertSelectedLayersAreContiguous,
  isCompleteCcPacking,
  consolidateCcLayerNamespaces,
  extractCcShapes,
  packCcShapes,
  mergeColorCycleMetadata,
  rewritePackedCcLayers,
  type CcPackingLayerInput,
  type CcQuarterTurn,
  type CcShapePackingResult,
  type CcShapeSeparationOverride,
} from '@/lib/colorCycle/shapePacking';
import { validateGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadValidation';
import {
  GOBLET_PROPERTY_MINIFY_MAP,
  GOBLET_PROPERTY_UNMINIFY_MAP,
} from '@/utils/export/goblet/gobletMetadataSchema';
import type {
  NumericExportBuffer,
  WebGLExportMetadata,
  WebGLLayerMetadata,
  WebGLSerializedAlphaMask,
  WebGLSerializedBrushState,
} from '@/utils/export/goblet/gobletTypes';
type SidecarRef = { ref: string; encoding: 'u8'; byteLength: number };
type ArtifactKind = 'json' | 'zip' | 'single-html';

export type GobletArtifactPackingOptions = Readonly<{
  selectors: readonly Readonly<{ id?: string; name?: string }>[];
  destinationLayerId?: string;
  splitByGradientDefId?: boolean;
  separationByLayerId?: Readonly<Record<string, CcShapeSeparationOverride>>;
  padding?: number;
  rotations?: readonly CcQuarterTurn[];
  beamWidth?: number;
  minimumSupportSpanRatio?: number;
  allowNonGravityNesting?: boolean;
  allowPartialPreview?: boolean;
  allowOverlap?: boolean;
}>;

export type GobletArtifactPackingResult = Readonly<{
  artifactData: Uint8Array;
  artifactKind: ArtifactKind;
  packing: CcShapePackingResult;
  canvasWidth: number;
  canvasHeight: number;
  selectedLayerIds: readonly string[];
  sourceShapeCount: number;
}>;

const isZip = (bytes: Uint8Array): boolean => bytes[0] === 0x50 && bytes[1] === 0x4b;
const isSidecarRef = (value: unknown): value is SidecarRef => Boolean(
  value && typeof value === 'object' &&
  typeof (value as SidecarRef).ref === 'string' &&
  (value as SidecarRef).encoding === 'u8',
);

const b64zDecode = (value: string): Uint8Array => {
  if (!value.startsWith('b64z:')) throw new CcShapePackingError('invalid-goblet-buffer', 'Expected a b64z payload.');
  return inflateSync(new Uint8Array(Buffer.from(value.slice('b64z:'.length), 'base64')));
};

const b64zEncode = (bytes: Uint8Array): string =>
  `b64z:${Buffer.from(deflateSync(bytes, { level: 9 })).toString('base64')}`;

const expandMinifiedProperties = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(expandMinifiedProperties);
  if (!value || typeof value !== 'object') return value;
  const expanded: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    expanded[GOBLET_PROPERTY_UNMINIFY_MAP[key] ?? key] = expandMinifiedProperties(nested);
  }
  return expanded;
};

const minifyProperties = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(minifyProperties);
  if (!value || typeof value !== 'object') return value;
  const minified: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    minified[GOBLET_PROPERTY_MINIFY_MAP[key as keyof typeof GOBLET_PROPERTY_MINIFY_MAP] ?? key] = minifyProperties(nested);
  }
  return minified;
};

const decodeInlineMetadata = (encoded: string): string => {
  let decoded = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    const rest = encoded.slice(index);
    if (rest.startsWith('\\u003C')) {
      decoded += '<';
      index += '\\u003C'.length - 1;
    } else if (rest.startsWith('\\u003E')) {
      decoded += '>';
      index += '\\u003E'.length - 1;
    } else {
      const next = encoded[index + 1];
      if (next === '\\' || next === '`' || next === '$') {
        decoded += next;
        index += 1;
      } else {
        decoded += character;
      }
    }
  }
  return decoded;
};

const encodeInlineMetadata = (metadataJson: string): string => metadataJson
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$/g, '\\$')
  .replace(/</g, '\\u003C')
  .replace(/>/g, '\\u003E');

const findInlineMetadataRange = (html: string): { start: number; end: number } => {
  const marker = 'const packagedMetadataRaw = JSON.parse(`';
  const start = html.indexOf(marker);
  if (start < 0) {
    throw new CcShapePackingError('missing-goblet-metadata', 'Self-contained Goblet HTML has no packaged metadata literal.');
  }
  const contentStart = start + marker.length;
  for (let index = contentStart; index < html.length; index += 1) {
    if (html[index] !== '`') continue;
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= contentStart && html[cursor] === '\\'; cursor -= 1) slashCount += 1;
    if (slashCount % 2 === 0) return { start: contentStart, end: index };
  }
  throw new CcShapePackingError('missing-goblet-metadata', 'Self-contained Goblet HTML metadata literal is unterminated.');
};

const replaceInlineMetadataIfPresent = (html: string, metadataJson: string): string => {
  const marker = 'const packagedMetadataRaw = JSON.parse(`';
  if (!html.includes(marker)) return html;
  const range = findInlineMetadataRange(html);
  return `${html.slice(0, range.start)}${encodeInlineMetadata(metadataJson)}${html.slice(range.end)}`;
};

const readPayloadBytes = async (
  value: unknown,
  zip: JSZip | null,
  field: string,
): Promise<Uint8Array> => {
  if (Array.isArray(value)) {
    return Uint8Array.from(value.map((entry) => Number(entry)));
  }
  if (typeof value === 'string') return b64zDecode(value);
  if (isSidecarRef(value)) {
    if (!zip) throw new CcShapePackingError('missing-goblet-sidecar', `${field} references a sidecar outside a ZIP artifact.`);
    const entry = zip.file(value.ref);
    if (!entry) throw new CcShapePackingError('missing-goblet-sidecar', `Goblet sidecar ${value.ref} is missing.`);
    const bytes = await entry.async('uint8array');
    if (bytes.byteLength !== value.byteLength) {
      throw new CcShapePackingError('goblet-sidecar-length', `Goblet sidecar ${value.ref} has the wrong length.`);
    }
    return bytes;
  }
  throw new CcShapePackingError('missing-goblet-buffer', `${field} is missing.`);
};

const readBytePayload = async (
  value: unknown,
  zip: JSZip | null,
  pixels: number,
  field: string,
): Promise<Uint8Array> => {
  const bytes = await readPayloadBytes(value, zip, field);
  if (bytes.length !== pixels) {
    throw new CcShapePackingError('goblet-buffer-length', `${field} does not match the Goblet brush dimensions.`, {
      field,
      expected: pixels,
      actual: bytes.length,
    });
  }
  return bytes;
};

const readDefPayload = async (
  value: unknown,
  zip: JSZip | null,
  pixels: number,
): Promise<Uint16Array> => {
  if (Array.isArray(value)) {
    if (value.length !== pixels) throw new CcShapePackingError('goblet-buffer-length', 'gradientDefIdBuffer length mismatch.');
    return Uint16Array.from(value.map((entry) => Number(entry)));
  }
  const bytes = await readPayloadBytes(value, zip, 'gradientDefIdBuffer');
  if (bytes.length === pixels) return Uint16Array.from(bytes);
  if (bytes.byteLength === pixels * 2) {
    const copy = bytes.slice();
    return new Uint16Array(copy.buffer, copy.byteOffset, pixels).slice();
  }
  throw new CcShapePackingError('goblet-buffer-length', 'gradientDefIdBuffer length mismatch.');
};

const selectLayers = (
  metadata: WebGLExportMetadata,
  selectors: GobletArtifactPackingOptions['selectors'],
): WebGLLayerMetadata[] => {
  if (selectors.length === 0) throw new CcShapePackingError('missing-layer-selectors', 'At least one selected CC layer is required.');
  const selected: WebGLLayerMetadata[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    let layer: WebGLLayerMetadata | undefined;
    if (selector.id) layer = metadata.layers.find((candidate) => candidate.id === selector.id);
    else if (selector.name) {
      const matches = metadata.layers.filter((candidate) => candidate.name === selector.name);
      if (matches.length > 1) throw new CcShapePackingError('ambiguous-layer-name', `Layer name "${selector.name}" is not unique; select it by ID.`);
      layer = matches[0];
    }
    if (!layer) throw new CcShapePackingError('missing-selected-layer', 'A selected Goblet layer was not found.', { selector });
    if (layer.type !== 'color-cycle' || layer.colorCycle?.mode !== 'brush' || !layer.colorCycle.brushState) {
      throw new CcShapePackingError('selected-layer-not-color-cycle-brush', `Layer "${layer.name}" is not an animated CC brush layer.`);
    }
    if (!seen.has(layer.id)) {
      seen.add(layer.id);
      selected.push(layer);
    }
  }
  return selected;
};

const copyIntoDocument = <T extends Uint8Array | Uint16Array>(
  source: T,
  sourceWidth: number,
  sourceHeight: number,
  documentWidth: number,
  documentHeight: number,
  originX: number,
  originY: number,
  output: T,
): void => {
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const destinationX = originX + x;
      const destinationY = originY + y;
      if (destinationX < 0 || destinationY < 0 || destinationX >= documentWidth || destinationY >= documentHeight) continue;
      output[destinationY * documentWidth + destinationX] = source[y * sourceWidth + x];
    }
  }
};

const resolveOrigin = (layer: WebGLLayerMetadata, brush: WebGLSerializedBrushState): { x: number; y: number } => {
  const bounds = layer.documentBoundsPx;
  const x = Math.round(bounds.x);
  const y = Math.round(bounds.y);
  if (
    Math.abs(bounds.x - x) > 1e-6 || Math.abs(bounds.y - y) > 1e-6 ||
    Math.round(bounds.width) !== brush.width || Math.round(bounds.height) !== brush.height
  ) {
    throw new CcShapePackingError(
      'unsupported-goblet-scaled-layer',
      `Layer "${layer.name}" uses scaled/non-integer Goblet placement and cannot be pixel-perfectly deconstructed. Use the source .vs file.`,
    );
  }
  return { x, y };
};

const readMask = async (
  mask: WebGLSerializedAlphaMask | undefined,
  zip: JSZip | null,
  pixels: number,
  field: string,
): Promise<Uint8Array | undefined> => mask
  ? readBytePayload(mask.data, zip, pixels, field)
  : undefined;

export const encodeGobletPackingPayload = (
  original: unknown,
  values: Uint8Array | Uint16Array,
  zip: JSZip | null,
  field: string,
): NumericExportBuffer | SidecarRef => {
  if (isSidecarRef(original)) {
    if (!zip) throw new CcShapePackingError('missing-goblet-sidecar', `${field} cannot be written without its ZIP.`);
    const bytes = values instanceof Uint16Array
      ? new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
      : Uint8Array.from(values);
    zip.file(original.ref, bytes);
    return { ...original, byteLength: bytes.byteLength };
  }
  if (typeof original === 'string' && original.startsWith('b64z:') && values.every((value) => value <= 255)) {
    return b64zEncode(Uint8Array.from(values));
  }
  return Array.from(values);
};

const parseArtifact = async (input: Uint8Array): Promise<{
  kind: ArtifactKind;
  zip: JSZip | null;
  metadataPath: string | null;
  metadata: WebGLExportMetadata;
  wasMinified: boolean;
  html?: string;
  inlineRange?: { start: number; end: number };
}> => {
  if (!isZip(input)) {
    const text = new TextDecoder().decode(input);
    if (/^\s*</.test(text)) {
      const inlineRange = findInlineMetadataRange(text);
      const encoded = text.slice(inlineRange.start, inlineRange.end);
      const parsed = JSON.parse(decodeInlineMetadata(encoded));
      return {
        kind: 'single-html',
        zip: null,
        metadataPath: null,
        metadata: expandMinifiedProperties(parsed) as WebGLExportMetadata,
        wasMinified: Boolean(parsed && typeof parsed === 'object' && 'f' in parsed && !('format' in parsed)),
        html: text,
        inlineRange,
      };
    }
    const parsed = JSON.parse(text);
    return {
      kind: 'json',
      zip: null,
      metadataPath: null,
      metadata: expandMinifiedProperties(parsed) as WebGLExportMetadata,
      wasMinified: Boolean(parsed && typeof parsed === 'object' && 'f' in parsed && !('format' in parsed)),
    };
  }
  const zip = await JSZip.loadAsync(input);
  const metadataPath = Object.keys(zip.files).find((name) => name.endsWith('-goblet.json'))
    ?? Object.keys(zip.files).find((name) => name.endsWith('.json'))
    ?? null;
  if (!metadataPath) throw new CcShapePackingError('missing-goblet-metadata', 'Goblet ZIP has no metadata JSON.');
  const entry = zip.file(metadataPath);
  if (!entry) throw new CcShapePackingError('missing-goblet-metadata', 'Goblet metadata entry is missing.');
  const parsed = JSON.parse(await entry.async('string'));
  return {
    kind: 'zip',
    zip,
    metadataPath,
    metadata: expandMinifiedProperties(parsed) as WebGLExportMetadata,
    wasMinified: Boolean(parsed && typeof parsed === 'object' && 'f' in parsed && !('format' in parsed)),
  };
};

export const packGobletArtifactColorCycleShapes = async (
  input: Uint8Array,
  options: GobletArtifactPackingOptions,
): Promise<GobletArtifactPackingResult> => {
  const artifact = await parseArtifact(input);
  const metadata = artifact.metadata;
  const canvasWidth = Math.round(metadata.project.width);
  const canvasHeight = Math.round(metadata.project.height);
  const selected = selectLayers(metadata, options.selectors);
  const destinationLayer = options.destinationLayerId
    ? selected.find((layer) => layer.id === options.destinationLayerId)
    : selected[0];
  if (!destinationLayer) {
    throw new CcShapePackingError('destination-layer-not-selected', 'The destination CC layer must be selected.');
  }
  assertCompatibleCcLayerPresentation(selected, destinationLayer.id);
  assertSelectedLayersAreContiguous(
    metadata.layers.map((layer) => layer.id),
    selected.map((layer) => layer.id),
  );
  const originals = new Map<string, {
    brush: WebGLSerializedBrushState;
    originalBuffers: Record<string, unknown>;
    originalMasks: { alpha?: unknown; soft?: unknown };
    speedWasPresent: boolean;
  }>();
  const packingLayers: CcPackingLayerInput[] = [];

  for (const layer of selected) {
    const brush = layer.colorCycle!.brushState!;
    const alphaMode = brush.alphaMode ?? 'source';
    if (alphaMode === 'source' && layer.assets?.texture) {
      throw new CcShapePackingError(
        'unsupported-goblet-source-alpha',
        `Selected Goblet layer "${layer.name}" uses source-image alpha, which cannot be moved losslessly by the packer. Pack the source .vs file or export with opaque index alpha.`,
        { layerId: layer.id, alphaMode },
      );
    }
    const sourcePixels = brush.width * brush.height;
    const origin = resolveOrigin(layer, brush);
    const paintSource = await readBytePayload(brush.indexBuffer, artifact.zip, sourcePixels, 'indexBuffer');
    const gradientSource = await readBytePayload(brush.gradientIdBuffer, artifact.zip, sourcePixels, 'gradientIdBuffer');
    const defSource = await readDefPayload(brush.gradientDefIdBuffer, artifact.zip, sourcePixels);
    const flowSource = await readBytePayload(brush.flowBuffer, artifact.zip, sourcePixels, 'flowBuffer');
    const phaseSource = await readBytePayload(brush.phaseBuffer, artifact.zip, sourcePixels, 'phaseBuffer');
    const speedSource = brush.speedBuffer
      ? await readBytePayload(brush.speedBuffer, artifact.zip, sourcePixels, 'speedBuffer')
      : new Uint8Array(sourcePixels);
    const alphaSource = await readMask(layer.colorCycle?.alphaMask, artifact.zip, sourcePixels, 'alphaMask');
    const softSource = await readMask(layer.colorCycle?.softEdgeMask, artifact.zip, sourcePixels, 'softEdgeMask');
    const documentPixels = canvasWidth * canvasHeight;
    const document = {
      paint: new Uint8Array(documentPixels),
      gradientId: new Uint8Array(documentPixels),
      gradientDefId: new Uint16Array(documentPixels),
      speed: new Uint8Array(documentPixels),
      flow: new Uint8Array(documentPixels),
      phase: new Uint8Array(documentPixels),
      alphaMask: alphaSource ? new Uint8Array(documentPixels) : undefined,
      softEdgeMask: softSource ? new Uint8Array(documentPixels) : undefined,
    };
    copyIntoDocument(paintSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.paint);
    copyIntoDocument(gradientSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.gradientId);
    copyIntoDocument(defSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.gradientDefId);
    copyIntoDocument(speedSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.speed);
    copyIntoDocument(flowSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.flow);
    copyIntoDocument(phaseSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.phase);
    if (alphaSource && document.alphaMask) copyIntoDocument(alphaSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.alphaMask);
    if (softSource && document.softEdgeMask) copyIntoDocument(softSource, brush.width, brush.height, canvasWidth, canvasHeight, origin.x, origin.y, document.softEdgeMask);
    originals.set(layer.id, {
      brush,
      originalBuffers: {
        indexBuffer: brush.indexBuffer,
        gradientIdBuffer: brush.gradientIdBuffer,
        gradientDefIdBuffer: brush.gradientDefIdBuffer,
        speedBuffer: brush.speedBuffer,
        flowBuffer: brush.flowBuffer,
        phaseBuffer: brush.phaseBuffer,
      },
      originalMasks: {
        alpha: layer.colorCycle?.alphaMask?.data,
        soft: layer.colorCycle?.softEdgeMask?.data,
      },
      speedWasPresent: Boolean(brush.speedBuffer),
    });
    packingLayers.push({ layerId: layer.id, layerName: layer.name, width: canvasWidth, height: canvasHeight, channels: document });
  }

  const consolidated = consolidateCcLayerNamespaces(packingLayers);
  const shapes = consolidated.layers.flatMap((layer) => extractCcShapes(layer, {
    splitByGradientDefId: options.splitByGradientDefId,
    ...options.separationByLayerId?.[layer.layerId],
  }));
  const packing = packCcShapes(shapes, {
    canvasWidth,
    canvasHeight,
    padding: options.padding,
    rotations: options.rotations,
    beamWidth: options.beamWidth,
    minimumSupportSpanRatio: options.minimumSupportSpanRatio,
    allowNonGravityNesting: options.allowNonGravityNesting,
    allowPartialPreview: options.allowPartialPreview,
    allowOverlap: options.allowOverlap,
  });
  if (!isCompleteCcPacking(shapes, packing)) {
    return {
      artifactData: input,
      artifactKind: artifact.kind,
      packing,
      canvasWidth,
      canvasHeight,
      selectedLayerIds: selected.map((layer) => layer.id),
      sourceShapeCount: shapes.length,
    };
  }
  const rewritten = rewritePackedCcLayers(consolidated.layers, packing.placements, {
    destinationLayerId: destinationLayer.id,
    allowOverlap: options.allowOverlap,
  });
  const mergedMetadata = mergeColorCycleMetadata(
    selected.map((layer) => ({
      layerId: layer.id,
      metadata: layer.colorCycle as unknown as Record<string, unknown>,
    })),
    consolidated.remap,
  );
  applyMergedColorCycleMetadata(
    destinationLayer.colorCycle as unknown as Record<string, unknown>,
    mergedMetadata,
  );
  for (const layer of [destinationLayer]) {
    const original = originals.get(layer.id)!;
    const next = rewritten.get(layer.id)!;
    const colorCycle = layer.colorCycle!;
    const validationBrush: WebGLSerializedBrushState = {
      ...original.brush,
      width: canvasWidth,
      height: canvasHeight,
      indexBuffer: Array.from(next.paint),
      gradientIdBuffer: Array.from(next.gradientId),
      gradientDefIdBuffer: Array.from(next.gradientDefId),
      speedBuffer: original.speedWasPresent ? Array.from(next.speed) : undefined,
      flowBuffer: Array.from(next.flow),
      phaseBuffer: Array.from(next.phase),
      alphaMode: 'opaque-indices',
    };
    const validation = validateGobletColorCyclePayload({
      ...colorCycle,
      brushState: validationBrush,
      alphaMask: next.alphaMask ? { width: canvasWidth, height: canvasHeight, data: Array.from(next.alphaMask) } : undefined,
      softEdgeMask: next.softEdgeMask ? { width: canvasWidth, height: canvasHeight, data: Array.from(next.softEdgeMask) } : undefined,
    }, { layerId: layer.id, hasContent: next.paint.some((value) => value !== 0) });
    if (!validation.ok) {
      throw new CcShapePackingError('invalid-packed-goblet-payload', `Packed Goblet layer "${layer.name}" failed payload validation.`, {
        diagnostics: validation.diagnostics,
      });
    }
    original.brush.width = canvasWidth;
    original.brush.height = canvasHeight;
    const writableBrush = original.brush as unknown as Record<string, unknown>;
    writableBrush.indexBuffer = encodeGobletPackingPayload(original.originalBuffers.indexBuffer, next.paint, artifact.zip, 'indexBuffer');
    writableBrush.gradientIdBuffer = encodeGobletPackingPayload(original.originalBuffers.gradientIdBuffer, next.gradientId, artifact.zip, 'gradientIdBuffer');
    writableBrush.gradientDefIdBuffer = encodeGobletPackingPayload(original.originalBuffers.gradientDefIdBuffer, next.gradientDefId, artifact.zip, 'gradientDefIdBuffer');
    writableBrush.speedBuffer = original.speedWasPresent
      ? encodeGobletPackingPayload(original.originalBuffers.speedBuffer, next.speed, artifact.zip, 'speedBuffer')
      : undefined;
    writableBrush.flowBuffer = encodeGobletPackingPayload(original.originalBuffers.flowBuffer, next.flow, artifact.zip, 'flowBuffer');
    writableBrush.phaseBuffer = encodeGobletPackingPayload(original.originalBuffers.phaseBuffer, next.phase, artifact.zip, 'phaseBuffer');
    original.brush.alphaMode = 'opaque-indices';
    if (next.alphaMask) {
      colorCycle.alphaMask = {
        width: canvasWidth,
        height: canvasHeight,
        data: encodeGobletPackingPayload(original.originalMasks.alpha, next.alphaMask, artifact.zip, 'alphaMask') as number[] | string,
      };
    }
    if (next.softEdgeMask) {
      colorCycle.softEdgeMask = {
        width: canvasWidth,
        height: canvasHeight,
        data: encodeGobletPackingPayload(original.originalMasks.soft, next.softEdgeMask, artifact.zip, 'softEdgeMask') as number[] | string,
      };
    }
    const fullBounds = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    layer.source = { width: canvasWidth, height: canvasHeight };
    layer.documentBoundsPx = fullBounds;
    layer.documentBoundsPercent = { x: 0, y: 0, width: 100, height: 100 };
    // The rewritten brush payload is a full-document surface. Keep Goblet's
    // source crop full-size as well; a tight packed contentBounds would cause
    // the viewer's alignment path to scale/reposition the pile a second time.
    layer.pixelBoundsPx = fullBounds;
    layer.contentBounds = fullBounds;
    layer.paintedSize = { width: canvasWidth, height: canvasHeight };
    layer.assets = undefined;
    colorCycle.coverageBoundsPx = fullBounds;
    colorCycle.coverageBoundsSourcePx = fullBounds;
  }

  const removedLayerIds = new Set(selected.filter((layer) => layer.id !== destinationLayer.id).map((layer) => layer.id));
  metadata.layers = metadata.layers.filter((layer) => !removedLayerIds.has(layer.id));

  metadata.exportedAt = new Date().toISOString();
  metadata.preview = undefined;
  const metadataJson = JSON.stringify(artifact.wasMinified ? minifyProperties(metadata) : metadata);
  let artifactData: Uint8Array;
  if (artifact.kind === 'zip' && artifact.zip && artifact.metadataPath) {
    artifact.zip.file(artifact.metadataPath, metadataJson);
    const indexEntry = artifact.zip.file('index.html');
    if (indexEntry) {
      const indexHtml = await indexEntry.async('string');
      artifact.zip.file('index.html', replaceInlineMetadataIfPresent(indexHtml, metadataJson));
    }
    artifactData = await artifact.zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
  } else if (artifact.kind === 'single-html' && artifact.html && artifact.inlineRange) {
    const encoded = encodeInlineMetadata(metadataJson);
    artifactData = new TextEncoder().encode(
      `${artifact.html.slice(0, artifact.inlineRange.start)}${encoded}${artifact.html.slice(artifact.inlineRange.end)}`,
    );
  } else {
    artifactData = new TextEncoder().encode(metadataJson);
  }
  return {
    artifactData,
    artifactKind: artifact.kind,
    packing,
    canvasWidth,
    canvasHeight,
    selectedLayerIds: selected.map((layer) => layer.id),
    sourceShapeCount: shapes.length,
  };
};
