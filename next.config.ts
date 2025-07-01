import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure proper development server configuration
  webpack: (config, { dev }) => {
    if (dev) {
      // Development optimizations
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      }
    }
    return config
  },
  
  // Allow cross-origin requests in development
  allowedDevOrigins: ['172.24.178.199'],
  
  // Server configuration
  async rewrites() {
    return []
  },
  
  // Ensure assets are served correctly
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
};

export default nextConfig;
