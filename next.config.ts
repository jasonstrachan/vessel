import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure proper development server configuration
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      // Development optimizations for faster hot reload
      config.watchOptions = {
        // Reduce poll interval for faster change detection (was 5000ms)
        poll: 1000,
        // Batch changes within 200ms window
        aggregateTimeout: 200,
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
      
      // Use default Next.js caching to avoid warnings
      // Custom cache config was causing compiled config warnings
      
      // Keep default source maps to avoid Next.js warnings
      // Next.js handles devtool optimization internally
    }
    return config
  },

  // Inject build timestamp into environment
  env: {
    BUILD_TIMESTAMP: new Date().toISOString(),
  },
  
  // Allow cross-origin requests in development
  allowedDevOrigins: ['172.24.178.199'],
  
  // Server configuration
  async rewrites() {
    return []
  },
  
  // Ensure assets are served correctly
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
  
  // Removed experimental features that were causing instability
  // experimental: {
  //   forceSwcTransforms: true,
  // },
};

export default nextConfig;
