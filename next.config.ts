import type { NextConfig } from "next";
import path from "path";

const isProd = process.env.NODE_ENV === 'production'
const distDir = process.env.NEXT_DIST_DIR || '.next';

const nextConfig: NextConfig = {
  distDir,
  // Only use static export and GitHub Pages config in production
  ...(isProd && {
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
  webpack: (config, { dev, isServer }) => {
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
          '**/dist',
          '**/build',
          '**/.turbo',
          '**/coverage',
          '**/*.log',
        ],
      }
      
      // Force memory cache in WSL2 for maximum stability
      // Filesystem cache is too unreliable on WSL2
      if (process.env.WSL_DISTRO_NAME || process.env.WEBPACK_CACHE_TYPE === 'memory') {
        config.cache = { 
          type: 'memory',
          maxGenerations: 1, // Aggressive memory cleanup
        }
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
        }
      }
      
      // Optimize for stability over speed in WSL2
      if (process.env.WSL_DISTRO_NAME) {
        config.parallelism = 1
        config.optimization = {
          ...config.optimization,
          removeAvailableModules: false,
          removeEmptyChunks: false,
        }
      }
    }
    return config
  },

  // Inject build timestamp into environment
  env: {
    BUILD_TIMESTAMP: new Date().toISOString(),
  },
  
  // Allow cross-origin requests in development
  allowedDevOrigins: ['172.24.178.199'],
  
  // Server configuration (disabled for static export)
  // async rewrites() {
  //   return []
  // },
  
  // Note: assetPrefix now set above for GitHub Pages
  
  // Removed experimental features that were causing instability
  // experimental: {
  //   forceSwcTransforms: true,
  // },
};

export default nextConfig;
