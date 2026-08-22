import { appendFileSync, existsSync, readFileSync } from "node:fs";

const newline = String.fromCharCode(10);
const reportPaths = [
  {
    label: "@flarelobby/core",
    path: "packages/core/coverage/coverage-summary.json",
  },
  {
    label: "@flarelobby/client",
    path: "packages/client/coverage/coverage-summary.json",
  },
  {
    label: "@flarelobby/testing",
    path: "packages/testing/coverage/coverage-summary.json",
  },
  {
    label: "@flarelobby/cloudflare",
    path: "packages/cloudflare/coverage/coverage-summary.json",
  },
  {
    label: "@flarelobby/example-local-demo",
    path: "examples/local-demo/coverage/coverage-summary.json",
  },
];
const metrics = ["lines", "statements", "branches", "functions"];

const reports = reportPaths.map((report) => {
  if (!existsSync(report.path)) {
    throw new Error("Missing coverage summary: " + report.path);
  }
  return {
    ...report,
    summary: JSON.parse(readFileSync(report.path, "utf8")).total,
  };
});

const aggregate = Object.fromEntries(
  metrics.map((metric) => {
    const total = reports.reduce(
      (sum, report) => sum + report.summary[metric].total,
      0,
    );
    const covered = reports.reduce(
      (sum, report) => sum + report.summary[metric].covered,
      0,
    );
    return [
      metric,
      { total, covered, pct: total === 0 ? 0 : (covered * 100) / total },
    ];
  }),
);
const percentage = (metric) =>
  metric.total === 0 ? "n/a" : metric.pct.toFixed(2) + "%";
const row = (label, summary) =>
  "| " +
  label +
  " | " +
  percentage(summary.lines) +
  " | " +
  percentage(summary.statements) +
  " | " +
  percentage(summary.branches) +
  " | " +
  percentage(summary.functions) +
  " |";
const output = [
  "## Coverage summary",
  "",
  "| Package | Lines | Statements | Branches | Functions |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...reports.map((report) => row(report.label, report.summary)),
  row("**Total**", aggregate),
  "",
].join(newline);

process.stdout.write(output + newline);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output + newline);
}
