import type { NextConfig } from "next";
import path from "path";

const isProd = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  // Only use static export and GitHub Pages config in production
  ...(isProd && {
    output: 'export',
    trailingSlash: true,
    basePath: '/tinybrush',
    assetPrefix: '/tinybrush/',
  }),
  images: {
    unoptimized: true,
  },
  
  // Ensure proper development server configuration
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      // WSL2-optimized watch configuration to prevent cache corruption
      config.watchOptions = {
        // Slower polling prevents file system race conditions in WSL2
        poll: 3000,
        // Longer aggregate timeout for WSL2 file system latency
        aggregateTimeout: 1000,
        // Ignore paths that don't need watching
        ignored: [
          '**/node_modules',
          '**/.git',
          '**/.next',
          '**/dist',
          '**/build',
          '**/.turbo',
          '**/coverage',
        ],
      }
      
      // Configure cache to be more resilient to file system race conditions
      // Fall back to memory cache if environment variable is set
      if (process.env.WEBPACK_CACHE_TYPE === 'memory') {
        config.cache = { type: 'memory' }
      } else {
        config.cache = {
          type: 'filesystem',
          cacheDirectory: path.resolve('.next/cache/webpack'),
          // Increase cache write timeout for WSL2
          idleTimeout: 30000,
          idleTimeoutAfterLargeChanges: 5000,
          // Use pack store for atomic writes
          store: 'pack',
          compression: false, // Disable compression to reduce write complexity
        }
      }
      
      // Reduce parallelism to prevent concurrent cache access
      config.parallelism = 1
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
