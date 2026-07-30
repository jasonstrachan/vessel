#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PLAYBACK_SENSITIVE_PATTERNS = [
  /^public\/goblet\/alignFitResolver\.js$/,
  /^public\/goblet\/gobletPlaybackMath\.js$/,
  /^public\/goblet\/goblet\.js$/,
  /^public\/goblet\/goblet-inline\.js$/,
  /^public\/goblet2\/alignFitResolver\.js$/,
  /^public\/goblet2\/gobletPayloadContract\.js$/,
  /^public\/goblet2\/gobletPlaybackMath\.js$/,
  /^public\/goblet2\/goblet2\.js$/,
  /^public\/goblet2\/goblet2-inline\.js$/,
  /^src\/lib\/ColorCycleAnimator\.ts$/,
  /^src\/lib\/ColorCycleRenderer\.ts$/,
  /^src\/lib\/GradientPalette\.ts$/,
  /^src\/lib\/IndexBuffer\.ts$/,
  /^src\/lib\/colorCycle\/rendering\//,
  /^src\/lib\/colorCycle\/(?:PaletteController|RecolorEngine|RecolorManager|Renderer2D|flowEncoding|paletteService|materializeColorCycleLayer)\.ts$/,
  /^src\/hooks\/brushEngine\/.*(?:colorCycle|ColorCycle|ccGradient).*\.ts$/,
  /^src\/utils\/export\/goblet\//,
];

const AUTHORING_BUFFER_POLICIES = [
  {
    label: 'color-cycle stroke rasterization',
    sensitivePatterns: [
      /^src\/hooks\/brushEngine\/colorCycleDrawController\.ts$/,
      /^src\/hooks\/brushEngine\/colorCycleStrokeRouting\.ts$/,
    ],
    companionPatterns: [
      /^src\/hooks\/brushEngine\/__tests__\/colorCycleDrawController\.test\.ts$/,
    ],
  },
  {
    label: 'color-cycle shape-fill buffers',
    sensitivePatterns: [
      /^src\/hooks\/brushEngine\/colorCycleShapeFillApiRuntime\.ts$/,
      /^src\/hooks\/brushEngine\/colorCycleShapeFillBuffers\.ts$/,
    ],
    companionPatterns: [
      /^src\/hooks\/brushEngine\/__tests__\/ColorCycleBrushCanvas2D\.regression\.test\.ts$/,
    ],
  },
];

const SHARED_RUNTIME_COMPANION_PATTERNS = [
  /^src\/lib\/displayFilterPipeline\.js$/,
  /^src\/lib\/colorCycle\/document\/colorCycleDocumentContract\.ts$/,
  /^src\/lib\/colorCycle\/gobletPlaybackMath\.js$/,
  /^src\/utils\/alignment\/alignFitResolver\.ts$/,
  /^scripts\/build-align-fit\.mjs$/,
  /^scripts\/build-goblet-runtime\.mjs$/,
];

const PARITY_FIXTURE_COMPANION_PATTERNS = [
  /^tests\/fixtures\/cc\/(?!.*\.manifest\.json$).+\.json$/,
];

const GUARD_ONLY_TESTS = new Set([
  'tests/playback-change-gate.test.ts',
]);

const normalizePath = (filePath) => filePath.replace(/\\/g, '/').replace(/^\.\//, '');

const matchesAny = (filePath, patterns) => patterns.some((pattern) => pattern.test(filePath));

const isTestFile = (filePath) => (
  filePath.includes('/__tests__/') ||
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath)
);

const loadNamedParityCommands = () => {
  const packageJsonPath = 'package.json';
  if (!fs.existsSync(packageJsonPath)) {
    return '';
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const scripts = packageJson.scripts ?? {};
  return [
    scripts['test:cc-runtime-parity'],
    scripts['test:cc-runtime-gpu-parity'],
  ].filter(Boolean).join(' ');
};

const isNamedParityTestCompanion = (filePath, namedParityCommands) => (
  /\.(?:test|spec)\.ts$/.test(filePath) &&
  !GUARD_ONLY_TESTS.has(filePath) &&
  namedParityCommands.includes(filePath)
);

const isCompanionFile = (filePath, namedParityCommands) => (
  matchesAny(filePath, SHARED_RUNTIME_COMPANION_PATTERNS) ||
  matchesAny(filePath, PARITY_FIXTURE_COMPANION_PATTERNS) ||
  isNamedParityTestCompanion(filePath, namedParityCommands)
);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const filesIndex = args.indexOf('--files');
  if (filesIndex >= 0) {
    return {
      mode: 'files',
      files: args.slice(filesIndex + 1),
    };
  }

  const baseIndex = args.indexOf('--base');
  const eventPathIndex = args.indexOf('--event-path');
  return {
    mode: 'git',
    base: baseIndex >= 0 ? args[baseIndex + 1] : null,
    eventPath: eventPathIndex >= 0 ? args[eventPathIndex + 1] : null,
  };
};

const runGit = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const isZeroSha = (value) => /^0+$/.test(value);

const resolvePushBeforeSha = (eventPath) => {
  const resolvedEventPath = eventPath ?? process.env.GITHUB_EVENT_PATH;
  if (!resolvedEventPath || !fs.existsSync(resolvedEventPath)) {
    return null;
  }

  const event = JSON.parse(fs.readFileSync(resolvedEventPath, 'utf8'));
  const before = typeof event.before === 'string' ? event.before.trim() : '';
  return before && !isZeroSha(before) ? before : null;
};

const resolveDiffBase = ({ explicitBase, eventPath }) => {
  if (explicitBase) {
    return explicitBase;
  }

  if (eventPath) {
    const explicitPushBeforeSha = resolvePushBeforeSha(eventPath);
    if (explicitPushBeforeSha) {
      return explicitPushBeforeSha;
    }
  }

  if (process.env.PLAYBACK_GUARD_BASE_SHA) {
    return process.env.PLAYBACK_GUARD_BASE_SHA;
  }

  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    const remoteRef = `origin/${baseRef}`;
    try {
      return runGit(['merge-base', 'HEAD', remoteRef]);
    } catch {
      return remoteRef;
    }
  }

  const pushBeforeSha = resolvePushBeforeSha(null);
  if (pushBeforeSha) {
    return pushBeforeSha;
  }

  return null;
};

const listChangedFiles = ({ mode, files, base, eventPath }) => {
  if (mode === 'files') {
    return files.map(normalizePath).filter(Boolean);
  }

  const diffBase = resolveDiffBase({ explicitBase: base, eventPath });
  if (!diffBase) {
    console.log('[playback-change-gate] No diff base available; checking local HEAD diff.');
    const output = runGit(['diff', '--name-only', 'HEAD']);
    return output.split('\n').map(normalizePath).filter(Boolean);
  }

  const output = runGit(['diff', '--name-only', `${diffBase}...HEAD`]);
  return output.split('\n').map(normalizePath).filter(Boolean);
};

const changedFiles = listChangedFiles(parseArgs());
const namedParityCommands = loadNamedParityCommands();
const playbackSensitiveFiles = changedFiles.filter((filePath) => (
  matchesAny(filePath, PLAYBACK_SENSITIVE_PATTERNS) &&
  !isTestFile(filePath) &&
  !AUTHORING_BUFFER_POLICIES.some((policy) => (
    matchesAny(filePath, policy.sensitivePatterns)
  ))
));
const companionFiles = changedFiles.filter((filePath) => (
  isCompanionFile(filePath, namedParityCommands)
));
const authoringPolicyResults = AUTHORING_BUFFER_POLICIES.map((policy) => ({
  ...policy,
  sensitiveFiles: changedFiles.filter((filePath) => (
    matchesAny(filePath, policy.sensitivePatterns)
  )),
  companionFiles: changedFiles.filter((filePath) => (
    matchesAny(filePath, policy.companionPatterns)
  )),
})).filter((policy) => policy.sensitiveFiles.length > 0);

if (playbackSensitiveFiles.length === 0 && authoringPolicyResults.length === 0) {
  console.log('[playback-change-gate] No playback-sensitive files changed.');
  process.exit(0);
}

const missingPlaybackCompanion = (
  playbackSensitiveFiles.length > 0 &&
  companionFiles.length === 0
);
const missingAuthoringCompanions = authoringPolicyResults.filter((policy) => (
  policy.companionFiles.length === 0
));

if (!missingPlaybackCompanion && missingAuthoringCompanions.length === 0) {
  console.log('[playback-change-gate] Playback-sensitive change has parity/shared companion coverage.');
  if (playbackSensitiveFiles.length > 0) {
    console.log(`Playback-sensitive files:\n${playbackSensitiveFiles.map((filePath) => `  - ${filePath}`).join('\n')}`);
    console.log(`Parity/shared companion files:\n${companionFiles.map((filePath) => `  - ${filePath}`).join('\n')}`);
  }
  for (const policy of authoringPolicyResults) {
    console.log(`Authoring-buffer policy: ${policy.label}`);
    console.log(`Authoring-buffer files:\n${policy.sensitiveFiles.map((filePath) => `  - ${filePath}`).join('\n')}`);
    console.log(`Contract test files:\n${policy.companionFiles.map((filePath) => `  - ${filePath}`).join('\n')}`);
  }
  process.exit(0);
}

if (missingPlaybackCompanion) {
  console.error('[playback-change-gate] Playback-sensitive files changed without a shared-runtime or parity-matrix companion.');
  console.error('Add/update a shared runtime source or parity fixture/test before landing this change.');
  console.error(`Playback-sensitive files:\n${playbackSensitiveFiles.map((filePath) => `  - ${filePath}`).join('\n')}`);
}

for (const policy of missingAuthoringCompanions) {
  console.error(`[playback-change-gate] ${policy.label} changed without its canonical-buffer contract test.`);
  console.error(`Authoring-buffer files:\n${policy.sensitiveFiles.map((filePath) => `  - ${filePath}`).join('\n')}`);
  console.error(`Expected one of:\n${policy.companionPatterns.map((pattern) => `  - ${pattern}`).join('\n')}`);
}

process.exit(1);
