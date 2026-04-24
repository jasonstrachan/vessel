#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = process.cwd();
const mode = process.argv.includes('--strict') ? 'strict' : 'report';

const budgets = [
  { path: 'src/components/canvas/DrawingCanvas.tsx', max: 700, status: 'blocking' },
  { path: 'src/hooks/useDrawingHandlers.ts', max: 700, status: 'blocking' },
  { path: 'src/hooks/canvas/useCanvasEventHandlers.ts', max: 700, status: 'blocking' },
  { path: 'src/stores/slices/layersSlice.ts', max: 900, status: 'blocking' },
  { path: 'src/stores/layers/createLayersSlice.ts', max: 3500, status: 'blocking' },
  { path: 'src/utils/export/webglExporter.ts', max: 600, status: 'blocking' },
  { path: 'src/hooks/canvas/handlers/pointerHandlers.ts', max: 900, status: 'report-until-phase-4' },
  { path: 'src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts', max: 900, status: 'report-until-phase-4' },
];

const countLines = (filePath) => {
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) {
    return 0;
  }
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
};

const rows = budgets.map((budget) => {
  const absolutePath = resolve(root, budget.path);
  if (!existsSync(absolutePath)) {
    return {
      ...budget,
      lines: null,
      result: 'missing',
      message: `${budget.path} is missing`,
    };
  }

  const lines = countLines(absolutePath);
  const isOverBudget = lines > budget.max;
  const isBlocking = budget.status === 'blocking' || mode === 'strict';
  return {
    ...budget,
    lines,
    result: isOverBudget ? (isBlocking ? 'fail' : 'warn') : 'pass',
    message: `${relative(root, absolutePath)}: ${lines}/${budget.max} LOC (${budget.status})`,
  };
});

const failures = rows.filter((row) => row.result === 'fail' || row.result === 'missing');
const warnings = rows.filter((row) => row.result === 'warn');

console.log('[architecture:file-budgets]');
for (const row of rows) {
  const marker = row.result === 'pass' ? 'PASS' : row.result === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${marker} ${row.message}`);
}

if (warnings.length > 0 && failures.length === 0) {
  console.log(`WARN ${warnings.length} file budget issue(s) are in report mode.`);
}

if (failures.length > 0) {
  console.error(`FAIL ${failures.length} blocking file budget issue(s) found.`);
  process.exitCode = 1;
}
