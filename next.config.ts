import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure proper development server configuration
  webpack: (config, { dev }) => {
    if (dev) {
      // Development optimizations
      config.watchOptions = {
        // Increase poll interval to reduce file system pressure
        poll: 5000,
        aggregateTimeout: 300,
        // Ignore node_modules to reduce watching overhead
        ignored: /node_modules/,
      }
      // Use default caching behavior for stability
      // config.cache = false // Removed - this was causing build instability
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
