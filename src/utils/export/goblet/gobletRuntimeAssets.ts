export type GobletAssetName =
  | 'index.html'
  | 'goblet.js'
  | 'goblet2.js'
  | 'alignFitResolver.js'
  | 'num.js'
  | 'fflate-inflate.js'
  | 'goblet-inline.js'
  | 'goblet2-inline.js';

export type GobletAssetRoot = 'goblet' | 'goblet2';

const gobletAssetCache = new Map<string, Promise<string>>();

const getDefaultAssetPrefix = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  const extendedWindow = window as typeof window & {
    __NEXT_DATA__?: {
      assetPrefix?: string;
      runtimeConfig?: { basePath?: string };
    };
  };

  const assetPrefix = extendedWindow.__NEXT_DATA__?.assetPrefix;
  if (typeof assetPrefix === 'string' && assetPrefix.length > 0) {
    return assetPrefix;
  }

  const runtimeBasePath = extendedWindow.__NEXT_DATA__?.runtimeConfig?.basePath;
  if (typeof runtimeBasePath === 'string' && runtimeBasePath.length > 0) {
    return runtimeBasePath;
  }

  const baseEl = document.querySelector('base');
  if (baseEl?.href) {
    try {
      const parsed = new URL(baseEl.href);
      const pathname = parsed.pathname;
      if (pathname && pathname !== '/') {
        return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      }
    } catch {}
  }

  return '';
};

export const resolveGobletAssetUrl = (
  asset: GobletAssetName,
  assetPrefix?: string,
  root: GobletAssetRoot = 'goblet'
): string => {
  const prefix = assetPrefix ?? getDefaultAssetPrefix();
  const normalizedAsset = asset.startsWith('/') ? asset.slice(1) : asset;
  const assetPath = `${root}/${normalizedAsset}`;

  if (!prefix) {
    return `/${assetPath}`;
  }

  if (/^https?:\/\//.test(prefix)) {
    const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return `${trimmed}/${assetPath}`;
  }

  const trimmedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const ensuredPrefix = trimmedPrefix.startsWith('/') ? trimmedPrefix : `/${trimmedPrefix}`;
  return `${ensuredPrefix}/${assetPath}`;
};

export const fetchGobletAsset = (
  asset: GobletAssetName,
  assetPrefix?: string,
  root: GobletAssetRoot = 'goblet'
): Promise<string> => {
  const bypassCache =
    asset === 'goblet.js'
    || asset === 'goblet2.js'
    || asset === 'goblet-inline.js'
    || asset === 'goblet2-inline.js';
  if (bypassCache) {
    return (async () => {
      const url = resolveGobletAssetUrl(asset, assetPrefix, root);
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to load Goblet asset ${asset} from ${url} (${response.status})`);
      }
      return await response.text();
    })();
  }

  const cacheKey = `${assetPrefix ?? '__default__'}::${root}::${asset}`;
  const cached = gobletAssetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const url = resolveGobletAssetUrl(asset, assetPrefix, root);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load Goblet asset ${asset} from ${url} (${response.status})`);
    }
    return await response.text();
  })();

  gobletAssetCache.set(cacheKey, promise);
  return promise;
};
