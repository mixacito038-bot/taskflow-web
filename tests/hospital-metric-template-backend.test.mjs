import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildHospitalMetricTemplateRows,
  hospitalMetricActivationIssues,
  parseHospitalMetricTemplateMetadata,
  planHospitalMetricTemplateImport,
} from "../db/data-workbench-metric-template.ts";

const templateVersion = "HOSPITAL-BASELINE-2026.08.11.1";

function catalog(size = 20) {
  return Array.from({ length: size }, (_, index) => ({
    sourceItem: index + 1,
    code: `hospital.device.metric_${index + 1}`,
    name: `指标 ${index + 1}`,
    dimension: index % 2 ? "economic" : "efficiency",
    definition: `指标 ${index + 1} 的定义`,
    formula: index % 2 ? "revenue - cost" : "COUNT_DISTINCT(examId)",
    numerator: `分子 ${index + 1}`,
    denominator: index % 2 ? `分母 ${index + 1}` : "—",
    unit: index % 2 ? "%" : "人次",
    grain: "hospital+device+period",
    dimensions: ["医院", "设备", "月份"],
    sources: ["PACS/RIS", "HIS/收费"],
    owner: "信息部/医学装备部",
    evidence: index % 2 ? "partial" : "direct",
    readiness: index === 19 ? "deferred" : index % 3 ? "configure" : "ready",
    audience: ["leadership", "operations"],
    version: templateVersion,
    validation: "分子分母同期间、同设备范围。",
    decision: "采用冻结口径，不静默切换分母。",
  }));
}

test("20 项内置目录映射为完整 draft 指标定义", () => {
  const rows = buildHospitalMetricTemplateRows(catalog(), templateVersion);
  assert.equal(rows.length, 20);
  assert.ok(rows.every((row) => row.status === "draft" && row.version === 1));
  const metadata = parseHospitalMetricTemplateMetadata(rows[0].description);
  assert.deepEqual(metadata, {
    schema: "hospital-metric-template/v1",
    catalogVersion: templateVersion,
    sourceItem: 1,
    dimension: "efficiency",
    definition: "指标 1 的定义",
    grain: "hospital+device+period",
    owner: "信息部/医学装备部",
    evidence: "direct",
    readiness: "ready",
    audience: ["leadership", "operations"],
    validation: "分子分母同期间、同设备范围。",
    decision: "采用冻结口径，不静默切换分母。",
  });
  assert.deepEqual(JSON.parse(rows[0].dimensionsJson), ["医院", "设备", "月份"]);
  assert.deepEqual(JSON.parse(rows[0].sourceFieldRefsJson), ["PACS/RIS", "HIS/收费"]);
});

test("相同 code/version 和内容重复导入全部 skipped", () => {
  const rows = buildHospitalMetricTemplateRows(catalog(), templateVersion);
  const plan = planHospitalMetricTemplateImport(rows, rows);
  assert.equal(plan.created.length, 0);
  assert.equal(plan.skipped.length, 20);
  assert.equal(plan.conflicts.length, 0);
});

test("相同 code/version 内容不同返回 conflict 且不计划创建", () => {
  const rows = buildHospitalMetricTemplateRows(catalog(), templateVersion);
  const existing = rows.map((row) => ({ ...row }));
  existing[4].formula = "tampered_formula";
  const plan = planHospitalMetricTemplateImport(rows, existing);
  assert.equal(plan.created.length, 0);
  assert.equal(plan.skipped.length, 19);
  assert.deepEqual(plan.conflicts, [{ code: rows[4].code, version: 1, status: "draft" }]);
});

test("active/retired 同键同内容可跳过但不同内容绝不覆盖", () => {
  const [expected] = buildHospitalMetricTemplateRows(catalog(1), templateVersion);
  assert.equal(planHospitalMetricTemplateImport([expected], [{ ...expected, status: "active" }]).skipped.length, 1);
  const conflicted = planHospitalMetricTemplateImport([expected], [{ ...expected, status: "retired", unit: "元" }]);
  assert.equal(conflicted.created.length, 0);
  assert.deepEqual(conflicted.conflicts, [{ code: expected.code, version: 1, status: "retired" }]);
});

test("激活阻止 deferred、缺失来源绑定和缺失依赖", () => {
  const rows = buildHospitalMetricTemplateRows(catalog(), templateVersion);
  assert.deepEqual(hospitalMetricActivationIssues(rows[19], { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }), ["deferred_metric"]);
  assert.deepEqual(hospitalMetricActivationIssues(rows[0], { sourceFieldIds: [], dependencyMetricIds: [] }), ["source_binding_required"]);
  assert.deepEqual(hospitalMetricActivationIssues(rows[0], { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }), []);
});

test("激活只接受 draft 模板并校验来源元数据", () => {
  const [row] = buildHospitalMetricTemplateRows(catalog(1), templateVersion);
  assert.deepEqual(hospitalMetricActivationIssues({ ...row, status: "active" }, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }), ["immutable_status"]);
  assert.deepEqual(hospitalMetricActivationIssues({ ...row, sourceFieldRefsJson: "[]" }, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }), ["source_reference_required"]);
  assert.deepEqual(hospitalMetricActivationIssues({ ...row, description: "普通描述" }, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }), ["not_hospital_metric_template"]);
});

test("服务端内置目录固定为当前版本的 20 项", async () => {
  const source = await readFile(new URL("../app/hospital-metric-catalog.ts", import.meta.url), "utf8");
  assert.match(source, /HOSPITAL_METRIC_CATALOG_VERSION = "HOSPITAL-BASELINE-2026\.08\.11\.1"/);
  assert.equal((source.match(/\n {4}sourceItem:/g) ?? []).length, 20);
  assert.doesNotMatch(source, /version:\s*["'][^"']+["']/);
});

test("目录构建拒绝伪造版本和重复 code", () => {
  const wrongVersion = catalog(1);
  wrongVersion[0].version = "HOSPITAL-BASELINE-2026.08.11.2";
  assert.throws(() => buildHospitalMetricTemplateRows(wrongVersion, templateVersion), /catalog_version_mismatch/);
  const duplicateCode = catalog(2);
  duplicateCode[1].code = duplicateCode[0].code;
  assert.throws(() => buildHospitalMetricTemplateRows(duplicateCode, templateVersion), /duplicate_hospital_metric_code/);
});

test("激活拒绝非当前内置版本并保持不可变状态优先", () => {
  const [row] = buildHospitalMetricTemplateRows(catalog(1), templateVersion);
  const metadata = JSON.parse(row.description);
  const stale = { ...row, description: JSON.stringify({ ...metadata, catalogVersion: "HOSPITAL-BASELINE-2025.1" }) };
  assert.deepEqual(
    hospitalMetricActivationIssues(stale, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }, templateVersion),
    ["unsupported_template_version"],
  );
  assert.deepEqual(
    hospitalMetricActivationIssues({ ...stale, status: "retired" }, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }, templateVersion),
    ["immutable_status"],
  );
});

test("路由对导入、激活实施权限、租户依赖校验和 lineage 审计", async () => {
  const route = await readFile(new URL("../app/api/data-workbench/route.ts", import.meta.url), "utf8");
  const dbHelpers = await readFile(new URL("../db/data-workbench.ts", import.meta.url), "utf8");
  assert.match(route, /payload\.action === "import_hospital_metric_template"/);
  assert.match(route, /requirePermission\(access, "data\.clean"\)/);
  assert.match(route, /templateVersion !== HOSPITAL_METRIC_CATALOG_VERSION/);
  assert.match(route, /payload\.action === "activate_hospital_metric_definition"/);
  assert.match(route, /requirePermission\(access, "data\.review"\)/);
  assert.match(route, /hospital_metric_template_imported/);
  assert.match(route, /hospital_metric_template_conflict/);
  assert.match(route, /hospital_metric_definition_activated/);
  assert.match(route, /hospital_metric_template_requires_activation_action/);
  assert.match(route, /hospitalMetricCatalogCodes\.has\(current\.code\)/);
  assert.match(route, /eq\(dataMetricDefinitions\.status, "draft"\)/);
  assert.match(route, /const racedExisting = await metricDefinitionsByCodesVersionInHospital/);
  assert.match(route, /const racedPlan = planHospitalMetricTemplateImport/);
  assert.match(dbHelpers, /metricDefinitionsByCodesVersionInHospital\(hospitalId/);
  assert.match(dbHelpers, /activeFieldDefinitionIdsInHospital\(hospitalId/);
  assert.match(dbHelpers, /activeMetricDefinitionIdsInHospital\(hospitalId/);
  assert.match(dbHelpers, /eq\(dataMetricDefinitions\.hospitalId, hospitalId\)/);
  assert.match(dbHelpers, /eq\(dataFieldDefinitions\.hospitalId, hospitalId\)/);
});
