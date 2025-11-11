import JSZip from 'jszip';
import { gzipSync } from 'fflate';
import { TextEncoder, TextDecoder } from 'util';

const utilTextEncoder = TextEncoder;
const utilTextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;

if (typeof globalThis.TextEncoder === 'undefined') {
  // @ts-expect-error - jsdom environment misses TextEncoder in Node 18
  globalThis.TextEncoder = utilTextEncoder;
}

if (typeof globalThis.TextDecoder === 'undefined') {
  // @ts-expect-error - jsdom environment misses TextDecoder in Node 18
  globalThis.TextDecoder = utilTextDecoder;
}

import { readProjectManifest, type VesselProject } from '@/utils/projectIO';

const buildManifest = (name: string): VesselProject => ({
  version: '1.0.0',
  metadata: {
    name,
    created: '2025-01-01T00:00:00.000Z',
    modified: '2025-01-02T00:00:00.000Z',
    appVersion: '0.9.0'
  },
  project: {
    id: `${name.toLowerCase().replace(/\s+/g, '-')}-id`,
    name,
    width: 128,
    height: 64,
    backgroundColor: '#000000',
    layers: [],
    customBrushes: []
  }
});

const encoder = new TextEncoder();

describe('readProjectManifest', () => {
  it('parses modern zip-based project archives', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(buildManifest('Zip Project')));
    const payload = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    const manifest = await readProjectManifest(payload);

    expect(manifest.project.name).toBe('Zip Project');
    expect(manifest.version).toBe('1.0.0');
  });

  it('parses legacy gzip-compressed project payloads', async () => {
    const gzipPayload = gzipSync(encoder.encode(JSON.stringify(buildManifest('Gzip Project'))));

    const manifest = await readProjectManifest(gzipPayload);

    expect(manifest.project.name).toBe('Gzip Project');
    expect(manifest.metadata.appVersion).toBe('0.9.0');
  });
});
