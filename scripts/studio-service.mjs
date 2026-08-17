#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const SERVICE_LABEL = 'com.jasonstrachan.vessel-studio';
const DEFAULT_PORT = 3010;
const HOST = '127.0.0.1';
const DISPLAY_HOST = 'localhost';
const REBUILD_DEBOUNCE_MS = 1500;
const HEALTH_TIMEOUT_MS = 45_000;
const SERVER_STOP_TIMEOUT_MS = 10_000;
const BUILD_DIRECTORY_NAMES = ['.next-studio-service-a', '.next-studio-service-b'];
const ROOT_WATCH_FILES = new Set([
  'next.config.ts',
  'package.json',
  'package-lock.json',
  'postcss.config.mjs',
  'tailwind.config.ts',
  'tsconfig.json',
  'tsconfig.studio.json',
]);

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const serviceStateRoot = path.join(projectRoot, '.next-studio-service');
const legacyBuildsRoot = path.join(serviceStateRoot, 'builds');
const manifestPath = path.join(serviceStateRoot, 'current.json');
const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const studioLink = path.join(projectRoot, '.vessel-studio', 'extension');

const sleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'pipe',
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0 || options.allowedExitCodes?.includes(code)) {
      resolve({ code, signal, stdout, stderr });
      return;
    }
    const detail = stderr.trim() || stdout.trim() || `exit ${code ?? signal}`;
    reject(new Error(`${command} ${args.join(' ')} failed: ${detail}`));
  });
});

const timestamp = () => new Date().toISOString();
const log = (message) => console.log(`[${timestamp()}] ${message}`);
const logError = (message) => console.error(`[${timestamp()}] ${message}`);

const xmlEscape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export const createLaunchAgentPlist = ({
  nodePath,
  serviceScriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  port = DEFAULT_PORT,
}) => {
  const values = {
    nodePath,
    serviceScriptPath,
    workingDirectory,
    stdoutPath,
    stderrPath,
    port: String(port),
    path: `${path.dirname(nodePath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  for (const [key, value] of Object.entries(values)) {
    if (!value) throw new Error(`LaunchAgent value ${key} is required.`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(serviceScriptPath)}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>NEXT_TELEMETRY_DISABLED</key>
    <string>1</string>
    <key>VESSEL_STUDIO</key>
    <string>1</string>
    <key>STUDIO_PORT</key>
    <string>${xmlEscape(values.port)}</string>
    <key>PATH</key>
    <string>${xmlEscape(values.path)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
};

export const isSafeBuildDirectoryName = (name) => BUILD_DIRECTORY_NAMES.includes(name);

export const isTransientLaunchctlBootstrapError = (error) => (
  error instanceof Error
  && error.message.includes('Bootstrap failed: 5: Input/output error')
);

export const shouldRebuildForPath = (relativePath, { root = false } = {}) => {
  if (!relativePath) return false;
  const normalized = relativePath.split(path.sep).join('/');
  if (root) return ROOT_WATCH_FILES.has(normalized);
  const segments = normalized.split('/');
  return !segments.some((segment) => (
    segment.startsWith('.')
    || segment === '__tests__'
    || segment === 'node_modules'
  ))
    && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized);
};

const readManifest = async () => {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (
      typeof parsed?.buildDirectory !== 'string'
      || !isSafeBuildDirectoryName(parsed.buildDirectory)
      || !Number.isFinite(parsed?.builtAt)
    ) {
      return null;
    }
    const absoluteBuildDirectory = path.resolve(projectRoot, parsed.buildDirectory);
    if (absoluteBuildDirectory !== path.join(projectRoot, parsed.buildDirectory)) return null;
    if (!existsSync(path.join(absoluteBuildDirectory, 'BUILD_ID'))) return null;
    return {
      buildDirectory: parsed.buildDirectory,
      absoluteBuildDirectory,
      builtAt: parsed.builtAt,
    };
  } catch {
    return null;
  }
};

const writeManifest = async ({ buildDirectory, builtAt }) => {
  await mkdir(serviceStateRoot, { recursive: true });
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ buildDirectory, builtAt }, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, manifestPath);
};

const newestMtime = async (targetPath) => {
  try {
    const targetStat = await stat(targetPath);
    if (!targetStat.isDirectory()) return targetStat.mtimeMs;
    let newest = targetStat.mtimeMs;
    const entries = await readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!shouldRebuildForPath(entry.name)) continue;
      newest = Math.max(newest, await newestMtime(path.join(targetPath, entry.name)));
    }
    return newest;
  } catch {
    return 0;
  }
};

const resolvePrivateExtensionRoot = async () => {
  try {
    return await realpath(studioLink);
  } catch {
    throw new Error(`Studio extension is not connected at ${studioLink}.`);
  }
};

const latestSourceMtime = async (privateExtensionRoot) => {
  const roots = [
    path.join(projectRoot, 'src'),
    path.join(projectRoot, 'public'),
    privateExtensionRoot,
  ];
  let newest = 0;
  for (const root of roots) newest = Math.max(newest, await newestMtime(root));
  for (const filename of ROOT_WATCH_FILES) {
    newest = Math.max(newest, await newestMtime(path.join(projectRoot, filename)));
  }
  return newest;
};

const studioEnvironment = (buildDirectory) => ({
  ...process.env,
  HOSTNAME: HOST,
  NEXT_DIST_DIR: buildDirectory,
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_ENV: 'production',
  PORT: String(Number.parseInt(process.env.STUDIO_PORT ?? '', 10) || DEFAULT_PORT),
  VESSEL_STUDIO: '1',
});

const waitForHealth = async (child, port) => {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Studio server exited before becoming healthy (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(`http://${HOST}:${port}/`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await sleep(500);
  }
  throw new Error(`Studio server did not become healthy within ${HEALTH_TIMEOUT_MS / 1000} seconds.`);
};

const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + SERVER_STOP_TIMEOUT_MS;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
};

const startNextServer = async (buildDirectory, port) => {
  log(`Starting production studio server from ${buildDirectory}.`);
  const child = spawn(process.execPath, [nextBin, 'start', '-H', HOST, '-p', String(port)], {
    cwd: projectRoot,
    env: studioEnvironment(buildDirectory),
    stdio: 'inherit',
  });
  child.once('error', (error) => logError(`Studio server process error: ${error.message}`));
  await waitForHealth(child, port);
  log(`Studio is ready at http://${HOST}:${port}.`);
  return child;
};

const buildStudio = async (currentBuildDirectory) => {
  if (!existsSync(nextBin)) {
    throw new Error('Next.js is not installed. Run npm install in the Vessel repository.');
  }
  await resolvePrivateExtensionRoot();
  const relativeBuildDirectory = BUILD_DIRECTORY_NAMES.find(
    (name) => name !== currentBuildDirectory,
  ) ?? BUILD_DIRECTORY_NAMES[0];
  const absoluteBuildDirectory = path.join(projectRoot, relativeBuildDirectory);
  await rm(absoluteBuildDirectory, { recursive: true, force: true });
  log(`Building private studio bundle into ${relativeBuildDirectory}.`);
  const result = await run(process.execPath, [nextBin, 'build'], {
    env: studioEnvironment(relativeBuildDirectory),
    stdio: 'inherit',
  }).catch(async (error) => {
    await rm(absoluteBuildDirectory, { recursive: true, force: true });
    throw error;
  });
  void result;
  if (!existsSync(path.join(absoluteBuildDirectory, 'BUILD_ID'))) {
    await rm(absoluteBuildDirectory, { recursive: true, force: true });
    throw new Error('Studio build completed without a BUILD_ID marker.');
  }
  return {
    buildDirectory: relativeBuildDirectory,
    absoluteBuildDirectory,
    builtAt: Date.now(),
  };
};

const watchSources = async (privateExtensionRoot, onChange) => {
  const { watch } = await import('node:fs');
  const watchers = [];
  const addRecursiveWatch = (root) => {
    const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (shouldRebuildForPath(filename?.toString() ?? '')) onChange();
    });
    watcher.on('error', (error) => logError(`Source watcher failed for ${root}: ${error.message}`));
    watchers.push(watcher);
  };
  addRecursiveWatch(path.join(projectRoot, 'src'));
  addRecursiveWatch(path.join(projectRoot, 'public'));
  addRecursiveWatch(privateExtensionRoot);
  const rootWatcher = watch(projectRoot, { recursive: false }, (_eventType, filename) => {
    if (shouldRebuildForPath(filename?.toString() ?? '', { root: true })) onChange();
  });
  rootWatcher.on('error', (error) => logError(`Project watcher failed: ${error.message}`));
  watchers.push(rootWatcher);
  return () => watchers.forEach((watcher) => watcher.close());
};

const runSupervisor = async () => {
  const port = Number.parseInt(process.env.STUDIO_PORT ?? '', 10) || DEFAULT_PORT;
  const privateExtensionRoot = await resolvePrivateExtensionRoot();
  let current = await readManifest();
  let server = null;
  let isBuilding = false;
  let rebuildRequested = false;
  let rebuildTimer = null;
  let isShuttingDown = false;

  const activateServer = async (buildDirectory) => {
    const child = await startNextServer(buildDirectory, port);
    server = child;
    child.on('exit', (code, signal) => {
      if (server === child && !isShuttingDown && !isBuilding) {
        logError(`Studio server exited unexpectedly (${code ?? signal}); terminating for launchd restart.`);
        process.exit(1);
      }
    });
  };

  const switchToFreshBuild = async () => {
    if (isBuilding || isShuttingDown) {
      rebuildRequested = true;
      return;
    }
    isBuilding = true;
    rebuildRequested = false;
    const previous = current;
    try {
      const fresh = await buildStudio(previous?.buildDirectory);
      await stopChild(server);
        server = null;
      try {
        await activateServer(fresh.buildDirectory);
        current = fresh;
        await writeManifest(fresh);
      } catch (error) {
        logError(`Fresh studio bundle could not start: ${error.message}`);
        if (previous) {
          log('Restarting the last successful studio bundle.');
          await activateServer(previous.buildDirectory);
          current = previous;
        } else {
          throw error;
        }
      }
    } catch (error) {
      logError(`Studio rebuild failed; keeping the last successful bundle: ${error.message}`);
    } finally {
      isBuilding = false;
      if (rebuildRequested && !isShuttingDown) scheduleRebuild();
    }
  };

  const scheduleRebuild = () => {
    rebuildRequested = true;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      void switchToFreshBuild();
    }, REBUILD_DEBOUNCE_MS);
  };

  if (current) {
    try {
      await activateServer(current.buildDirectory);
    } catch (error) {
      logError(`Stored studio bundle is unusable: ${error.message}`);
      current = null;
    }
  }
  if (!current) await switchToFreshBuild();
  if (!server) throw new Error('No healthy studio bundle is available.');

  const closeWatchers = await watchSources(privateExtensionRoot, scheduleRebuild);
  if (current && await latestSourceMtime(privateExtensionRoot) > current.builtAt) {
    log('Source is newer than the active studio bundle; scheduling a background rebuild.');
    scheduleRebuild();
  }

  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log(`Received ${signal}; stopping studio service.`);
    if (rebuildTimer) clearTimeout(rebuildTimer);
    closeWatchers();
    await stopChild(server);
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
};

const servicePaths = () => {
  const home = os.homedir();
  const logsDirectory = path.join(home, 'Library', 'Logs', 'Vessel Studio');
  return {
    domain: `gui/${process.getuid()}`,
    plistPath: path.join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`),
    logsDirectory,
    stdoutPath: path.join(logsDirectory, 'output.log'),
    stderrPath: path.join(logsDirectory, 'error.log'),
  };
};

const installService = async () => {
  if (process.platform !== 'darwin' || typeof process.getuid !== 'function') {
    throw new Error('The persistent studio service currently requires macOS launchd.');
  }
  await resolvePrivateExtensionRoot();
  if (!existsSync(nextBin)) throw new Error('Next.js is not installed. Run npm install first.');
  const paths = servicePaths();
  await mkdir(path.dirname(paths.plistPath), { recursive: true });
  await mkdir(paths.logsDirectory, { recursive: true });
  const plist = createLaunchAgentPlist({
    nodePath: process.execPath,
    serviceScriptPath: scriptPath,
    workingDirectory: projectRoot,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    port: DEFAULT_PORT,
  });
  const temporaryPath = `${paths.plistPath}.tmp`;
  await writeFile(temporaryPath, plist, 'utf8');
  await run('/usr/bin/plutil', ['-lint', temporaryPath]);
  await rename(temporaryPath, paths.plistPath);
  await run('/bin/launchctl', ['bootout', `${paths.domain}/${SERVICE_LABEL}`], {
    allowedExitCodes: [3, 113],
  }).catch(() => undefined);
  await rm(legacyBuildsRoot, { recursive: true, force: true });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await run('/bin/launchctl', ['bootstrap', paths.domain, paths.plistPath]);
      break;
    } catch (error) {
      if (!isTransientLaunchctlBootstrapError(error) || attempt === 3) throw error;
      await sleep(attempt * 1000);
    }
  }
  await run('/bin/launchctl', ['enable', `${paths.domain}/${SERVICE_LABEL}`]);
  await run('/bin/launchctl', ['kickstart', '-k', `${paths.domain}/${SERVICE_LABEL}`]);
  console.log(`Installed ${SERVICE_LABEL}.`);
  console.log(`Studio URL: http://${DISPLAY_HOST}:${DEFAULT_PORT}`);
  console.log(`Logs: ${paths.logsDirectory}`);
};

const uninstallService = async () => {
  const paths = servicePaths();
  await run('/bin/launchctl', ['bootout', `${paths.domain}/${SERVICE_LABEL}`], {
    allowedExitCodes: [3, 113],
  }).catch(() => undefined);
  await rm(paths.plistPath, { force: true });
  console.log(`Uninstalled ${SERVICE_LABEL}. Generated studio builds and logs were preserved.`);
};

const readServiceState = async () => {
  const paths = servicePaths();
  const result = await run('/bin/launchctl', ['print', `${paths.domain}/${SERVICE_LABEL}`], {
    allowedExitCodes: [3, 113],
  });
  if (result.code !== 0) return { installed: existsSync(paths.plistPath), state: 'not-loaded' };
  const state = /^\s*state = (.+)$/m.exec(result.stdout)?.[1] ?? 'unknown';
  const pid = /^\s*pid = (\d+)$/m.exec(result.stdout)?.[1] ?? null;
  return { installed: true, state, pid };
};

const printStatus = async () => {
  const state = await readServiceState();
  const current = await readManifest();
  let health = 'unreachable';
  try {
    const response = await fetch(`http://${HOST}:${DEFAULT_PORT}/`, { cache: 'no-store' });
    health = response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`;
  } catch {
    // Leave the service marked unreachable.
  }
  console.log(`LaunchAgent: ${state.state}${state.pid ? ` (PID ${state.pid})` : ''}`);
  console.log(`Studio URL: http://${DISPLAY_HOST}:${DEFAULT_PORT} (${health})`);
  console.log(`Active build: ${current?.buildDirectory ?? 'none'}`);
};

const restartService = async () => {
  const paths = servicePaths();
  await run('/bin/launchctl', ['kickstart', '-k', `${paths.domain}/${SERVICE_LABEL}`]);
  console.log(`Restarted ${SERVICE_LABEL}.`);
};

const printLogs = async ({ follow = false } = {}) => {
  const paths = servicePaths();
  const files = [paths.stdoutPath, paths.stderrPath].filter((file) => existsSync(file));
  if (files.length === 0) {
    console.log(`No studio service logs exist yet in ${paths.logsDirectory}.`);
    return;
  }
  if (follow) {
    const child = spawn('/usr/bin/tail', ['-n', '100', '-f', ...files], { stdio: 'inherit' });
    await new Promise((resolve) => child.once('exit', resolve));
    return;
  }
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n').slice(-100);
    console.log(`\n==> ${file} <==`);
    console.log(lines.join('\n'));
  }
};

const main = async () => {
  const command = process.argv[2] ?? 'status';
  if (command === 'run') await runSupervisor();
  else if (command === 'install') await installService();
  else if (command === 'uninstall') await uninstallService();
  else if (command === 'status') await printStatus();
  else if (command === 'restart') await restartService();
  else if (command === 'logs') await printLogs({ follow: process.argv.includes('--follow') });
  else throw new Error(`Unknown command "${command}". Use install, status, restart, logs, uninstall, or run.`);
};

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
  main().catch((error) => {
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
