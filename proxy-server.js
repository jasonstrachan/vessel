#!/usr/bin/env node

/**
 * WSL2-Friendly Proxy Server for Vessel
 * 
 * This Express proxy server solves WSL2 networking issues by:
 * 1. Running a stable Express server that WSL2 can handle
 * 2. Proxying requests to the Next.js development server
 * 3. Providing better error handling and logging
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PROXY_PORT = 8080;  // Proxy server port (external access)
const NEXT_PORT = 3000;   // Next.js dev server port (internal)
// Get WSL2 IP dynamically
const { execSync } = require('child_process');
const WSL_IP = execSync('hostname -I').toString().trim().split(' ')[0];

console.log('🚀 Vessel WSL2-Friendly Proxy Server');
console.log('=======================================');

// Enable CORS for all routes
app.use(cors({
  origin: true,
  credentials: true
}));

// Add request logging
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    proxy_port: PROXY_PORT,
    next_port: NEXT_PORT,
    wsl_ip: WSL_IP
  });
});

// Proxy configuration for Next.js
const nextProxy = createProxyMiddleware({
  target: `http://localhost:${NEXT_PORT}`,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying for hot reload
  logLevel: 'info',
  onError: (err, req, res) => {
    console.error('❌ Proxy Error:', err.message);
    res.status(500).json({
      error: 'Next.js server not accessible',
      message: 'Make sure Next.js is running on port ' + NEXT_PORT,
      suggestion: 'Run: npm run dev:backend'
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    // Add headers to help with WSL2 networking
    proxyReq.setHeader('Host', `localhost:${NEXT_PORT}`);
    proxyReq.setHeader('X-Forwarded-For', req.ip);
    proxyReq.setHeader('X-Forwarded-Proto', 'http');
  },
  onProxyRes: (proxyRes, req, res) => {
    // Add CORS headers to proxied responses
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    proxyRes.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS';
    proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Content-Length, X-Requested-With';
  }
});

// Proxy all requests to Next.js (except health check)
app.use('/', nextProxy);

// Start the proxy server
const server = app.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log('');
  console.log('✅ Proxy server running successfully!');
  console.log('=====================================');
  console.log(`📡 Proxy Server:  http://localhost:${PROXY_PORT}`);
  console.log(`🌐 Network Access: http://${WSL_IP}:${PROXY_PORT}`);
  console.log(`🎯 Next.js Target: http://localhost:${NEXT_PORT}`);
  console.log('');
  console.log('🎨 Vessel with optimized pixel drawing ready!');
  console.log('');
  console.log('📋 Quick Commands:');
  console.log('   Health Check: curl http://localhost:8080/health');
  console.log('   Stop Server:  Ctrl+C');
  console.log('');
  console.log('⚠️  Make sure Next.js is running: npm run dev:backend');
  console.log('');
});

// Handle WebSocket upgrade for hot reload
server.on('upgrade', (request, socket, head) => {
  nextProxy.upgrade(request, socket, head);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down proxy server...');
  server.close(() => {
    console.log('✅ Proxy server stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Proxy server terminated');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});