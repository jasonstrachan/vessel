#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const CACHE_DIRS = ['.next', 'node_modules/.cache', '.turbo'];
const MAX_RETRIES = 3;
const RESTART_DELAY = 2000;
const PORT = process.env.PORT || 3000;

let server = null;
let retryCount = 0;
let isShuttingDown = false;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port, '127.0.0.1');
  });
}

async function killPortProcess(port) {
  try {
    console.log(`🔍 Checking for process on port ${port}...`);
    const pid = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    if (pid) {
      console.log(`⚠️  Found process ${pid} on port ${port}, killing it...`);
      process.kill(parseInt(pid), 'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (err) {
    // Ignore errors - port might be free
  }
}

function cleanCache() {
  console.log('🧹 Cleaning cache directories...');
  CACHE_DIRS.forEach(dir => {
    const fullPath = path.join(process.cwd(), dir);
    if (fs.existsSync(fullPath)) {
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`  ✓ Removed ${dir}`);
      } catch (err) {
        console.log(`  ⚠ Could not remove ${dir}: ${err.message}`);
      }
    }
  });
}

async function startServer(cleanFirst = false) {
  if (isShuttingDown) return;
  
  if (cleanFirst) {
    cleanCache();
  }
  
  // Check and free port if needed
  const portAvailable = await isPortAvailable(PORT);
  if (!portAvailable) {
    await killPortProcess(PORT);
  }
  
  console.log(`🚀 Starting Next.js dev server on port ${PORT} (attempt ${retryCount + 1})...`);
  
  // Force memory cache and WSL2 optimizations
  const env = { 
    ...process.env, 
    WEBPACK_CACHE_TYPE: 'memory',
    WSL_DISTRO_NAME: '1', // Force WSL2 optimizations
    NODE_OPTIONS: '--max-old-space-size=4096', // Increase memory limit
    PORT: PORT
  };
  
  server = spawn('npm', ['run', 'dev:safe'], {
    stdio: 'inherit',
    env,
    shell: true
  });
  
  server.on('exit', (code, signal) => {
    if (isShuttingDown) return;
    
    console.log(`\n⚠️  Dev server exited with code ${code} (signal: ${signal})`);
    
    // Only restart on actual failures (non-zero exit codes)
    // Code 0 means normal exit - don't restart
    if (code !== 0 && code !== null) {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        
        console.log(`🔄 Auto-restarting in ${RESTART_DELAY/1000} seconds (attempt ${retryCount}/${MAX_RETRIES})...`);
        
        // Clean cache on every other retry
        const shouldClean = retryCount % 2 === 0;
        
        setTimeout(() => {
          startServer(shouldClean);
        }, RESTART_DELAY);
      } else {
        console.log('❌ Max retries reached. Performing full cache clean and final attempt...');
        retryCount = 0;
        cleanCache();
        setTimeout(() => {
          startServer(false);
        }, RESTART_DELAY);
      }
    } else if (code === 0) {
      console.log('✅ Dev server exited normally');
      process.exit(0);
    }
  });
  
  server.on('error', (err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  isShuttingDown = true;
  if (server) {
    server.kill('SIGTERM');
  }
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

process.on('SIGTERM', () => {
  isShuttingDown = true;
  if (server) {
    server.kill('SIGTERM');
  }
  process.exit(0);
});

// Monitor .next directory for corruption
let corruptionCheckInterval = setInterval(() => {
  if (isShuttingDown) {
    clearInterval(corruptionCheckInterval);
    return;
  }
  
  const nextDir = path.join(process.cwd(), '.next');
  if (fs.existsSync(nextDir)) {
    try {
      // Check if we can access the cache
      const cacheDir = path.join(nextDir, 'cache');
      if (fs.existsSync(cacheDir)) {
        fs.readdirSync(cacheDir);
      }
    } catch (err) {
      console.log('\n⚠️  Detected cache corruption:', err.message);
      console.log('🔄 Restarting with clean cache...');
      
      if (server) {
        server.kill('SIGTERM');
      }
      
      setTimeout(() => {
        retryCount = 0;
        startServer(true);
      }, 1000);
    }
  }
}, 30000); // Check every 30 seconds

// Start the server
console.log('🎨 TinyBrush Development Server Manager');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('This wrapper provides:');
console.log('  • Auto-recovery from crashes');
console.log('  • Cache corruption detection');
console.log('  • Automatic cache cleaning');
console.log('  • Memory-based caching for stability');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

startServer(false);