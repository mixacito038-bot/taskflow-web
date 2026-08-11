import assert from "node:assert/strict";
import test from "node:test";

const transformUrl = new URL("../db/data-workbench-transform.ts", import.meta.url);
const reconciliationUrl = new URL("../db/data-workbench-reconciliation.ts", import.meta.url);
const lineageUrl = new URL("../db/data-workbench-lineage.ts", import.meta.url);
const privacyUrl = new URL("../db/data-workbench-privacy.ts", import.meta.url);
const departmentScopeUrl = new URL("../db/data-workbench-department-scope.ts", import.meta.url);

test("template required fields quarantine non-device rows without imposing deviceId globally", async () => {
  const { executeCleaningRules } = await import(transformUrl.href);
  const target = executeCleaningRules([{ recordType: "target", metricCode: "roi" }], [], ["metricCode", "period", "targetValue"]);
  assert.deepEqual(target.issues.map((issue) => issue.fieldName).sort(), ["period", "targetValue"]);
  assert.equal(target.issues.some((issue) => issue.fieldName === "deviceId"), false);
});

test("deduplicate cleaning rule deterministically quarantines later business-key rows", async () => {
  const { executeCleaningRules } = await import(transformUrl.href);
  const result = executeCleaningRules([{ examId: "E1" }, { examId: "E1" }, { examId: "E2" }], [{ id: "dedup-1", sequence: 1, ruleType: "deduplicate", fieldName: "", config: { keyFields: ["examId"] }, enabled: true }]);
  assert.deepEqual(result.issues.map((issue) => issue.recordIndex), [1]);
  assert.equal(result.impacts[0].issueRows, 1);
});

test("multi-body-part exams preserve one exam amount and reject conflicting duplicates", async () => {
  const { expandExamActivityForPublish } = await import(transformUrl.href);
  const rows = expandExamActivityForPublish([{ examId: "E1", bodyParts: "胸部,腹部", examRevenue: 100, examCost: 40, _lineage: { sourceRecordId: "r1" } }]);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.examId)).size, 1);
  assert.equal(rows.reduce((sum, row) => sum + row.allocationWeight * row.examRevenue, 0), 100);
  assert.throws(() => expandExamActivityForPublish([
    { examId: "E1", bodyPart: "胸部", examRevenue: 100, examCost: 40 },
    { examId: "E1", bodyPart: "腹部", examRevenue: 120, examCost: 40 },
  ]), /conflicting_exam_amount/);
  assert.throws(() => expandExamActivityForPublish([
    { examId: "E2", deviceId: "D1", bodyPart: "胸部", examRevenue: 100, examCost: 40 },
    { examId: "E2", deviceId: "D2", bodyPart: "腹部", examRevenue: 100, examCost: 40 },
  ]), /conflicting_exam_deviceId/);
  const primary = expandExamActivityForPublish([{ examId: "E3", bodyParts: [{ name: "胸部", isPrimary: true }, { name: "腹部" }], examRevenue: 100, examCost: 40 }], "primary_body_part");
  assert.deepEqual(primary.map((row) => row.allocationWeight), [1, 0]);
});

test("reconciliation rejects blank keys, surfaces duplicates and honors tolerances", async () => {
  const { groupReconciliationRows, reconciliationValuesEqual } = await import(reconciliationUrl.href);
  assert.throws(() => groupReconciliationRows([{ record: { id: null } }], ["id"]), /blank_key/);
  const groups = groupReconciliationRows([{ record: { id: "A" } }, { record: { id: "A" } }], ["id"]);
  assert.equal(groups.get('"A"').length, 2);
  assert.equal(reconciliationValuesEqual(100, 100.4, { absolute: 0.5 }), true);
  assert.equal(reconciliationValuesEqual(100, 102, { relative: 0.01 }), false);
});

test("raw lineage is frozen and survives staging/published snapshots", async () => {
  const { freezeSnapshotLineage } = await import(lineageUrl.href);
  const raw = freezeSnapshotLineage({ existing: null, importJobId: "i1", layer: "raw", snapshotId: "raw1", sourceRowNumber: 2, sourceRecordId: "r2" });
  assert.equal(raw.rawSnapshotId, "raw1");
  const published = freezeSnapshotLineage({ existing: raw, importJobId: null, layer: "published", snapshotId: "p1", sourceRowNumber: 1, sourceRecordId: "r2" });
  assert.equal(published.importJobId, "i1");
  assert.equal(published.rawSnapshotId, "raw1");
});

test("privacy boundary blocks direct identifiers without masking device metadata", async () => {
  const { containsDirectPatientIdentifiers, redactDirectPatientIdentifiers } = await import(privacyUrl.href);
  assert.equal(containsDirectPatientIdentifiers({ patientName: "张三", phone: "13800000000" }), true);
  assert.equal(containsDirectPatientIdentifiers({ deviceName: "CT 1", fileName: "台账.xlsx", manufacturerName: "厂商" }), false);
  assert.deepEqual(redactDirectPatientIdentifiers({ 姓名: "张三", deviceName: "CT 1", sheetName: "设备" }), { 姓名: "***", deviceName: "CT 1", sheetName: "设备" });
});

test("department published scope is fail-closed for unknown rows and never crosses departments", async () => {
  const { filterPublishedRecordsByDepartment } = await import(departmentScopeUrl.href);
  const rows = [{ id: 1, department: "影像科" }, { id: 2, departmentId: "lab" }, { id: 3 }, { id: 4, device: { department: "影像科" } }];
  assert.deepEqual(filterPublishedRecordsByDepartment(rows, ["影像科"]).map((row) => row.id), [1, 4]);
  assert.deepEqual(filterPublishedRecordsByDepartment(rows, []), []);
});
