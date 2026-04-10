#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const CACHE_DIRS = ['.next', 'node_modules/.cache', '.turbo'];
const MAX_RETRIES = 3;
const RESTART_DELAY = 2000;
const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = process.cwd();

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readListeningPids(port) {
  try {
    const raw = execSync(
      `lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

function readCommandForPid(pid) {
  try {
    return execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

function readCwdForPid(pid) {
  try {
    const raw = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null || true`, {
      encoding: 'utf8',
    }).trim();
    const cwdLine = raw.split('\n').find(line => line.startsWith('n'));
    return cwdLine ? cwdLine.slice(1) : '';
  } catch (err) {
    return '';
  }
}

function isProjectProcess(pid, command) {
  const cwd = readCwdForPid(pid);
  return cwd === PROJECT_ROOT || command.includes(PROJECT_ROOT);
}

async function stopListeningPid(pid, port) {
  const numericPid = parseInt(pid, 10);
  if (Number.isNaN(numericPid)) {
    return;
  }

  try {
    process.kill(numericPid, 'SIGTERM');
  } catch (err) {
    return;
  }

  await sleep(1500);
  if (!readListeningPids(port).includes(pid)) {
    return;
  }

  try {
    process.kill(numericPid, 'SIGKILL');
  } catch (err) {
    execSync(`kill -9 ${pid} 2>/dev/null || true`);
  }
}

async function killPortProcess(port) {
  try {
    console.log(`🔍 Checking for process on port ${port}...`);

    const pids = readListeningPids(port);
    if (pids.length > 0) {
      console.log(`⚠️  Found process(es) ${pids.join(', ')} on port ${port}.`);
      for (const p of pids) {
        const command = readCommandForPid(p);
        if (!isProjectProcess(p, command)) {
          throw new Error(
            `Port ${port} is already in use by a non-Vessel process: ${command || p}`
          );
        }
        console.log(`⚠️  Stopping Vessel dev listener ${p}: ${command || 'unknown command'}`);
        await stopListeningPid(p, port);
      }
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
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
  
  // Stop only this repo's existing listener on the requested port.
  await killPortProcess(PORT);
  
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

// Check for monitor mode
const args = process.argv.slice(2);
const monitorMode = args.includes('--monitor') || args.includes('-m');

// Start the server
console.log('🎨 Vessel Development Server Manager');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('This wrapper provides:');
console.log('  • Auto-recovery from crashes');
console.log('  • Cache corruption detection');
console.log('  • Automatic cache cleaning');
console.log('  • Memory-based caching for stability');
if (monitorMode) {
  console.log('  • 👁️  MONITOR MODE - Watching existing server');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (monitorMode) {
  // In monitor mode, just watch the port
  console.log('📡 Monitoring mode activated...');
  console.log('ℹ️  Watching for server on port', PORT);
  console.log('   (Server will be auto-started if it crashes)\n');
  
  // Check if server is running
  let checkInterval = setInterval(async () => {
    const available = await isPortAvailable(PORT);
    if (available) {
      console.log('\n⚠️  Server not detected on port', PORT);
      console.log('🚀 Starting new server...\n');
      clearInterval(checkInterval);
      startServer(false);
    }
  }, 5000);
  
  console.log('Press Ctrl+C to stop monitoring\n');
} else {
  startServer(false);
}
