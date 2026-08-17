import { existsSync } from 'node:fs';
import path from 'path';

import type { NextConfig } from 'next';

export interface VesselNextBuildMode {
  isStaticExport: boolean;
  distDir: string;
}

export interface VesselNextBuildEnv {
  NODE_ENV?: string;
  VESSEL_STATIC_EXPORT?: string;
  VESSEL_VERIFIED_BUILD?: string;
  VESSEL_STUDIO?: string;
  NEXT_DIST_DIR?: string;
}

export const resolveVesselNextBuildMode = (
  env: VesselNextBuildEnv = process.env,
): VesselNextBuildMode => {
  const isStaticExport =
    env.VESSEL_STATIC_EXPORT === '1' ||
    env.NEXT_DIST_DIR === '.next-build' ||
    env.NEXT_DIST_DIR === '.next-preview';

  return {
    isStaticExport,
    distDir: env.NEXT_DIST_DIR || (isStaticExport ? '.next-build' : '.next'),
  };
};

export const buildVesselNextConfig = (
  env: VesselNextBuildEnv = process.env,
): NextConfig => {
  const { isStaticExport, distDir } = resolveVesselNextBuildMode(env);
  const isExternallyVerifiedBuild = env.VESSEL_VERIFIED_BUILD === '1';
  const isStudioBuild = env.VESSEL_STUDIO === '1';
  if (isStaticExport && isStudioBuild) {
    throw new Error('Studio extensions cannot be included in a public static export.');
  }
  const studioExtensionEntry = isStudioBuild
    ? path.resolve('.vessel-studio/extension/index.tsx')
    : path.resolve('src/extensions/noopStudioExtension.ts');
  if (isStudioBuild && !existsSync(studioExtensionEntry)) {
    throw new Error(
      'Studio extension is not connected. Expected .vessel-studio/extension/index.tsx.',
    );
  }

  return {
    distDir,
    ...(isExternallyVerifiedBuild && {
      eslint: {
        ignoreDuringBuilds: true,
      },
      typescript: {
        ignoreBuildErrors: true,
      },
    }),
    // Only use static export config for wrapper-owned export builds.
    ...(isStaticExport && {
      output: 'export',
      trailingSlash: true,
      basePath: '/vessel',
      assetPrefix: '/vessel/',
    }),
    images: {
      unoptimized: true,
    },
    // Increase timeout for slow WSL2 file operations
    httpAgentOptions: {
      keepAlive: true,
    },

    // Ensure proper development server configuration
    webpack: (config, { dev, webpack }) => {
      if (isStudioBuild) {
        config.plugins = config.plugins ?? [];
        config.plugins.push(new webpack.NormalModuleReplacementPlugin(
          /activeStudioExtension$/,
          studioExtensionEntry,
        ));
      }
      if (dev) {
        // WSL2-optimized watch configuration to prevent cache corruption
        config.watchOptions = {
          // Use native polling for WSL2 stability
          poll: 2000,
          // Batch changes to reduce file system stress
          aggregateTimeout: 500,
          // Ignore paths that don't need watching
          ignored: [
            '**/node_modules',
            '**/.git',
            '**/.next',
            '**/.next-build',
            '**/.next-preview',
            '**/dist',
            '**/build',
            '**/.turbo',
            '**/coverage',
            '**/*.log',
          ],
        };

        // Force memory cache in WSL2 for maximum stability
        // Filesystem cache is too unreliable on WSL2
        if (process.env.WSL_DISTRO_NAME || process.env.WEBPACK_CACHE_TYPE === 'memory') {
          config.cache = {
            type: 'memory',
            maxGenerations: 1, // Aggressive memory cleanup
          };
        } else {
          config.cache = {
            type: 'filesystem',
            cacheDirectory: path.resolve('.next/cache/webpack'),
            // Shorter timeouts to prevent stale cache
            idleTimeout: 10000,
            idleTimeoutAfterLargeChanges: 2000,
            // Use pack store for atomic writes
            store: 'pack',
            compression: false,
            maxAge: 1000 * 60 * 60, // 1 hour max cache age
          };
        }

        // Optimize for stability over speed in WSL2
        if (process.env.WSL_DISTRO_NAME) {
          config.parallelism = 1;
          config.optimization = {
            ...config.optimization,
            removeAvailableModules: false,
            removeEmptyChunks: false,
          };
        }
      }
      return config;
    },

    // Inject build timestamp into environment
    env: {
      BUILD_TIMESTAMP: new Date().toISOString(),
      VESSEL_BASE_PATH: isStaticExport ? '/vessel' : '',
    },

    // Allow cross-origin requests in development
    allowedDevOrigins: ['172.24.178.199'],

    // Server configuration (disabled for static export)
    // async rewrites() {
    //   return []
    // },

    // Note: assetPrefix now set above for static export builds.

    experimental: {
      cpus: 1,
      workerThreads: false,
      externalDir: isStudioBuild,
    },
  };
};

const nextConfig: NextConfig = buildVesselNextConfig();

export default nextConfig;
