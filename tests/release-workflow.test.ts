import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildVesselNextConfig } from '../next.config';

describe('release workflow', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'deploy.yml'),
    'utf8',
  );

  it('fans out independent quality, unit, GPU, and build jobs', () => {
    expect(workflow).toContain('quality:');
    expect(workflow).toContain('unit-tests:');
    expect(workflow).toContain('gpu-parity:');
    expect(workflow).toContain('static-export:');
    expect(workflow).toContain('needs: [quality, unit-tests, gpu-parity, static-export]');
  });

  it('uploads one static artifact and passes its run id to the website', () => {
    expect(workflow.match(/actions\/upload-artifact@v7/g)).toHaveLength(2);
    expect(workflow).toContain('name: vessel-static-export');
    expect(workflow).toContain('source_run_id');
    expect(workflow).toContain('${SOURCE_RUN_ID}');
  });

  it('cancels superseded runs per ref and runs the full Jest suite once', () => {
    expect(workflow).toContain('group: vessel-static-export-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow.match(/npm test -- --maxWorkers=2/g)).toHaveLength(1);
  });

  it('only skips Next.js duplicate checks for externally verified artifacts', () => {
    const verifiedConfig = buildVesselNextConfig({
      VESSEL_STATIC_EXPORT: '1',
      VESSEL_VERIFIED_BUILD: '1',
    });
    const normalConfig = buildVesselNextConfig({ VESSEL_STATIC_EXPORT: '1' });

    expect(verifiedConfig.eslint).toEqual({ ignoreDuringBuilds: true });
    expect(verifiedConfig.typescript).toEqual({ ignoreBuildErrors: true });
    expect(normalConfig.eslint).toBeUndefined();
    expect(normalConfig.typescript).toBeUndefined();
  });
});
