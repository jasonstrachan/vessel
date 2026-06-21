import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

function isAcceptedNextPostcssFinding(report) {
  const vulnerabilities = report.vulnerabilities ?? {};
  const names = Object.keys(vulnerabilities);

  if (names.length === 0) {
    return false;
  }

  const allowedNames = new Set(['next', 'postcss']);
  const hasOnlyAcceptedNames = names.every((name) => allowedNames.has(name));
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

  return hasOnlyAcceptedNames && postcssIsNestedUnderNext && postcssRangeMatches && nextViaPostcss;
}

function runSelfTest() {
  const acceptedReport = {
    vulnerabilities: {
      next: { via: ['postcss'] },
      postcss: {
        range: '<8.5.10',
        nodes: ['node_modules/next/node_modules/postcss'],
      },
    },
  };
  const rejectedReport = {
    vulnerabilities: {
      next: { via: ['postcss'] },
      postcss: {
        range: '<8.5.10',
        nodes: ['node_modules/next/node_modules/postcss'],
      },
      react: { via: [] },
    },
  };

  assert.equal(isAcceptedNextPostcssFinding(acceptedReport), true);
  assert.equal(isAcceptedNextPostcssFinding(rejectedReport), false);
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

  if (isAcceptedNextPostcssFinding(report)) {
    console.warn(
      'Production dependency audit accepted: Next currently vendors postcss@8.4.31, flagged as postcss <8.5.10. Vessel deploys a static export with no production Next server runtime. Recheck when stable Next updates nested PostCSS.',
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
