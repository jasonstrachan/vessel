import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const DEEPMERGE_ADVISORY_URL = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';

function isAcceptedNextPostcssFinding(vulnerabilities) {
  const postcss = vulnerabilities.postcss;
  const next = vulnerabilities.next;
  const postcssIsNestedUnderNext = postcss?.nodes?.some(
    (node) => node === 'node_modules/next/node_modules/postcss',
  );
  const postcssRangeMatches = postcss?.range === '<8.5.10';
  const nextViaPostcss = next?.via?.some((via) => {
    if (via === 'postcss') {
      return true;
    }

    return typeof via === 'object' && via !== null && via.name === 'postcss';
  });

  return Boolean(postcssIsNestedUnderNext && postcssRangeMatches && nextViaPostcss);
}

// deepmerge only runs inside the @heroui/theme Tailwind plugin at build time,
// merging Vessel's own static theme config; no user input reaches it.
function isAcceptedHerouiDeepmergeFinding(vulnerabilities) {
  const deepmerge = vulnerabilities.deepmerge;
  const deepmergeIsKnownAdvisory = deepmerge?.severity === 'low'
    && deepmerge.via?.length === 1
    && deepmerge.via[0]?.url === DEEPMERGE_ADVISORY_URL
    && deepmerge.nodes?.every((node) => node === 'node_modules/deepmerge');
  const herouiOnlyViaDeepmerge = Object.entries(vulnerabilities)
    .filter(([name]) => name.startsWith('@heroui/'))
    .every(([, finding]) => finding.severity === 'low' && finding.via?.every(
      (via) => typeof via === 'string' && (via === 'deepmerge' || via.startsWith('@heroui/')),
    ));

  return Boolean(deepmergeIsKnownAdvisory && herouiOnlyViaDeepmerge);
}

const ACCEPTED_FINDINGS = [
  { owns: (name) => name === 'next' || name === 'postcss', accepts: isAcceptedNextPostcssFinding },
  { owns: (name) => name === 'deepmerge' || name.startsWith('@heroui/'), accepts: isAcceptedHerouiDeepmergeFinding },
];

function isAcceptedReport(report) {
  const vulnerabilities = report.vulnerabilities ?? {};
  const names = Object.keys(vulnerabilities);

  if (names.length === 0) {
    return false;
  }

  const everyNameOwned = names.every((name) => ACCEPTED_FINDINGS.some(({ owns }) => owns(name)));
  const everyPresentFindingAccepted = ACCEPTED_FINDINGS
    .filter(({ owns }) => names.some(owns))
    .every(({ accepts }) => accepts(vulnerabilities));

  return everyNameOwned && everyPresentFindingAccepted;
}

function runSelfTest() {
  const nextPostcss = {
    next: { via: ['postcss'] },
    postcss: {
      range: '<8.5.10',
      nodes: ['node_modules/next/node_modules/postcss'],
    },
  };
  const herouiDeepmerge = {
    deepmerge: {
      severity: 'low',
      via: [{ name: 'deepmerge', url: DEEPMERGE_ADVISORY_URL }],
      nodes: ['node_modules/deepmerge'],
    },
    '@heroui/theme': { severity: 'low', via: ['deepmerge'] },
    '@heroui/react': { severity: 'low', via: ['@heroui/theme'] },
  };

  assert.equal(isAcceptedReport({ vulnerabilities: nextPostcss }), true);
  assert.equal(isAcceptedReport({ vulnerabilities: herouiDeepmerge }), true);
  assert.equal(isAcceptedReport({ vulnerabilities: { ...nextPostcss, ...herouiDeepmerge } }), true);
  assert.equal(isAcceptedReport({ vulnerabilities: { ...nextPostcss, react: { via: [] } } }), false);
  assert.equal(isAcceptedReport({
    vulnerabilities: { ...herouiDeepmerge, '@heroui/react': { severity: 'high', via: ['@heroui/theme'] } },
  }), false);
  assert.equal(isAcceptedReport({
    vulnerabilities: { ...herouiDeepmerge, deepmerge: { ...herouiDeepmerge.deepmerge, via: [{ url: 'other' }] } },
  }), false);
  console.log('audit-prod self-test passed.');
}

function runAudit() {
  const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (audit.error) {
    console.error(audit.error.message);
    process.exit(1);
  }

  let report;

  try {
    report = JSON.parse(audit.stdout);
  } catch {
    process.stdout.write(audit.stdout);
    process.stderr.write(audit.stderr);
    process.exit(audit.status ?? 1);
  }

  if (Object.keys(report.vulnerabilities ?? {}).length === 0) {
    console.log('Production dependency audit passed: 0 vulnerabilities.');
    process.exit(0);
  }

  if (isAcceptedReport(report)) {
    console.warn(
      'Production dependency audit accepted known findings only. Next vendors postcss <8.5.10, but Vessel deploys a static export with no production Next server runtime. @heroui/theme uses deepmerge (GHSA-gcqx-w48m-w2h4) only in its build-time Tailwind plugin on static config. Recheck both when patched releases ship.',
    );
    process.exit(0);
  }

  process.stdout.write(audit.stdout);
  process.stderr.write(audit.stderr);
  process.exit(audit.status ?? 1);
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  runAudit();
}
