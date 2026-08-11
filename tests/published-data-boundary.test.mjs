import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hasInsightFor,
  insightFor,
  METRIC_DEFINITION_VERSION,
  metricDefinitions,
  VISUALIZATION_DEFINITION_VERSION,
  visualizationDefinitions,
} from "../app/metric-definitions.ts";
import {
  allocateExamBodyParts,
  createPublishedDataView,
  distinctExamBodyPartCount,
  distinctExamCount,
} from "../app/published-data.ts";

const reportModelUrl = new URL("../app/benefit-report-model.ts", import.meta.url);
const reportGovernanceUrl = new URL("../app/report-governance.ts", import.meta.url);

test("unknown equipment no longer inherits MRI insight values", () => {
  const unknown = insightFor("new-device-without-insight");

  assert.equal(hasInsightFor("new-device-without-insight"), false);
  assert.equal(unknown.deviceId, "new-device-without-insight");
  assert.equal(unknown.dataStatus, "unavailable");
  assert.equal(unknown.monthly.length, 0);
  assert.equal(unknown.actions.length, 0);
  assert.equal(Number.isNaN(unknown.availabilityRate), true);
  assert.notEqual(unknown.availabilityRate, insightFor("mri-01").availabilityRate);
});

test("published data view exposes demo and unavailable states without published values", () => {
  const view = createPublishedDataView();
  const demo = view.resolve("mri-01", true);
  const unavailable = view.resolve("new-device-without-insight", false);

  assert.equal(demo.status, "demo");
  assert.equal(demo.usableForFormalConclusion, false);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.usableForFormalConclusion, false);
  assert.equal(view.value(unavailable, 96.8).value, null);
  assert.equal(view.value(unavailable, 96.8).status, "unavailable");
});

test("report model classifies every row through the published-data boundary", async () => {
  const source = await readFile(reportModelUrl, "utf8");

  assert.match(source, /publishedData: PublishedDataView \| PublishedDatasetView = emptyPublishedDataView/);
  assert.match(source, /const publishedEvidence: PublishedDataView/);
  assert.match(source, /publishedEvidence\.resolve\(device\.id,/);
  assert.match(source, /dataStatus: publication\.status/);
  assert.match(source, /publishedFacts:/);
  assert.match(source, /publishedEvidence\.value\(publication, device\)/);
});

test("published evidence is required before values are usable in formal conclusions", () => {
  const view = createPublishedDataView([{
    deviceId: "device-01",
    publishedAt: "2026-08-11T09:00:00.000Z",
    revision: "rev-1",
    sourceRecordIds: ["his-batch-1", "cmms-batch-1"],
    metricDefinitionVersion: METRIC_DEFINITION_VERSION,
    visualizationVersion: VISUALIZATION_DEFINITION_VERSION,
    allocationRule: "equal_by_body_part",
  }]);
  const published = view.resolve("device-01", false, {
    metricDefinitionVersion: METRIC_DEFINITION_VERSION,
    visualizationVersion: VISUALIZATION_DEFINITION_VERSION,
    allocationRule: "equal_by_body_part",
  });
  const value = view.value(published, 96.8);

  assert.equal(published.status, "published");
  assert.equal(published.usableForFormalConclusion, true);
  assert.equal(value.value, 96.8);
  assert.equal(value.usableForFormalConclusion, true);
});

test("formal publication is blocked when metric, visualization, or allocation versions drift", () => {
  const view = createPublishedDataView([{
    deviceId: "device-01",
    publishedAt: "2026-08-11T09:00:00.000Z",
    revision: "rev-1",
    sourceRecordIds: ["his-batch-1"],
    metricDefinitionVersion: "old-metrics",
    visualizationVersion: VISUALIZATION_DEFINITION_VERSION,
    allocationRule: "equal_by_body_part",
  }]);
  const resolution = view.resolve("device-01", false, {
    metricDefinitionVersion: METRIC_DEFINITION_VERSION,
    visualizationVersion: VISUALIZATION_DEFINITION_VERSION,
    allocationRule: "equal_by_body_part",
  });

  assert.equal(resolution.status, "published");
  assert.equal(resolution.usableForFormalConclusion, false);
  assert.equal(resolution.blockingReason, "definition_version_mismatch");
});

test("multi-body-part exams count once and allocated amounts remain conserved", () => {
  const rows = [
    { examId: "exam-1", bodyPart: "胸部", examRevenue: 100, examCost: 40 },
    { examId: "exam-1", bodyPart: "腹部", examRevenue: 100, examCost: 40 },
    { examId: "exam-1", bodyPart: "胸部", examRevenue: 100, examCost: 40 },
    { examId: "exam-2", bodyPart: "头部", examRevenue: 60, examCost: 30 },
  ];
  const allocated = allocateExamBodyParts(rows, "equal_by_body_part");

  assert.equal(distinctExamCount(rows), 2);
  assert.equal(distinctExamBodyPartCount(rows), 3);
  assert.equal(allocated.length, 3);
  assert.equal(allocated.filter((row) => row.examId === "exam-1").reduce((sum, row) => sum + row.allocatedRevenue, 0), 100);
  assert.equal(allocated.filter((row) => row.examId === "exam-1").reduce((sum, row) => sum + row.allocatedCost, 0), 40);
  assert.deepEqual(allocated.filter((row) => row.examId === "exam-1").map((row) => row.allocatedRevenue), [50, 50]);
});

test("metric and visualization definitions freeze exam and body-part grain", () => {
  assert.ok(METRIC_DEFINITION_VERSION);
  assert.ok(VISUALIZATION_DEFINITION_VERSION);
  assert.ok(metricDefinitions.some((definition) => definition.formula.includes("COUNT(DISTINCT examId)")));
  assert.ok(metricDefinitions.some((definition) => definition.formula.includes("allocationWeight")));
  assert.ok(visualizationDefinitions.some((definition) => definition.grain === "examId"));
  assert.ok(visualizationDefinitions.some((definition) => definition.grain === "examId+bodyPart"));
});

test("report formal findings exclude missing insight and fabricated reconciliation values", async () => {
  const source = await readFile(reportModelUrl, "utf8");

  assert.match(source, /const publishedRowsWithInsight = publishedRows\.filter\(\(row\) => row\.hasInsight\)/);
  assert.match(source, /publishedMissingInsight/);
  assert.match(source, /metricDefinitionVersion: normalizedConfig\.commonRules\.metricDefinitionVersion/);
  assert.match(source, /visualizationVersion: normalizedConfig\.commonRules\.visualizationVersion/);
  assert.match(source, /allocationRule: normalizedConfig\.commonRules\.allocationRule/);
  assert.match(source, /if \(publishedRowsWithInsight\.length\)/);
  assert.match(source, /未生成可用率、PM 或综合评分结论/);
  assert.doesNotMatch(source, /当前抽样差异约\s*1\.2%/);
});

test("report governance gates on published row evidence and freezes snapshot version/hash", async () => {
  const [source, modelSource] = await Promise.all([readFile(reportGovernanceUrl, "utf8"), readFile(reportModelUrl, "utf8")]);
  assert.match(source, /model\.rows\.filter\(\(row\) => !row\.hasInsight\)/);
  assert.match(source, /publishedDataset\.version > 0/);
  assert.match(source, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(source, /publishedDataset: model\.publishedDataset/);
  assert.match(source, /publishedFileCoverage: model\.publishedFileCoverage/);
  assert.doesNotMatch(source, /hasInsightFor/);
  assert.match(modelSource, /const publishedDefinitionsReady = Boolean/);
  assert.match(modelSource, /device_master/);
  assert.match(modelSource, /billing_revenue/);
  assert.match(modelSource, /quality_safety/);
  assert.match(modelSource, /publishedFileCoverage/);
});
