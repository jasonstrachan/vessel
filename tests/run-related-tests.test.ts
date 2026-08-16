import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scriptPath = path.join(process.cwd(), 'scripts', 'run-related-tests.mjs');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('related test selection', () => {
  it('keeps existing source and test modules while excluding generated public files', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vessel-related-tests-'));
    temporaryDirectories.push(root);
    mkdirSync(path.join(root, 'src'), { recursive: true });
    mkdirSync(path.join(root, 'tests'), { recursive: true });
    mkdirSync(path.join(root, 'public'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'control.tsx'), 'export {};');
    writeFileSync(path.join(root, 'tests', 'control.test.tsx'), 'export {};');
    writeFileSync(path.join(root, 'public', 'runtime.js'), 'export {};');

    const result = execFileSync(
      'node',
      [
        scriptPath,
        '--list',
        '--files',
        'src/control.tsx',
        'tests/control.test.tsx',
        'public/runtime.js',
        'README.md',
        'src/deleted.ts',
      ],
      { cwd: root, encoding: 'utf8' },
    );

    expect(JSON.parse(result)).toEqual(['src/control.tsx', 'tests/control.test.tsx']);
  });

  it('resolves the committed source diff between the supplied SHAs', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vessel-related-diff-'));
    temporaryDirectories.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: root });
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'control.ts'), 'export const value = 1;\n');
    execFileSync('git', ['add', 'src/control.ts'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: root });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    writeFileSync(path.join(root, 'src', 'control.ts'), 'export const value = 2;\n');
    execFileSync('git', ['add', 'src/control.ts'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'change'], { cwd: root });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();

    const result = execFileSync(
      'node',
      [scriptPath, '--list', '--base', base, '--head', head],
      { cwd: root, encoding: 'utf8' },
    );

    expect(JSON.parse(result)).toEqual(['src/control.ts']);
  });
});
