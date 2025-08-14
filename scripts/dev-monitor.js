#!/usr/bin/env node

const { spawn } = require('child_process');
const chalk = require('chalk');

let devProcess = null;
let restartCount = 0;
let restartTimer = null;

function startDevServer() {
  console.log(chalk.blue(`🚀 Starting development server (attempt ${restartCount + 1})...`));
  
  devProcess = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    shell: true
  });

  devProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.log(chalk.red(`\n💥 Dev server crashed with code ${code}`));
      restartCount++;
      
      // Clear any existing restart timer
      if (restartTimer) {
        clearTimeout(restartTimer);
      }
      
      // Wait 2 seconds before restarting to avoid rapid restart loops
      console.log(chalk.yellow(`⏳ Restarting in 2 seconds...`));
      restartTimer = setTimeout(() => {
        startDevServer();
      }, 2000);
    } else if (signal === 'SIGINT' || signal === 'SIGTERM') {
      console.log(chalk.green(`\n✋ Dev server stopped by user`));
      process.exit(0);
    }
  });

  devProcess.on('error', (err) => {
    console.error(chalk.red(`❌ Failed to start dev server: ${err.message}`));
    process.exit(1);
  });
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n🛑 Stopping dev monitor...'));
  if (devProcess) {
    devProcess.kill('SIGINT');
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  process.exit(0);
});

console.log(chalk.green('👁️  Dev server monitor started'));
console.log(chalk.gray('Press Ctrl+C to stop\n'));
startDevServer();