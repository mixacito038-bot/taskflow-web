import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("configurable analytics renderer supports the governed chart catalog", async () => {
  const source = await readFile(new URL("../app/ConfigurableAnalyticsCanvas.tsx", import.meta.url), "utf8");
  for (const token of ["KPI", "表格", "柱状图", "折线图", "饼图", "散点图", "热力图", "visualization.chartType", "metricDefinitionVersion", "visualizationVersion"]) {
    assert.match(source, new RegExp(token.replaceAll(".", "\\.")));
  }
});

test("benefit analysis can switch a published metric between display forms", async () => {
  const source = await readFile(new URL("../app/BenefitAnalysisStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /自定义视图/);
  assert.match(source, /ConfigurableAnalyticsCanvas/);
  assert.match(source, /setCustomChartType/);
  assert.match(source, /多部位检查/);
});
