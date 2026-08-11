import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { aggregatePublishedFinancialMonths, createPublishedDatasetView } from "../app/published-data.ts";

const lineage = (row) => ({ importJobId: "import-1", rawSnapshotId: "raw-1", sourceRowNumber: row, sourceRecordId: `row-${row}` });
const device = {
  id: "device-real-1", assetCode: "REAL-001", name: "真实设备", shortName: "真实设备", model: "MODEL-1",
  category: "诊断类", department: "影像科", enabledDate: "2024-01-01", investment: 1000, quantity: 1,
  serviceVolume: 10, serviceUnit: "检查人次", revenue: 300, utilization: 75, planPayback: 5, forecastPayback: 4.5,
  status: "运行良好",
  cost: { labor: 10, consumables: 20, depreciation: 30, maintenance: 40, energy: 5, space: 5, indirect: 10 },
};
const insight = {
  deviceId: device.id, dataStatus: "published", scores: { economic: 80, efficiency: 81, quality: 82, experience: 83, reliability: 84 },
  standardWorkload: 100, activeHours: 7, uptimeRate: 90, loadRate: 75, idleRate: 25, peakShare: 55,
  positiveRate: 60, enhancementRate: 20, reportQualityRate: 98, repeatRate: 1, appointmentWaitDays: 2,
  onSiteWaitMinutes: 20, reportHours: 2, totalJourneyHours: 3, satisfaction: 95, availabilityRate: 97,
  failuresPer1000Hours: 2, downtimeHours: 4, mttrHours: 2, pmCompletionRate: 100, pmPassRate: 98,
  peerRank: 1, peerCount: 4, monthly: [], patientSources: [], actions: [],
};
const publication = (version = 1) => ({
  id: `publish-${version}`, hospitalId: "hospital-1", seriesId: "series-1", version, status: version === 1 ? "superseded" : "published",
  snapshotId: `snapshot-${version}`, snapshotSha256: `${version}`.repeat(64), rowCount: 5, mappingVersion: "mapping-2",
  ruleVersion: "rule-3", metricDefinitionVersion: "metric-set-4", visualizationVersion: "visual-set-5",
  allocationRule: "equal_by_body_part", publishedAt: "2026-08-11T00:00:00.000Z", correctionOfId: null, rollbackOfId: null,
});
const metric = { id: "metric-revenue", code: "revenue", name: "收入", formula: "SUM(revenue)", aggregation: "sum", numerator: "收入", denominator: "—", dimensions: ["department"], sourceFieldRefs: ["revenue"], unit: "万元", version: 4 };

function payload(version = 2) {
  const chartTypes = ["kpi", "table", "bar", "line", "pie", "scatter", "heatmap"];
  return {
    mode: "formal",
    publication: publication(version),
    rows: [
      { recordType: "device", deviceId: device.id, device, insight, department: "影像科", revenue: 300, comparison: 75, _lineage: lineage(1) },
      { recordType: "exam", deviceId: device.id, examId: "exam-1", bodyPart: "头部", examRevenue: 100, examCost: 40, department: "影像科", _lineage: lineage(2) },
      { recordType: "exam", deviceId: device.id, examId: "exam-1", bodyPart: "颈部", examRevenue: 100, examCost: 40, department: "影像科", _lineage: lineage(3) },
      { recordType: "exam", deviceId: device.id, examId: "exam-2", bodyPart: "胸部", examRevenue: 200, examCost: 80, department: "影像科", _lineage: lineage(4) },
      { recordType: "metric", deviceId: device.id, metricCode: "revenue", value: 300, department: "影像科", comparison: 75, _lineage: lineage(5) },
    ],
    metricDefinitions: [metric],
    visualizationDefinitions: chartTypes.map((chartType, index) => ({
      id: `visual-${chartType}`, code: `visual_${chartType}`, name: `${chartType} 展示`, metricDefinitionId: metric.id,
      metricCode: metric.code, chartType, dimension: index ? "department" : "", series: chartType === "scatter" ? "comparison" : "",
      sort: "desc", limit: 20, version: 5,
    })),
  };
}

test("正式模式无发布版本时保持 unavailable 且没有静态设备值", () => {
  const view = createPublishedDatasetView({ mode: "formal", publication: null, rows: [], metricDefinitions: [], visualizationDefinitions: [] });
  assert.equal(view.status, "unavailable");
  assert.deepEqual(view.devices, []);
  assert.deepEqual(view.insights, {});
});

test("已发布设备、洞察和来源行只来自有效 Published snapshot", () => {
  const data = payload();
  data.rows.push({ recordType: "device", deviceId: "invalid", device: { ...device, id: "invalid" }, insight: { ...insight, deviceId: "invalid" }, _lineage: { sourceRowNumber: 0 } });
  const view = createPublishedDatasetView(data);
  assert.equal(view.status, "published");
  assert.deepEqual(view.devices.map((item) => item.id), [device.id]);
  assert.equal(view.insights[device.id].availabilityRate, 97);
  assert.equal(view.evidenceView.resolve(device.id, false).evidence.revision, "series-1@2");
});

test("扁平标准 device/exam/metric 文件事实可聚合为设备且检查人次按 examId 去重", () => {
  const base = payload();
  base.rows = [
    {
      recordType: "device", deviceId: device.id, deviceName: device.name, shortName: device.shortName,
      assetCode: device.assetCode, model: device.model, department: device.department, category: device.category,
      enabledDate: device.enabledDate, serviceUnit: device.serviceUnit, status: device.status,
      investment: device.investment, quantity: device.quantity, utilization: device.utilization,
      planPayback: device.planPayback, forecastPayback: device.forecastPayback,
      costLabor: 10, costConsumables: 20, costDepreciation: 30, costMaintenance: 40,
      costEnergy: 5, costSpace: 5, costIndirect: 10, _lineage: lineage(1),
    },
    { recordType: "exam", deviceId: device.id, examId: "exam-1", bodyPart: "头部", revenue: 100, cost: 40, _lineage: lineage(2) },
    { recordType: "exam", deviceId: device.id, examId: "exam-1", bodyPart: "颈部", revenue: 100, cost: 40, _lineage: lineage(3) },
    { recordType: "exam", deviceId: device.id, examId: "exam-2", bodyPart: "胸部", revenue: 200, cost: 80, _lineage: lineage(4) },
  ];
  const view = createPublishedDatasetView(base);
  assert.equal(view.devices.length, 1);
  assert.equal(view.devices[0].serviceVolume, 2);
  assert.equal(view.devices[0].revenue, 300);
  assert.equal(view.examAudit.distinctExamCount, 2);
  assert.equal(view.examAudit.balanced, true);
});

test("billing/cost_detail/utilization 多域文件按设备聚合且不要求成本写在主数据行", () => {
  const base = payload();
  const master = {
    recordType: "device", deviceId: device.id, deviceName: device.name, shortName: device.shortName,
    assetCode: device.assetCode, model: device.model, department: device.department, category: device.category,
    enabledDate: device.enabledDate, serviceUnit: device.serviceUnit, status: device.status,
    investment: device.investment, quantity: device.quantity, planPayback: device.planPayback,
    forecastPayback: device.forecastPayback, _lineage: lineage(1),
  };
  const costTypes = [["人工", 10], ["耗材", 20], ["折旧", 30], ["维修维保", 40], ["能耗", 5], ["空间", 5], ["管理", 10]];
  base.rows = [
    master,
    { recordType: "exam", deviceId: device.id, examId: "exam-1", bodyPart: "头部", revenue: 100, cost: 40, _lineage: lineage(2) },
    { recordType: "exam", deviceId: device.id, examId: "exam-1", bodyPart: "颈部", revenue: 100, cost: 40, _lineage: lineage(3) },
    { recordType: "exam", deviceId: device.id, examId: "exam-2", bodyPart: "胸部", revenue: 200, cost: 80, _lineage: lineage(4) },
    { recordType: "revenue", examId: "exam-1", amount: 110, refundAmount: 10, _lineage: lineage(5) },
    { recordType: "revenue", examId: "exam-2", amount: 200, refundAmount: 0, _lineage: lineage(6) },
    { recordType: "revenue", examId: "exam-2", amount: 200, refundAmount: 0, _lineage: lineage(6) },
    { recordType: "utilization", deviceId: device.id, activeHours: 60, scheduledHours: 80, _lineage: lineage(7) },
    ...costTypes.map(([costType, amount], index) => ({ recordType: "cost_detail", deviceId: device.id, costType, amount, _lineage: lineage(8 + index) })),
  ];
  const view = createPublishedDatasetView(base);
  assert.equal(view.devices[0].revenue, 300);
  assert.equal(view.devices[0].utilization, 75);
  assert.deepEqual(view.devices[0].cost, device.cost);
  assert.equal(view.examAudit.sourceRevenue, 300);
  assert.equal(view.examAudit.balanced, true);
});

test("正式期间收入成本仅按真实月份与来源行/examId去重，缺时间粒度明确不可用", () => {
  const rows = [
    { recordType: "exam", deviceId: device.id, examId: "exam-1", occurredAt: "2026-01-05", examRevenue: 100, examCost: 40, _lineage: lineage(1) },
    { recordType: "exam", deviceId: device.id, examId: "exam-1", occurredAt: "2026-01-05", examRevenue: 100, examCost: 40, _lineage: lineage(2) },
    { recordType: "revenue", examId: "exam-1", occurredAt: "2026-01-05", amount: 120, refundAmount: 20, _lineage: lineage(3) },
    { recordType: "revenue", examId: "exam-1", occurredAt: "2026-01-05", amount: 120, refundAmount: 20, _lineage: lineage(3) },
    { recordType: "cost", deviceId: device.id, statDate: "2026-01-31", costType: "耗材", amount: 30, _lineage: lineage(4) },
  ];
  const result = aggregatePublishedFinancialMonths(rows, [device.id]);
  assert.equal(result.completeTimeGrain, true);
  assert.equal(result.months.length, 1);
  assert.equal(result.months[0].revenue, 100);
  assert.equal(result.months[0].cost, 30);
  assert.equal(result.months[0].costByType.consumables, 30);
  const missing = aggregatePublishedFinancialMonths([...rows, { recordType: "revenue", deviceId: device.id, examId: "exam-2", amount: 50, refundAmount: 0, _lineage: lineage(5) }], [device.id]);
  assert.equal(missing.completeTimeGrain, false);
  assert.equal(missing.missingTimeFactCount, 1);
});

test("KPI/表格/柱线饼散点热力均由发布指标与展示定义驱动", () => {
  const view = createPublishedDatasetView(payload());
  for (const chartType of ["kpi", "table", "bar", "line", "pie", "scatter", "heatmap"]) {
    const points = view.analytics[`visual-${chartType}`];
    assert.ok(points.length, `${chartType} should have published points`);
    assert.ok(points.every((point) => Number.isFinite(point.value)));
  }
  assert.equal(view.analytics["visual-scatter"][0].secondary, 150);
});

test("指标追溯冻结发布版本、snapshot hash、公式版本和来源行", () => {
  const view = createPublishedDatasetView(payload());
  const trace = view.traces["visual-bar"];
  assert.equal(trace.publishVersion, 2);
  assert.equal(trace.snapshotId, "snapshot-2");
  assert.equal(trace.metricDefinitionVersion, 4);
  assert.equal(trace.sourceRows.length, 5);
  assert.equal(trace.sourceRows[0].sourceRecordId, "row-1");
});

test("ratio 按分子分母汇总计算且 custom 不静默降级为 sum", () => {
  const data = payload();
  data.rows.push({ recordType: "metric", deviceId: device.id, numerator_value: 30, denominator_value: 60, department: "影像科", _lineage: lineage(6) });
  data.metricDefinitions.push(
    { ...metric, id: "metric-ratio", code: "ratio_metric", aggregation: "ratio", numerator: "numerator_value", denominator: "denominator_value" },
    { ...metric, id: "metric-custom", code: "custom_metric", aggregation: "custom", formula: "hospital_specific_formula" },
  );
  data.visualizationDefinitions.push(
    { id: "visual-ratio", code: "visual_ratio", name: "比率", metricDefinitionId: "metric-ratio", metricCode: "ratio_metric", chartType: "kpi", dimension: "", series: "", sort: "none", limit: 20, version: 1 },
    { id: "visual-custom", code: "visual_custom", name: "自定义", metricDefinitionId: "metric-custom", metricCode: "custom_metric", chartType: "kpi", dimension: "", series: "", sort: "none", limit: 20, version: 1 },
  );
  const view = createPublishedDatasetView(data);
  assert.equal(view.analytics["visual-ratio"][0].value, 0.5);
  assert.deepEqual(view.analytics["visual-custom"], []);
  assert.equal(view.analyticsErrors["visual-custom"], "custom_metric_requires_single_published_value");
});

test("多部位检查按 examId 去重且分摊后收入成本守恒", () => {
  const audit = createPublishedDatasetView(payload()).examAudit;
  assert.equal(audit.distinctExamCount, 2);
  assert.equal(audit.distinctExamBodyPartCount, 3);
  assert.equal(audit.sourceRevenue, 300);
  assert.equal(audit.allocatedRevenue, 300);
  assert.equal(audit.sourceCost, 120);
  assert.equal(audit.allocatedCost, 120);
  assert.equal(audit.balanced, true);
});

test("更正或回滚后视图完全切换到所选发布版本", () => {
  const previous = createPublishedDatasetView(payload(1));
  const selected = createPublishedDatasetView(payload(2));
  assert.equal(previous.publication.status, "superseded");
  assert.equal(previous.traces["visual-kpi"].publishVersion, 1);
  assert.equal(selected.publication.status, "published");
  assert.equal(selected.traces["visual-kpi"].publishVersion, 2);
  assert.notEqual(previous.publication.snapshotSha256, selected.publication.snapshotSha256);
});

test("正式读取与报告源码不存在 MRI 或其他静态设备回退", async () => {
  const [clientSource, reportSource] = await Promise.all([
    readFile(new URL("../app/published-data-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-report-model.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(clientSource, /mri-01|initialDevices|mock-data/);
  assert.doesNotMatch(reportSource, /\?\?\s*deviceInsights\[\"mri-01\"\]/);
});
