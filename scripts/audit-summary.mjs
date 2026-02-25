import fs from 'node:fs';
import path from 'node:path';

const INPUT_PATH = process.argv[2] ?? 'audit-full.json';
const OUTPUT_PATH = process.argv[3] ?? 'audit-full-summary.md';
const RESOLVED_INPUT = path.resolve(INPUT_PATH);
const RESOLVED_OUTPUT = path.resolve(OUTPUT_PATH);

const readAuditReport = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audit report not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const getSeverityScore = (severity) => {
  switch (severity) {
    case 'critical':
      return 5;
    case 'high':
      return 4;
    case 'moderate':
      return 3;
    case 'low':
      return 2;
    case 'info':
      return 1;
    default:
      return 0;
  }
};

const summarizeVulnerabilities = (report) => {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const rows = Object.entries(vulnerabilities).map(([name, detail]) => ({
    name,
    severity: detail?.severity ?? 'unknown',
    isDirect: detail?.isDirect === true,
    viaCount: Array.isArray(detail?.via) ? detail.via.length : 0,
    fixAvailable: Boolean(detail?.fixAvailable),
  }));

  rows.sort((a, b) => {
    const bySeverity = getSeverityScore(b.severity) - getSeverityScore(a.severity);
    if (bySeverity !== 0) return bySeverity;
    return a.name.localeCompare(b.name);
  });

  return rows;
};

const buildMarkdown = (report, rows) => {
  const generatedAt = new Date().toISOString();
  const totals = report?.metadata?.vulnerabilities ?? {};
  const dependencies = report?.metadata?.dependencies ?? {};
  const top = rows.slice(0, 25);

  const lines = [
    '# NPM Audit Summary',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Totals',
    '',
    `- info: ${totals.info ?? 0}`,
    `- low: ${totals.low ?? 0}`,
    `- moderate: ${totals.moderate ?? 0}`,
    `- high: ${totals.high ?? 0}`,
    `- critical: ${totals.critical ?? 0}`,
    `- total: ${totals.total ?? 0}`,
    '',
    '## Dependency Scope',
    '',
    `- prod: ${dependencies.prod ?? 0}`,
    `- dev: ${dependencies.dev ?? 0}`,
    `- optional: ${dependencies.optional ?? 0}`,
    `- peer: ${dependencies.peer ?? 0}`,
    `- total: ${dependencies.total ?? 0}`,
    '',
    `## Top Vulnerable Packages (${top.length})`,
    '',
    '| Package | Severity | Direct | Via Count | Fix Available |',
    '|---|---|---:|---:|---:|',
    ...top.map((row) => `| ${row.name} | ${row.severity} | ${row.isDirect ? 'yes' : 'no'} | ${row.viaCount} | ${row.fixAvailable ? 'yes' : 'no'} |`),
    '',
  ];

  return `${lines.join('\n')}\n`;
};

const main = () => {
  try {
    const report = readAuditReport(RESOLVED_INPUT);
    const rows = summarizeVulnerabilities(report);
    const markdown = buildMarkdown(report, rows);
    fs.writeFileSync(RESOLVED_OUTPUT, markdown, 'utf8');
    console.log(`Wrote audit summary: ${RESOLVED_OUTPUT}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[audit-summary] ${message}`);
    process.exitCode = 1;
  }
};

main();
