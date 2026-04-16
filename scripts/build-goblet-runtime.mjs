#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const readGobletAsset = (dir, filename) => {
  const filePath = path.resolve(dir, filename);
  return fs.readFileSync(filePath, 'utf8');
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripModuleImportStatement = (content, modulePath) => {
  const escaped = escapeRegExp(modulePath);
  const pattern = new RegExp(
    `\\s*import\\s+(?:[\\w*$\\s{},]+?)\\s+from\\s+['\"]${escaped}['\"];?\\s*`,
    'g'
  );
  return content.replace(pattern, '\n');
};

const stripAllStaticImports = (content) => {
  return content.replace(/\s*import\s+(?:[\w*$\s{},]+?\s+from\s+)?['\"][^'\"]+['\"];?\s*/g, '\n');
};

const stripGobletExports = (code) => {
  return code
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '');
};

const buildInlineAlignRuntime = (alignJs) => {
  const withoutSpecificImports = stripModuleImportStatement(alignJs, './num.js');
  const withoutAliasImports = stripModuleImportStatement(withoutSpecificImports, '@/utils/num');
  const withoutImports = stripAllStaticImports(withoutAliasImports);
  const sanitized = withoutImports
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .trim();

  if (!sanitized) {
    return '';
  }

  const exports = ['normalizeAlignment', 'computeLayerTransform', 'computeLayerDestination'];
  const exportList = exports.join(', ');
  return `const { ${exportList} } = (() => {\n${sanitized}\nreturn { ${exportList} };\n})();`;
};

const buildInlineInflateRuntime = (inflateJs) => {
  let sanitized = inflateJs
    .replace(/export\s+default\s+inflateRaw;?/g, '')
    .replace(/export\s+\{\s*inflateRaw\s*\};?/g, '')
    .replace(/export\s+const\s+inflateRaw\s*=\s*/g, 'const inflateRaw = ');
  sanitized = sanitized.trimEnd();
  return `const inflateRaw = (() => {\n${sanitized}\nreturn inflateRaw;\n})();`;
};

const buildInlineNumRuntime = (numJs) => {
  const sanitized = numJs
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .trim();
  return sanitized ? `${sanitized}\n` : '';
};

const buildInlineDisplayFilterRuntime = (pipelineJs) => {
  const sanitized = pipelineJs
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .trim();
  if (!sanitized) {
    return '';
  }

  const exports = [
    'getSeamlessNoisePatternSize',
    'createTileableNoiseGrid',
    'createDisplayFilterPipelineState',
    'getNextFilterWorkCanvas',
    'ensureDisplayFilterCanvas',
    'clearDisplayFilterCanvas',
    'getDisplayFilterByIdFromList',
    'hasEnabledDisplayFiltersInList',
    'applyDisplayFilterStack',
  ];
  const exportList = exports.join(', ');
  return `const { ${exportList} } = (() => {\n${sanitized}\nreturn { ${exportList} };\n})();`;
};

const sanitizeGobletRuntime = (gobletJs) => {
  const withoutAlign = stripModuleImportStatement(gobletJs, './alignFitResolver.js');
  const withoutNum = stripModuleImportStatement(withoutAlign, './num.js');
  const withoutInflate = stripModuleImportStatement(withoutNum, './fflate-inflate.js');
  const withoutDisplayFilter = stripModuleImportStatement(withoutInflate, './displayFilterPipeline.js');
  const sanitized = stripGobletExports(withoutDisplayFilter).trim();
  return sanitized;
};

const buildRuntimeSource = (dir, runtimeFile) => {
  const gobletJs = readGobletAsset(dir, runtimeFile);
  const alignJs = readGobletAsset(dir, 'alignFitResolver.js');
  const numJs = readGobletAsset(dir, 'num.js');
  const inflateJs = readGobletAsset(dir, 'fflate-inflate.js');
  const displayFilterJs = fs.readFileSync(
    path.resolve(projectRoot, 'src/lib/displayFilterPipeline.js'),
    'utf8',
  );

  const runtimeSections = [];
  const inlineNum = buildInlineNumRuntime(numJs);
  if (inlineNum) {
    runtimeSections.push(inlineNum);
  }
  const inlineDisplayFilter = buildInlineDisplayFilterRuntime(displayFilterJs);
  if (inlineDisplayFilter) {
    runtimeSections.push(inlineDisplayFilter);
  }
  const inlineAlign = buildInlineAlignRuntime(alignJs);
  if (inlineAlign) {
    runtimeSections.push(inlineAlign);
  }
  const gobletRuntime = sanitizeGobletRuntime(gobletJs);
  const inlineInflatePresent = /const\s+inflateRaw\s*=\s*\(\s*\(\s*\)\s*=>/.test(gobletRuntime);
  if (!inlineInflatePresent) {
    const inlineInflate = buildInlineInflateRuntime(inflateJs);
    if (inlineInflate) {
      runtimeSections.push(inlineInflate);
    }
  }
  runtimeSections.push(gobletRuntime);
  return runtimeSections.join('\n');
};

const syncDisplayFilterPipeline = (dir, check) => {
  const source = fs.readFileSync(path.resolve(projectRoot, 'src/lib/displayFilterPipeline.js'), 'utf8');
  const outputFile = path.resolve(dir, 'displayFilterPipeline.js');
  const previous = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
  if (previous === source) {
    return;
  }
  if (check) {
    throw new Error(
      `${path.relative(projectRoot, outputFile)} is out of date. Run: npm run build:goblet-inline`
    );
  }
  fs.writeFileSync(outputFile, source);
  console.log(`Wrote ${path.relative(projectRoot, outputFile)}`);
};

const require = createRequire(import.meta.url);
const terser = require('next/dist/compiled/terser');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const targetArg = args.find((arg) => arg.startsWith('--target='));
  const target = targetArg ? targetArg.slice('--target='.length) : 'all';
  if (!['all', 'goblet', 'goblet2'].includes(target)) {
    throw new Error(`Unsupported --target value: "${target}". Use all|goblet|goblet2.`);
  }
  return { check, target };
};

const buildInlineRuntime = async ({ dir, runtimeFile, outputFile, label, check }) => {
  const runtimeSource = buildRuntimeSource(dir, runtimeFile);
  let minifyResult;
  try {
    minifyResult = await terser.minify(runtimeSource, {
      compress: {
        passes: 2,
        defaults: true,
        module: false
      },
      mangle: true,
      format: {
        ascii_only: true,
        comments: false
      }
    });
  } catch (error) {
    console.error(`[build-goblet-runtime] Failed to minify ${label} runtime`);
    if (error && typeof error.message === 'string') {
      console.error(error.message);
    }
    if (error && typeof error.line === 'number') {
      console.error(`Line: ${error.line}, Column: ${error.col}`);
    }
    throw error;
  }

  if (!minifyResult || typeof minifyResult.code !== 'string') {
    throw new Error(`Failed to minify ${label} runtime.`);
  }

  const banner = '// Auto-generated by scripts/build-goblet-runtime.mjs. Do not edit directly.\n';
  const output = `${banner}${minifyResult.code}\n`;
  const previous = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
  if (previous === output) {
    console.log(`${label} inline runtime already up to date.`);
    return;
  }

  if (check) {
    throw new Error(
      `${path.relative(projectRoot, outputFile)} is out of date. Run: npm run build:goblet-inline`
    );
  }

  fs.writeFileSync(outputFile, output);
  console.log(`Wrote ${path.relative(projectRoot, outputFile)}`);
};

const main = async () => {
  const { check, target } = parseArgs();
  const gobletDir = path.resolve(projectRoot, 'public/goblet');
  const goblet2Dir = path.resolve(projectRoot, 'public/goblet2');

  if (target === 'all' || target === 'goblet') {
    syncDisplayFilterPipeline(gobletDir, check);
    await buildInlineRuntime({
      dir: gobletDir,
      runtimeFile: 'goblet.js',
      outputFile: path.resolve(gobletDir, 'goblet-inline.js'),
      label: 'Goblet',
      check
    });
  }

  if ((target === 'all' || target === 'goblet2') && fs.existsSync(goblet2Dir)) {
    syncDisplayFilterPipeline(goblet2Dir, check);
    await buildInlineRuntime({
      dir: goblet2Dir,
      runtimeFile: 'goblet2.js',
      outputFile: path.resolve(goblet2Dir, 'goblet2-inline.js'),
      label: 'Goblet2',
      check
    });
  }
};

await main();
