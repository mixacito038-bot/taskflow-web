import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPublishedPayload,
  normalizePublishedDefinitions,
  publishedDefinitionContractMatches,
  publishedDefinitionIds,
} from "../app/published-data-server-model.ts";
import { filterPublishedRecordsByDepartment } from "../db/data-workbench-department-scope.ts";

const source = (overrides = {}) => ({
  dataDomain: "exam",
  publish: { id: "publish-1", seriesId: "series-exam", version: 3, status: "published", mappingVersion: "map-2", ruleVersion: "rule-4", publishedAt: "2026-08-11T00:00:00.000Z" },
  snapshot: { id: "snapshot-1", sha256: "a".repeat(64), rowCount: 1 },
  manifest: { definitions: { metricDefinitionIds: ["metric-1"], visualizationDefinitionIds: ["visual-1"] }, transform: { allocationRule: "equal_by_body_part" } },
  records: [{ recordType: "metric", deviceId: "device-1", metricCode: "revenue", value: 8, _lineage: { importJobId: "import-1", rawSnapshotId: "raw-1", sourceRowNumber: 1, sourceRecordId: "row-1" } }],
  ...overrides,
});

const storedMetric = { id: "metric-1", code: "revenue", name: "收入", formula: "SUM(revenue)", aggregation: "sum", numerator: "", denominator: "", dimensionsJson: "[\"department\"]", sourceFieldRefsJson: "[\"revenue\"]", unit: "万元", version: 2 };
const storedVisual = { id: "visual-1", code: "revenue_bar", name: "收入柱图", metricId: "metric-1", chartType: "bar", dimension: "department", seriesJson: "[]", sortJson: "{\"direction\":\"desc\"}", limit: 20, version: 5 };

test("发布 manifest 的指标和展示定义 ID 按多数据域去重", () => {
  const ids = publishedDefinitionIds([source(), source({ dataDomain: "device" })]);
  assert.deepEqual(ids.metricDefinitionIds, ["metric-1"]);
  assert.deepEqual(ids.visualizationDefinitionIds, ["visual-1"]);
});

test("兼容 manifest 冻结定义对象并拒绝 code/version/metricId 漂移", () => {
  const frozenSource = source({ manifest: { definitions: {
    metrics: [{ id: "metric-1", code: "revenue", version: 2 }],
    visualizations: [{ id: "visual-1", code: "revenue_bar", version: 5, metricId: "metric-1" }],
  }, transform: { allocationRule: "weighted_by_body_part" } } });
  const frozen = publishedDefinitionIds([frozenSource]);
  assert.deepEqual(frozen.metricDefinitionIds, ["metric-1"]);
  assert.deepEqual(frozen.visualizationDefinitionIds, ["visual-1"]);
  assert.equal(publishedDefinitionContractMatches(frozen, [storedMetric], [storedVisual]), true);
  assert.equal(publishedDefinitionContractMatches(frozen, [{ ...storedMetric, version: 3 }], [storedVisual]), false);
  assert.equal(buildPublishedPayload({ hospitalId: "hospital-1", supplyHash: "a".repeat(64), sources: [frozenSource], ...normalizePublishedDefinitions([storedMetric], [storedVisual]) }).publication.allocationRule, "weighted_by_body_part");
});

test("仅接受受支持的聚合与七类展示配置", () => {
  const normalized = normalizePublishedDefinitions([storedMetric], [storedVisual]);
  assert.equal(normalized.metricDefinitions[0].aggregation, "sum");
  assert.equal(normalized.visualizationDefinitions[0].chartType, "bar");
  assert.equal(normalized.visualizationDefinitions[0].metricCode, "revenue");
  assert.equal(normalized.visualizationDefinitions[0].sort, "desc");
  assert.deepEqual(normalizePublishedDefinitions([{ ...storedMetric, aggregation: "unsafe" }], [storedVisual]), { metricDefinitions: [], visualizationDefinitions: [] });
});

test("当前多数据域供数合并记录并冻结组合 hash 与版本集合", () => {
  const definitions = normalizePublishedDefinitions([storedMetric], [storedVisual]);
  const second = source({
    dataDomain: "device",
    publish: { id: "publish-2", seriesId: "series-device", version: 7, status: "published", mappingVersion: "map-3", ruleVersion: "rule-4", publishedAt: "2026-08-11T01:00:00.000Z" },
    snapshot: { id: "snapshot-2", sha256: "b".repeat(64), rowCount: 1 },
  });
  const payload = buildPublishedPayload({ hospitalId: "hospital-1", supplyHash: "c".repeat(64), sources: [source(), second], ...definitions });
  assert.equal(payload.publication.seriesId, "hospital-current-set");
  assert.equal(payload.publication.version, 7);
  assert.equal(payload.publication.snapshotSha256, "c".repeat(64));
  assert.equal(payload.publication.mappingVersion, "map-2|map-3");
  assert.equal(payload.rows.length, 2);
});

test("没有当前发布版本时返回明确 unavailable payload", () => {
  const payload = buildPublishedPayload({ hospitalId: "hospital-1", supplyHash: "", sources: [], metricDefinitions: [], visualizationDefinitions: [] });
  assert.equal(payload.publication, null);
  assert.deepEqual(payload.rows, []);
});

test("Published API 强制 app session、医院边界、hash 校验与 no-store", async () => {
  const source = await readFile(new URL("../app/api/published-data/route.ts", import.meta.url), "utf8");
  assert.match(source, /requireAppSession\(request\)/);
  assert.match(source, /getCloudStateAccess\(user\.email, hospitalId\)/);
  assert.match(source, /hospital_or_department_scope_required/);
  assert.match(source, /filterPublishedRecordsByDepartment/);
  assert.match(source, /readCurrentPublishedDatasetSet/);
  assert.match(source, /readPublishedSnapshot/);
  assert.match(source, /published_snapshot_integrity_failed/);
  assert.match(source, /Cache-Control": "private, no-store"/);
});

test("科室级 Published 投影不泄露跨科或未知归属记录", () => {
  const records = [
    { id: "allowed", department: "影像科" },
    { id: "other", department: "检验科" },
    { id: "unknown" },
    { id: "nested", device: { departmentId: "dept-imaging" } },
  ];
  assert.deepEqual(filterPublishedRecordsByDepartment(records, ["影像科", "dept-imaging"]).map((row) => row.id), ["allowed", "nested"]);
  assert.deepEqual(filterPublishedRecordsByDepartment(records, []), []);
});
