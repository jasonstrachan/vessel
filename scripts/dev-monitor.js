#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let devProcess = null;
let restartCount = 0;
let restartTimer = null;
let lastCrashTime = null;
let crashCount = 0;

const MAX_QUICK_CRASHES = 3;
const CRASH_TIME_WINDOW = 10000; // 10 seconds

function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    info: '📘',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    restart: '🔄'
  }[type] || '📝';
  
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

function checkQuickCrashes() {
  const now = Date.now();
  
  if (lastCrashTime && (now - lastCrashTime) < CRASH_TIME_WINDOW) {
    crashCount++;
    if (crashCount >= MAX_QUICK_CRASHES) {
      log(`Too many crashes in quick succession (${crashCount} in ${CRASH_TIME_WINDOW/1000}s)`, 'error');
      log('Cleaning cache and waiting 5 seconds before restart...', 'warning');
      
      // Clean .next cache
      const nextDir = path.join(process.cwd(), '.next');
      if (fs.existsSync(nextDir)) {
        try {
          fs.rmSync(nextDir, { recursive: true, force: true });
          log('Cache cleaned', 'success');
        } catch (err) {
          log(`Failed to clean cache: ${err.message}`, 'error');
        }
      }
      
      crashCount = 0;
      return 5000; // Wait 5 seconds after cleaning cache
    }
  } else {
    crashCount = 1;
  }
  
  lastCrashTime = now;
  return 2000; // Normal 2 second wait
}

function startDevServer() {
  restartCount++;
  log(`Starting development server (attempt ${restartCount})...`, 'info');
  
  // Use the existing dev-server.js which has built-in restart logic
  devProcess = spawn('node', ['scripts/dev-server.js'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'development'
    }
  });

  devProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      log(`Dev server crashed with code ${code}`, 'error');
      
      // Clear any existing restart timer
      if (restartTimer) {
        clearTimeout(restartTimer);
      }
      
      // Check for rapid crashes and determine wait time
      const waitTime = checkQuickCrashes();
      
      log(`Restarting in ${waitTime/1000} seconds...`, 'restart');
      restartTimer = setTimeout(() => {
        startDevServer();
      }, waitTime);
      
    } else if (signal === 'SIGINT' || signal === 'SIGTERM') {
      log('Dev server stopped by user', 'success');
      process.exit(0);
    } else if (code === 0) {
      log('Dev server exited normally', 'info');
      // Restart even on normal exit to keep server running
      log('Restarting in 2 seconds...', 'restart');
      restartTimer = setTimeout(() => {
        startDevServer();
      }, 2000);
    }
  });

  devProcess.on('error', (err) => {
    log(`Failed to start dev server: ${err.message}`, 'error');
    
    // Try to restart after error
    log('Attempting restart in 5 seconds...', 'restart');
    restartTimer = setTimeout(() => {
      startDevServer();
    }, 5000);
  });
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  log('Stopping dev monitor...', 'warning');
  if (devProcess) {
    devProcess.kill('SIGINT');
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (devProcess) {
    devProcess.kill('SIGTERM');
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  process.exit(0);
});

// Start the monitor
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎨 TinyBrush Dev Server Monitor');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Features:');
console.log('  • Auto-restart on crash');
console.log('  • Smart crash detection');
console.log('  • Automatic cache cleaning');
console.log('  • Continuous monitoring');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Press Ctrl+C to stop\n');

startDevServer();