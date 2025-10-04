#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const shaderRoot = path.join(repoRoot, 'src', 'lib', 'shapeFill', 'gpu', 'shaders');

async function collectShaderFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectShaderFiles(entryPath);
    }
    if (entry.name.endsWith('.wgsl') || entry.name.endsWith('.wgsl.ts')) {
      return [entryPath];
    }
    return [];
  }));
  return files.flat();
}

function extractShaderSource(contents, filePath) {
  const matches = [...contents.matchAll(/`([\s\S]*?)`/g)];
  if (matches.length === 0) {
    throw new Error(`No WGSL template literal found in ${filePath}`);
  }
  const [, source] = matches[matches.length - 1];
  return source;
}

function runValidator(shaderPath) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, ['--no-install', '@webgpu/validator', shaderPath], {
    stdio: 'inherit',
    cwd: repoRoot,
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('npx not found. Ensure Node.js is installed.');
    }
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error('Validator reported an error (see log above).');
  }
}

(async () => {
  try {
    const shaderFiles = await collectShaderFiles(shaderRoot);
    if (shaderFiles.length === 0) {
      console.log('No WGSL shaders found.');
      return;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-wgsl-'));
    const failures = [];

    for (const filePath of shaderFiles) {
      const contents = await fs.readFile(filePath, 'utf8');
      let shaderSource;
      try {
        shaderSource = extractShaderSource(contents, filePath);
      } catch (error) {
        failures.push({ filePath, message: error.message });
        continue;
      }

      const tmpShaderPath = path.join(tmpDir, `${path.basename(filePath)}.wgsl`);
      await fs.writeFile(tmpShaderPath, shaderSource, 'utf8');

      try {
        console.log(`\nValidating ${path.relative(repoRoot, filePath)}...`);
        runValidator(tmpShaderPath);
      } catch (error) {
        failures.push({ filePath, message: error.message });
      }
    }

    await fs.rm(tmpDir, { recursive: true, force: true });

    if (failures.length > 0) {
      console.error('\nWGSL validation failed:');
      for (const failure of failures) {
        console.error(` - ${path.relative(repoRoot, failure.filePath)}: ${failure.message}`);
      }
      console.error('\nInstall the validator with `npm install --save-dev @webgpu/validator` and rerun once network access is available.');
      process.exitCode = 1;
      return;
    }

    console.log('\nAll WGSL shaders validated successfully.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();
