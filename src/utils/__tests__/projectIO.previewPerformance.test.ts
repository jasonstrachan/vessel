import JSZip from 'jszip';

import { createProjectArchiveInspectionSession } from '@/utils/projectIO';

describe('project preview archive performance', () => {
  it('reads a compact preview without hydrating a large project manifest', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
      version: '1.0.0',
      metadata: {},
      project: { padding: 'x'.repeat(5 * 1024 * 1024) },
    }));
    zip.file('manifest.json', JSON.stringify({
      version: '1.1.0',
      manifestVersion: 2,
      metadata: {
        name: 'Performance fixture',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:00.000Z',
        appVersion: '3.0.0',
      },
      project: {
        id: 'preview-performance',
        name: 'Performance fixture',
        width: 2048,
        height: 2048,
      },
      preview: {
        dataUrl: 'data:image/webp;base64,preview',
        width: 256,
        height: 256,
        encoding: 'image/webp',
      },
    }));
    const payload = await zip.generateAsync({
      type: 'uint8array',
      compression: 'STORE',
    });
    const startedAt = performance.now();

    const session = await createProjectArchiveInspectionSession(payload);
    const previewReadMs = performance.now() - startedAt;

    expect(session.preview.project.name).toBe('Performance fixture');
    expect(previewReadMs).toBeLessThan(200);
  });
});
