import { readFileSync } from 'node:fs';
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
  });

  it('keeps both build wrappers on the explicit export signal', () => {
    const wrapperPaths = [
      'scripts/next-build.mjs',
      'scripts/preview-build.mjs',
    ];

    for (const wrapperPath of wrapperPaths) {
      const source = readFileSync(path.resolve(wrapperPath), 'utf8');

      expect(source).toContain("env.VESSEL_STATIC_EXPORT = '1';");
      expect(source.indexOf("env.VESSEL_STATIC_EXPORT = '1';")).toBeLessThan(
        source.indexOf("spawn(process.execPath, [nextBin, 'build']"),
      );
    }
  });

  it('cleans both export and internal Next build state before direct builds', () => {
    const source = readFileSync(path.resolve('scripts/next-build.mjs'), 'utf8');

    expect(source).toContain("rmSync(env.NEXT_DIST_DIR, { recursive: true, force: true });");
    expect(source).toContain("rmSync('.next', { recursive: true, force: true });");
    expect(source.indexOf("rmSync('.next', { recursive: true, force: true });")).toBeLessThan(
      source.indexOf("spawn(process.execPath, [nextBin, 'build']"),
    );
  });
});
