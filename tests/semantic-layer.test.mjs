import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateExamFacts,
  allocateExamByBodyPart,
  validateFieldDefinition,
  validateMetricDefinition,
  validateVisualizationDefinition,
} from "../app/analytics-semantic-layer.ts";

const events = [
  { examId: "E1", deviceId: "CT-1", revenue: 300, durationMinutes: 20, bodyParts: [{ code: "CHEST", name: "胸部", primary: true }, { code: "ABDOMEN", name: "腹部" }] },
  { examId: "E2", deviceId: "CT-1", revenue: 120, durationMinutes: 10, bodyParts: [{ code: "HEAD", name: "头颅", primary: true }] },
];

test("counts a multi-part exam once at exam grain", () => {
  assert.equal(aggregateExamFacts(events, { code: "exam_count", aggregation: "count_distinct", field: "examId" }).value, 2);
});

test("allocates revenue to body parts without double counting", () => {
  const allocated = allocateExamByBodyPart(events, "equal");
  assert.equal(allocated.reduce((sum, row) => sum + row.allocatedRevenue, 0), 420);
  assert.deepEqual(allocated.filter((row) => row.examId === "E1").map((row) => row.allocatedRevenue), [150, 150]);
});

test("validates metadata-driven fields, metrics and supported visualizations", () => {
  assert.deepEqual(validateFieldDefinition({ code: "body_part", name: "检查部位", dataType: "dictionary", status: "draft" }), []);
  assert.deepEqual(validateMetricDefinition({ code: "revenue", name: "设备收入", aggregation: "sum", field: "revenue", status: "draft", version: 1 }), []);
  for (const chartType of ["kpi", "table", "bar", "line", "pie", "scatter", "heatmap"]) {
    assert.deepEqual(validateVisualizationDefinition({ code: `view_${chartType}`, name: chartType, metricCode: "revenue", chartType, status: "draft", version: 1 }), []);
  }
});

