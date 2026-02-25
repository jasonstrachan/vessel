import fs from 'node:fs';
import path from 'node:path';

describe('WebGL speed semantics', () => {
  it('treats speed byte 0 as static phase (not legacy offset)', () => {
    const filePath = path.join(
      process.cwd(),
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts'
    );
    const source = fs.readFileSync(filePath, 'utf8');

    const speedZeroBranch = source.match(
      /if\s*\(fSpd\s*<\s*0\.5\)\s*\{[\s\S]*?\}\s*else\s*\{/m
    );
    expect(speedZeroBranch).toBeTruthy();
    const block = speedZeroBranch?.[0] ?? '';

    expect(block).toContain('basePhase = 0.0;');
    expect(block).not.toContain('basePhase = u_legacyOffset;');
  });
});
