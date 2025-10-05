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

function resolveValidatorBinary() {
  const candidates = [
    process.env.NAGA_BIN,
    'naga',
    path.join(os.homedir(), '.cargo', 'bin', 'naga'),
    path.join(repoRoot, 'tools', 'tint', 'tint'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const command = candidate;
    const result = spawnSync(command, ['--version'], {
      stdio: 'ignore',
      cwd: repoRoot,
    });

    if (result.error) {
      continue;
    }

    if (typeof result.status === 'number' && result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function runValidator(validatorBinary, shaderPath) {
  const result = spawnSync(validatorBinary, [shaderPath], {
    stdio: 'inherit',
    cwd: repoRoot,
  });

  if (result.error) {
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

    const validatorBinary = resolveValidatorBinary();
    if (!validatorBinary) {
      console.error('Unable to find a WGSL validator.');
      console.error('Install naga (https://github.com/gfx-rs/naga) or drop a tint binary in tools/tint/tint.');
      console.error('You can also set NAGA_BIN to the validator path before running this script.');
      process.exitCode = 1;
      return;
    }
    console.log(`Using validator: ${validatorBinary}`);

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
        runValidator(validatorBinary, tmpShaderPath);
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
      process.exitCode = 1;
      return;
    }

    console.log('\nAll WGSL shaders validated successfully.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();
