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
    expect(nextConfig.experimental).toMatchObject({
      cpus: 1,
      workerThreads: false,
    });
  });

  it('keeps package build scripts on the stable static export command', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe('npm run build:next');
    expect(packageJson.scripts['build:next']).toContain('node scripts/require-node-version.mjs');
    expect(packageJson.scripts['build:next']).toContain('rm -rf .next out .next-build');
    expect(packageJson.scripts['build:next']).toContain('env -u NODE_OPTIONS');
    expect(packageJson.scripts['build:next']).toContain('VESSEL_STATIC_EXPORT=1');
    expect(packageJson.scripts['build:next']).toContain('NEXT_DIST_DIR=.next');
    expect(packageJson.scripts['build:next']).toContain('node node_modules/next/dist/bin/next build');
    expect(packageJson.scripts['build:next']).toContain('cp -R out .next-build');
    expect(packageJson.scripts['build:clean']).toContain('npm run build:next');
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
