import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runGate = (files: string[], extraArgs: string[] = []) => {
  try {
    const output = execFileSync(
      'node',
      [
        'scripts/check-playback-change-gates.mjs',
        ...extraArgs,
        '--files',
        ...files,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { status: 0, output };
  } catch (error) {
    const execError = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: execError.status ?? 1,
      output: `${execError.stdout?.toString() ?? ''}${execError.stderr?.toString() ?? ''}`,
    };
  }
};

const runGateFromGitDiff = (extraArgs: string[]) => {
  try {
    const output = execFileSync(
      'node',
      ['scripts/check-playback-change-gates.mjs', ...extraArgs],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { status: 0, output };
  } catch (error) {
    const execError = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: execError.status ?? 1,
      output: `${execError.stdout?.toString() ?? ''}${execError.stderr?.toString() ?? ''}`,
    };
  }
};

const runGateFromGitRepo = (repoPath: string, extraArgs: string[] = []) => {
  try {
    const output = execFileSync(
      'node',
      [
        path.join(process.cwd(), 'scripts/check-playback-change-gates.mjs'),
        ...extraArgs,
      ],
      {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GITHUB_BASE_REF: '',
          GITHUB_EVENT_PATH: '',
          PLAYBACK_GUARD_BASE_SHA: '',
        },
      },
    );
    return { status: 0, output };
  } catch (error) {
    const execError = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: execError.status ?? 1,
      output: `${execError.stdout?.toString() ?? ''}${execError.stderr?.toString() ?? ''}`,
    };
  }
};

describe('playback change gate', () => {
  it('fails playback-sensitive changes without parity or shared-runtime companions', () => {
    const result = runGate(['src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts']);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Playback-sensitive files changed without a shared-runtime or parity-matrix companion');
  });

  it('treats uppercase and ccGradient brush-engine playback files as sensitive', () => {
    const result = runGate([
      'src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts',
      'src/hooks/brushEngine/ccGradientRuntime.ts',
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('ColorCycleBrushCanvas2D.ts');
    expect(result.output).toContain('ccGradientRuntime.ts');
  });

  it('treats generated Goblet playback artifacts as sensitive', () => {
    const result = runGate([
      'public/goblet/goblet-inline.js',
      'public/goblet/gobletPlaybackMath.js',
      'public/goblet2/goblet2-inline.js',
      'public/goblet2/alignFitResolver.js',
      'public/goblet2/gobletPayloadContract.js',
      'public/goblet2/gobletPlaybackMath.js',
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('goblet-inline.js');
    expect(result.output).toContain('gobletPlaybackMath.js');
    expect(result.output).toContain('goblet2-inline.js');
    expect(result.output).toContain('alignFitResolver.js');
    expect(result.output).toContain('gobletPayloadContract.js');
  });

  it('allows playback-sensitive changes with a parity matrix companion', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'tests/fixtures/cc/baseline-parity.json',
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('parity/shared companion coverage');
  });

  it('allows generated Goblet playback artifacts with their shared generator source', () => {
    const result = runGate([
      'public/goblet2/alignFitResolver.js',
      'src/utils/alignment/alignFitResolver.ts',
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('parity/shared companion coverage');
  });

  it('allows generated Goblet payload contract artifacts with their shared contract source', () => {
    const result = runGate([
      'public/goblet2/gobletPayloadContract.js',
      'src/lib/colorCycle/document/colorCycleDocumentContract.ts',
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('parity/shared companion coverage');
  });

  it('allows generated Goblet playback math artifacts with their shared source', () => {
    const result = runGate([
      'public/goblet2/gobletPlaybackMath.js',
      'src/lib/colorCycle/gobletPlaybackMath.js',
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('parity/shared companion coverage');
  });

  it('does not treat CC manifest-only changes as rendered parity companion coverage', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'tests/fixtures/cc/parity-cross-product.manifest.json',
      'tests/fixtures/cc/parity-matrix.manifest.json',
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Add/update a shared runtime source or parity fixture/test');
  });

  it('does not treat Goblet2 schema or legacy-corpus JSON as rendered parity companion coverage', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'tests/fixtures/goblet2/legacy-schema-1-color-cycle.json',
      'tests/fixtures/goblet2/legacy-corpus.manifest.json',
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Add/update a shared runtime source or parity fixture/test');
  });

  it('allows playback-sensitive changes with a named parity test companion', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'tests/goblet2-cpu-gpu-parity.spec.ts',
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('parity/shared companion coverage');
  });

  it('does not treat tests outside named parity gates as sufficient companion coverage', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'tests/goblet2-cc-gradient-shapes-perf.spec.ts',
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Add/update a shared runtime source or parity fixture/test');
  });

  it('does not treat the guard test itself as render parity companion coverage', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'tests/playback-change-gate.test.ts',
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Add/update a shared runtime source or parity fixture/test');
  });

  it('allows playback-sensitive changes with a true shared runtime source companion', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'src/lib/displayFilterPipeline.js',
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('parity/shared companion coverage');
  });

  it('does not treat docs as sufficient companion coverage for playback changes', () => {
    const result = runGate([
      'src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts',
      'docs/color-cycle-compatibility-contract.md',
    ]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Add/update a shared runtime source or parity fixture/test');
  });

  it('ignores unrelated file changes', () => {
    const result = runGate(['src/components/LeftToolbar.tsx']);

    expect(result.status).toBe(0);
    expect(result.output).toContain('No playback-sensitive files changed');
  });

  it('uses the GitHub push event before SHA as the diff base', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playback-gate-'));
    const eventPath = path.join(tmpDir, 'event.json');
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    fs.writeFileSync(eventPath, JSON.stringify({ before: headSha }));

    const result = runGateFromGitDiff(['--event-path', eventPath]);

    expect(result.status).toBe(0);
    expect(result.output).not.toContain('No diff base available');
    expect(result.output).toContain('No playback-sensitive files changed');
  });

  it('falls back to checking local HEAD diff when no diff base is available', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playback-gate-local-'));
    const sensitiveFile = path.join(tmpDir, 'src/lib/ColorCycleRenderer.ts');

    fs.mkdirSync(path.dirname(sensitiveFile), { recursive: true });
    fs.writeFileSync(sensitiveFile, 'export const version = 1;\n');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'playback-gate@example.test'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Playback Gate Test'], { cwd: tmpDir });
    execFileSync('git', ['add', 'src/lib/ColorCycleRenderer.ts'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(sensitiveFile, 'export const version = 2;\n');

    const result = runGateFromGitRepo(tmpDir);

    expect(result.status).toBe(1);
    expect(result.output).toContain('checking local HEAD diff');
    expect(result.output).toContain('src/lib/ColorCycleRenderer.ts');
  });
});
