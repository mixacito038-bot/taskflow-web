import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("report center offers a one-click monthly report with dedupe and template resolution", async () => {
  const reportCenter = await readFile(new URL("../app/BenefitReportCenter.tsx", import.meta.url), "utf8");
  assert.match(reportCenter, /一键生成月度报告/);
  assert.match(reportCenter, /resolveMonthlyReportPeriod/);
  assert.match(reportCenter, /已存在本期草稿，已为你打开/);
  assert.match(reportCenter, /generateMonthlyReport/);
});

test("monthly period resolution prefers the latest complete month from the period options", async () => {
  const catalog = await readFile(new URL("../app/report-template-catalog.ts", import.meta.url), "utf8");
  assert.match(catalog, /export function resolveMonthlyReportPeriod/);
  const { resolveMonthlyReportPeriod } = await import("../app/report-template-catalog.ts");
  const options = ["2026年度", "2026年7月", "2026年6月", "2026年5月"];
  const resolved = resolveMonthlyReportPeriod(new Date("2026-08-11T00:00:00Z"), options);
  assert.equal(typeof resolved, "string");
  assert.ok(resolved.includes("月"), `monthly period expected, got ${resolved}`);
  assert.ok(options.includes(resolved), "resolved period must come from the provided options");
});
