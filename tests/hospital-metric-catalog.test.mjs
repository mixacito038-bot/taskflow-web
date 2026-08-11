import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalogUrl = new URL("../app/hospital-metric-catalog.ts", import.meta.url);

test("hospital workbook baseline covers all 17 source items and preserves deliberate formula splits", async () => {
  const source = await readFile(catalogUrl, "utf8");
  const sourceItems = new Set([...source.matchAll(/sourceItem: (\d+)/g)].map((match) => Number(match[1])));
  const metricCodes = [...source.matchAll(/code: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...sourceItems].sort((left, right) => left - right), Array.from({ length: 17 }, (_, index) => index + 1));
  assert.equal(metricCodes.length, 20);
  assert.ok(metricCodes.includes("hospital.device.time_utilization_rate"));
  assert.ok(metricCodes.includes("hospital.device.capacity_utilization_rate"));
  assert.ok(metricCodes.includes("hospital.device.avg_repair_response_hours"));
  assert.ok(metricCodes.includes("hospital.device.mttr_hours"));
  assert.ok(metricCodes.includes("hospital.device.repair_cost_to_original_value_rate"));
  assert.ok(metricCodes.includes("hospital.device.repair_cost_to_revenue_rate"));
});

test("exam and body-part metrics keep the hospital workbook counting boundary", async () => {
  const source = await readFile(catalogUrl, "utf8");
  assert.match(source, /COUNT_DISTINCT\(examId\) FILTER completed = true AND physical_exam = false/);
  assert.match(source, /COUNT_DISTINCT\(examId, bodyPart\)/);
  assert.match(source, /多部位不得重复计人次/);
  assert.match(source, /收入和成本不得按部位行复制/);
});

test("ambiguous equipment formulas fail closed instead of using false equivalences", async () => {
  const source = await readFile(catalogUrl, "utf8");
  assert.match(source, /fault_downtime_hours \/ scheduled_service_hours \* 100%/);
  assert.match(source, /不采用“1−完好率”或“1−开机率”作为默认等价公式/);
  assert.match(source, /工作簿依据支持的是可控直接成本，不能直接冒充全成本/);
  assert.match(source, /“本期-同期”只叫变化额，变化率另建指标/);
});

test("data workbench exposes the hospital metric catalog for configuration and visualization", async () => {
  const source = await readFile(new URL("../app/DataWorkbench.tsx", import.meta.url), "utf8");
  assert.match(source, /hospitalMetricCatalog/);
  assert.match(source, /医院关注指标基线/);
  assert.match(source, /原表存在“或”口径的项目拆分后共形成 20 个指标/);
  assert.match(source, /metric\.readiness !== "deferred"/);
});

test("formal report preview and Word export freeze the hospital metric catalog", async () => {
  const [center, exporter, model] = await Promise.all([
    readFile(new URL("../app/BenefitReportCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-report-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-report-model.ts", import.meta.url), "utf8"),
  ]);
  assert.match(center, /医院关注指标口径快照/);
  assert.match(center, /hospitalMetricCatalog\.map/);
  assert.match(center, /hospitalMetricTemplateVersion/);
  assert.match(exporter, /附录C 医院关注指标口径快照/);
  assert.match(exporter, /hospitalMetricCatalog\.map/);
  assert.match(model, /HOSPITAL_METRIC_CATALOG_VERSION/);
});
