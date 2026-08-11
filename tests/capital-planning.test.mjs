import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("../app/CapitalPlanningCenter.tsx", import.meta.url);

test("capital planning ranks equipment with explainable scenarios", async () => {
  const source = await readFile(componentUrl, "utf8");
  for (const requiredText of [
    "3—5 年资本计划",
    "必须替换",
    "计划替换",
    "可延寿",
    "共享调拨",
    "不行动",
    "维修延寿",
    "更新替换",
    "评分依据",
  ]) {
    assert.match(source, new RegExp(requiredText));
  }
  assert.match(source, /riskScore/);
  assert.match(source, /maintenanceRatio/);
  assert.match(source, /scenario/);
});
