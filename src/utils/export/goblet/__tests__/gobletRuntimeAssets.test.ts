import { resolveGobletAssetUrl } from '../gobletRuntimeAssets';

const originalVesselBasePath = process.env.VESSEL_BASE_PATH;

describe('gobletRuntimeAssets', () => {
  afterEach(() => {
    if (originalVesselBasePath === undefined) {
      delete process.env.VESSEL_BASE_PATH;
    } else {
      process.env.VESSEL_BASE_PATH = originalVesselBasePath;
    }
  });

  it('uses the static-export base path for Goblet assets', () => {
    process.env.VESSEL_BASE_PATH = '/vessel';

    expect(resolveGobletAssetUrl('index.html', undefined, 'goblet2')).toBe(
      '/vessel/goblet2/index.html',
    );
  });

  it('keeps an explicit asset prefix authoritative', () => {
    process.env.VESSEL_BASE_PATH = '/vessel';

    expect(resolveGobletAssetUrl('index.html', '/preview/', 'goblet2')).toBe(
      '/preview/goblet2/index.html',
    );
  });
});
