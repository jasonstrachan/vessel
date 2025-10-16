#!/usr/bin/env node

/**
 * Auto-commit script for Vessel
 * Automatically creates git commits when features are completed
 * Triggered by console clear or explicit command
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUTO_COMMIT_PREFIX = '✨ Feature:';
const SKIP_PATTERNS = [
  'node_modules',
  '.next',
  '.git',
  'dist',
  'out',
  'coverage',
  '.turbo'
];

function getGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    return status.trim().split('\n').filter(line => line.trim());
  } catch (error) {
    console.error('Error getting git status:', error.message);
    return [];
  }
}

function hasChanges() {
  const changes = getGitStatus();
  return changes.length > 0;
}

function getStagedFiles() {
  try {
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return staged.trim().split('\n').filter(line => line.trim());
  } catch (error) {
    return [];
  }
}

function analyzeChanges() {
  const changes = getGitStatus();
  const summary = {
    added: [],
    modified: [],
    deleted: [],
    untracked: []
  };

  changes.forEach(line => {
    const [status, ...pathParts] = line.trim().split(/\s+/);
    const filePath = pathParts.join(' ');
    
    // Skip files matching skip patterns
    if (SKIP_PATTERNS.some(pattern => filePath.includes(pattern))) {
      return;
    }

    if (status.includes('M')) {
      summary.modified.push(filePath);
    } else if (status.includes('A')) {
      summary.added.push(filePath);
    } else if (status.includes('D')) {
      summary.deleted.push(filePath);
    } else if (status === '??') {
      summary.untracked.push(filePath);
    }
  });

  return summary;
}

function generateCommitMessage(summary) {
  const components = [];
  
  // Analyze file changes to determine feature type
  const allFiles = [...summary.modified, ...summary.added];
  
  if (allFiles.some(f => f.includes('DrawingCanvas'))) {
    components.push('canvas updates');
  }
  if (allFiles.some(f => f.includes('useBrushEngine'))) {
    components.push('brush engine improvements');
  }
  if (allFiles.some(f => f.includes('useAppStore'))) {
    components.push('state management changes');
  }
  if (allFiles.some(f => f.includes('components') && !f.includes('canvas'))) {
    components.push('UI components');
  }
  if (allFiles.some(f => f.includes('hooks'))) {
    components.push('hook updates');
  }
  if (allFiles.some(f => f.includes('types'))) {
    components.push('type definitions');
  }
  if (allFiles.some(f => f.includes('styles') || f.includes('.css'))) {
    components.push('styling');
  }
  
  // Generate descriptive message
  if (components.length === 0) {
    components.push('general improvements');
  }
  
  const message = `${AUTO_COMMIT_PREFIX} ${components.join(', ')}`;
  
  // Add file count details
  const details = [];
  if (summary.added.length > 0) {
    details.push(`${summary.added.length} added`);
  }
  if (summary.modified.length > 0) {
    details.push(`${summary.modified.length} modified`);
  }
  if (summary.deleted.length > 0) {
    details.push(`${summary.deleted.length} deleted`);
  }
  
  return {
    title: message,
    body: details.length > 0 ? `Files: ${details.join(', ')}` : ''
  };
}

function stageAllChanges() {
  try {
    // Stage all tracked changes
    execSync('git add -u', { stdio: 'inherit' });
    
    // Stage specific untracked files (not directories like node_modules)
    const summary = analyzeChanges();
    summary.untracked.forEach(file => {
      if (!SKIP_PATTERNS.some(pattern => file.includes(pattern))) {
        try {
          execSync(`git add "${file}"`, { stdio: 'inherit' });
        } catch (error) {
          console.warn(`Could not stage ${file}:`, error.message);
        }
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error staging changes:', error.message);
    return false;
  }
}

function createCommit(message) {
  try {
    const commitCmd = message.body 
      ? `git commit -m "${message.title}" -m "${message.body}"`
      : `git commit -m "${message.title}"`;
    
    execSync(commitCmd, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error('Error creating commit:', error.message);
    return false;
  }
}

function autoCommit(options = {}) {
  const { message: customMessage, skipStaging = false } = options;
  
  console.log('🔍 Checking for changes...');
  
  if (!hasChanges()) {
    console.log('✅ No changes to commit');
    return false;
  }
  
  const summary = analyzeChanges();
  console.log('📊 Found changes:', {
    modified: summary.modified.length,
    added: summary.added.length,
    deleted: summary.deleted.length,
    untracked: summary.untracked.length
  });
  
  // Stage changes if needed
  if (!skipStaging) {
    console.log('📝 Staging changes...');
    if (!stageAllChanges()) {
      console.error('❌ Failed to stage changes');
      return false;
    }
  }
  
  // Check if there are staged changes
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    console.log('⚠️ No staged changes to commit');
    return false;
  }
  
  // Generate or use custom commit message
  const commitMessage = customMessage 
    ? { title: customMessage, body: '' }
    : generateCommitMessage(summary);
  
  console.log('💾 Creating commit:', commitMessage.title);
  
  if (createCommit(commitMessage)) {
    console.log('✨ Auto-commit successful!');
    
    // Show latest commit
    try {
      const latestCommit = execSync('git log -1 --oneline', { encoding: 'utf8' });
      console.log('📍 Latest commit:', latestCommit.trim());
    } catch (error) {
      // Ignore error
    }
    
    return true;
  }
  
  return false;
}

// Export for use as module
module.exports = { autoCommit, analyzeChanges, hasChanges };

// Run directly if called as script
if (require.main === module) {
  const args = process.argv.slice(2);
  const customMessage = args.join(' ').trim();
  
  autoCommit({ 
    message: customMessage || null,
    skipStaging: false 
  });
}