import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  createLaunchAgentPlist,
  isSafeBuildDirectoryName,
  isTransientLaunchctlBootstrapError,
  shouldRebuildForPath,
} from '../../scripts/studio-service.mjs';

test('creates a production LaunchAgent using the pinned Node binary', () => {
  const plist = createLaunchAgentPlist({
    nodePath: '/opt/node & tools/bin/node',
    serviceScriptPath: '/work/Vessel Studio/scripts/studio-service.mjs',
    workingDirectory: '/work/Vessel Studio',
    stdoutPath: '/logs/output.log',
    stderrPath: '/logs/error.log',
    port: 3010,
  });

  assert.match(plist, /<string>com\.jasonstrachan\.vessel-studio<\/string>/);
  assert.match(plist, /<string>\/opt\/node &amp; tools\/bin\/node<\/string>/);
  assert.match(plist, /<string>3010<\/string>/);
  assert.match(plist, /<key>VESSEL_STUDIO<\/key>/);
  assert.match(plist, /<key>KeepAlive<\/key>/);
});

test('accepts only generated versioned build directory names', () => {
  assert.equal(isSafeBuildDirectoryName('.next-studio-service-a'), true);
  assert.equal(isSafeBuildDirectoryName('.next-studio-service-b'), true);
  assert.equal(isSafeBuildDirectoryName('../.next-studio-service-a'), false);
  assert.equal(isSafeBuildDirectoryName('.next-studio-service-current'), false);
});

test('ignores tests and hidden output while watching source files', () => {
  assert.equal(shouldRebuildForPath(path.join('components', 'Canvas.tsx')), true);
  assert.equal(
    shouldRebuildForPath(path.join('components', '__tests__', 'Canvas.test.tsx')),
    false,
  );
  assert.equal(shouldRebuildForPath('.next-studio/build.js'), false);
  assert.equal(shouldRebuildForPath('next.config.ts', { root: true }), true);
  assert.equal(shouldRebuildForPath('README.md', { root: true }), false);
});

test('retries only the known transient launchctl bootstrap failure', () => {
  assert.equal(
    isTransientLaunchctlBootstrapError(
      new Error('launchctl failed: Bootstrap failed: 5: Input/output error'),
    ),
    true,
  );
  assert.equal(
    isTransientLaunchctlBootstrapError(new Error('Bootstrap failed: 122: Path had bad ownership')),
    false,
  );
});
