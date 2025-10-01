#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourcePath = path.join(projectRoot, 'src/utils/alignment/alignFitResolver.ts');
const outputPath = path.join(projectRoot, 'public/goblet/AlignFitResolver.js');

const source = fs.readFileSync(sourcePath, 'utf8');

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.ES2020,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    removeComments: false,
    sourceMap: false,
    esModuleInterop: true
  },
  reportDiagnostics: true
});

const banner = '// Auto-generated from src/utils/alignment/alignFitResolver.ts. Do not edit directly.\n';
fs.writeFileSync(outputPath, banner + outputText, 'utf8');

console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
