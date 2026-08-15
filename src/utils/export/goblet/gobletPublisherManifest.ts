import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';
import {
  registerGobletPublisher,
  type GobletPublishContext,
  type GobletPublisher,
  type GobletPublishResult,
} from '@/utils/export/goblet/gobletPublisherRegistry';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PUBLISHERS = 8;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

type UnknownRecord = Record<string, unknown>;

export interface GobletPublisherDescriptor {
  id: string;
  label: string;
  endpoint: string;
}

export interface GobletPublisherManifest {
  schemaVersion: 1;
  publishers: GobletPublisherDescriptor[];
}

interface GobletPublisherManifestOptions {
  fetcher?: typeof fetch;
  manifestUrl?: string;
}

let hydrationPromise: Promise<readonly GobletPublisher[]> | null = null;
let unregisterManifestPublishers: Array<() => void> = [];

const getDefaultManifestUrl = (): string => {
  const basePath = process.env.VESSEL_BASE_PATH?.trim().replace(/\/$/, '') ?? '';
  return `${basePath}/vessel-publishers.json`;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: UnknownRecord, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};

const parseEndpoint = (value: unknown, baseUrl: string): string => {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('Goblet publisher endpoint is invalid.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value, baseUrl);
  } catch {
    throw new Error('Goblet publisher endpoint is invalid.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('Goblet publisher endpoint must use HTTP without embedded credentials.');
  }
  endpoint.hash = '';
  return endpoint.toString();
};

export const parseGobletPublisherManifest = (
  value: unknown,
  baseUrl: string,
): GobletPublisherManifest => {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'publishers'])
    || value.schemaVersion !== 1
    || !Array.isArray(value.publishers)
    || value.publishers.length > MAX_PUBLISHERS
  ) {
    throw new Error('Goblet publisher manifest is invalid.');
  }

  const ids = new Set<string>();
  const publishers = value.publishers.map((entry): GobletPublisherDescriptor => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['id', 'label', 'endpoint'])) {
      throw new Error('Goblet publisher descriptor is invalid.');
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!SAFE_ID_PATTERN.test(id) || ids.has(id) || label.length < 1 || label.length > 80) {
      throw new Error('Goblet publisher identity is invalid.');
    }
    ids.add(id);
    return {
      id,
      label,
      endpoint: parseEndpoint(entry.endpoint, baseUrl),
    };
  });

  return { schemaVersion: 1, publishers };
};

const buildPublishMetadata = (artifact: GobletArtifact, context: GobletPublishContext) => ({
  schemaVersion: 1,
  source: 'vessel',
  project: {
    id: context.projectId,
    name: context.projectName,
  },
  artifact: {
    filename: artifact.filename,
    mimeType: artifact.blob.type || 'application/octet-stream',
    bytes: artifact.blob.size,
    format: artifact.metadata.format,
    version: artifact.metadata.version,
    exportedAt: artifact.metadata.exportedAt,
    width: artifact.metadata.viewport.designWidth,
    height: artifact.metadata.viewport.designHeight,
    durationSeconds: artifact.metadata.animation.durationSeconds,
  },
});

const responseMessage = async (response: Response): Promise<{ message: string; url?: string }> => {
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null) as unknown
    : null;
  const record = isRecord(payload) ? payload : null;
  const error = record && isRecord(record.error) ? record.error : null;
  if (!response.ok) {
    const message = typeof error?.message === 'string'
      ? error.message
      : `Publish failed (${response.status}).`;
    throw new Error(message);
  }
  return {
    message: typeof record?.message === 'string' ? record.message : 'Goblet published',
    ...(typeof record?.url === 'string' ? { url: record.url } : {}),
  };
};

export const createManifestGobletPublisher = (
  descriptor: GobletPublisherDescriptor,
  fetcher?: typeof fetch,
): GobletPublisher => {
  let inFlight: Promise<GobletPublishResult> | null = null;
  return {
    id: descriptor.id,
    label: descriptor.label,
    publish: (artifact, context) => {
      if (inFlight) {
        return inFlight;
      }
      inFlight = (async () => {
        const form = new FormData();
        form.set('file', artifact.blob, artifact.filename);
        form.set('metadata', JSON.stringify(buildPublishMetadata(artifact, context)));
        const resolvedFetcher = fetcher ?? globalThis.fetch;
        if (typeof resolvedFetcher !== 'function') {
          throw new Error('Publishing is unavailable in this browser.');
        }
        const response = await resolvedFetcher(descriptor.endpoint, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
          cache: 'no-store',
        });
        return responseMessage(response);
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
};

const fetchManifest = async (
  fetcher: typeof fetch,
  manifestUrl: string,
): Promise<GobletPublisherManifest | null> => {
  const response = await fetcher(manifestUrl, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Goblet publisher manifest could not be loaded (${response.status}).`);
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
    throw new Error('Goblet publisher manifest is too large.');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Goblet publisher manifest is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Goblet publisher manifest is not valid JSON.');
  }
  return parseGobletPublisherManifest(parsed, response.url || manifestUrl);
};

export const hydrateHostGobletPublishers = ({
  fetcher,
  manifestUrl = getDefaultManifestUrl(),
}: GobletPublisherManifestOptions = {}): Promise<readonly GobletPublisher[]> => {
  if (hydrationPromise) {
    return hydrationPromise;
  }
  const resolvedFetcher = fetcher ?? globalThis.fetch;
  if (typeof resolvedFetcher !== 'function') {
    return Promise.resolve([]);
  }
  hydrationPromise = (async () => {
    const manifest = await fetchManifest(resolvedFetcher, manifestUrl);
    for (const unregister of unregisterManifestPublishers) unregister();
    unregisterManifestPublishers = [];
    if (!manifest) return [];
    const publishers = manifest.publishers.map((descriptor) => (
      createManifestGobletPublisher(descriptor, resolvedFetcher)
    ));
    const unregisters: Array<() => void> = [];
    try {
      for (const publisher of publishers) {
        unregisters.push(registerGobletPublisher(publisher));
      }
    } catch (error) {
      for (const unregister of unregisters.reverse()) unregister();
      throw error;
    }
    unregisterManifestPublishers = unregisters;
    return publishers;
  })().catch((error) => {
    hydrationPromise = null;
    throw error;
  });
  return hydrationPromise;
};

export const __resetHostGobletPublishersForTests = (): void => {
  for (const unregister of unregisterManifestPublishers) unregister();
  unregisterManifestPublishers = [];
  hydrationPromise = null;
};
