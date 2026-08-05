import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildVesselNextConfig, resolveVesselNextBuildMode } from '../next.config';

describe('Next static export build mode', () => {
  it('enables static export from the explicit wrapper signal', () => {
    const mode = resolveVesselNextBuildMode({ VESSEL_STATIC_EXPORT: '1' });

    expect(mode).toEqual({
      isStaticExport: true,
      distDir: '.next-build',
    });
  });

  it('enables static export from known export dist directories', () => {
    expect(resolveVesselNextBuildMode({ NEXT_DIST_DIR: '.next-build' })).toEqual({
      isStaticExport: true,
      distDir: '.next-build',
    });

    expect(resolveVesselNextBuildMode({ NEXT_DIST_DIR: '.next-preview' })).toEqual({
      isStaticExport: true,
      distDir: '.next-preview',
    });
  });

  it('keeps default development mode non-exported', () => {
    expect(resolveVesselNextBuildMode({})).toEqual({
      isStaticExport: false,
      distDir: '.next',
    });
  });

  it('keeps the production GitHub Pages path contract on export builds', () => {
    const nextConfig = buildVesselNextConfig({ VESSEL_STATIC_EXPORT: '1' });

    expect(nextConfig.output).toBe('export');
    expect(nextConfig.trailingSlash).toBe(true);
    expect(nextConfig.basePath).toBe('/vessel');
    expect(nextConfig.assetPrefix).toBe('/vessel/');
    expect(nextConfig.env).toMatchObject({
      VESSEL_BASE_PATH: '/vessel',
    });
    expect(nextConfig.experimental).toMatchObject({
      cpus: 1,
      workerThreads: false,
    });
  });

  it('keeps development favicon assets rooted at the local origin', () => {
    const nextConfig = buildVesselNextConfig({});

    expect(nextConfig.env).toMatchObject({
      VESSEL_BASE_PATH: '',
    });
  });

  it('keeps package build scripts on the stable static export command', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe('npm run build:next');
    expect(packageJson.scripts['build:next']).toBe('node scripts/github-pages-build.mjs');
    expect(packageJson.scripts['build:clean']).toContain('npm run build:next');
  });

  it('keeps local pushes and CI on the same deployment verification commands', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(path.resolve('.github/workflows/deploy.yml'), 'utf8');
    const prePushHook = readFileSync(path.resolve('.githooks/pre-push'), 'utf8');

    expect(packageJson.scripts['verify:deploy:preflight']).toContain('npm run architecture:check');
    expect(packageJson.scripts['verify:deploy:preflight']).toContain('npm run type-check:tests');
    expect(packageJson.scripts['verify:deploy']).toContain('npm run verify:deploy:preflight');
    expect(packageJson.scripts['verify:deploy']).toContain('npm run build:github');
    expect(workflow).toContain('run: npm run verify:deploy');
    expect(prePushHook).toContain('npm run verify:deploy:preflight');
  });

  it('keeps the GitHub Pages build isolated from local Next dev state', () => {
    const source = readFileSync(path.resolve('scripts/github-pages-build.mjs'), 'utf8');

    expect(source).toContain("env.VESSEL_STATIC_EXPORT = '1';");
    expect(source).toContain("env.NEXT_DIST_DIR = staticDistDirName;");
    expect(source).toContain("'.next'");
    expect(source).toContain("await cp(workspaceStaticDir, finalOutDir");
    expect(source).toContain("await writeFile(path.join(finalOutDir, '.nojekyll')");
  });

  it('keeps the legacy next-build wrapper delegated to the package build command', () => {
    const source = readFileSync(path.resolve('scripts/next-build.mjs'), 'utf8');

    expect(source).toContain("spawn('npm', ['run', 'build:next']");
  });

  it('keeps preview builds on the explicit export signal', () => {
    const source = readFileSync(path.resolve('scripts/preview-build.mjs'), 'utf8');

    expect(source).toContain("env.VESSEL_STATIC_EXPORT = '1';");
    expect(source.indexOf("env.VESSEL_STATIC_EXPORT = '1';")).toBeLessThan(
      source.indexOf("spawn(process.execPath, [nextBin, 'build']"),
    );
  });

  it('keeps static export source free of App Router API routes', () => {
    expect(existsSync(path.resolve('src/app/api'))).toBe(false);
  });
});
