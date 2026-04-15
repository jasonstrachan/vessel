import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

describe('Goblet 2 runtime export regression guard', () => {
  it('keeps the viewer-only CC time multiplier in the module runtime', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('const CC_TIME_MULTIPLIER = 3.0;');
    expect(runtime).toContain('gl.uniform1f(this.uniforms.u_time, timeSeconds * CC_TIME_MULTIPLIER);');
  });

  it('keeps the viewer-only CC time multiplier in the inline runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain('uniform1f(this.uniforms.u_time,3*e)');
  });

  it('advances brush color-cycle playback directly by deltaSeconds in the module runtime', () => {
    const runtime = read('public/goblet2/goblet2.js');

    expect(runtime).toContain('this.baseTimeSeconds += deltaSeconds;');
    expect(runtime).toContain('this.legacyOffset01 = wrap01(this.legacyOffset01 + deltaSeconds * (this.legacySpeedCps || 0));');
    expect(runtime).not.toContain('this.frameAccumulator += deltaSeconds;');
  });

  it('advances brush color-cycle playback directly by deltaSeconds in the inline runtime', () => {
    const runtime = read('public/goblet2/goblet2-inline.js');

    expect(runtime).toContain('this.baseTimeSeconds+=e');
    expect(runtime).toContain('this.legacyOffset01=wrap01(this.legacyOffset01+e*(this.legacySpeedCps||0))');
    expect(runtime).not.toContain('this.frameAccumulator+=e');
  });
});
