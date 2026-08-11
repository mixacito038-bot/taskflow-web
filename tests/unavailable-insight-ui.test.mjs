import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("unknown equipment renders an explicit unavailable state instead of NaN or zero scores", async () => {
  const [views, improvement, platform] = await Promise.all([
    readFile(new URL("../app/InsightViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(views, /profile\.dataStatus === "unavailable"/);
  assert.match(views, /暂无已发布洞察/);
  assert.match(views, /没有用其他设备的示例值代替/);
  assert.match(improvement, /Number\.isFinite\(insight\.availabilityRate\)/);
  assert.match(improvement, /function finiteAverage/);
  assert.match(improvement, /available\.length[\s\S]*:\s*null/);
  assert.match(improvement, /<strong>待发布<\/strong>/);
  assert.match(improvement, /<b>数据缺失<\/b>/);
  assert.doesNotMatch(improvement, /insights\.reduce[\s\S]*Math\.max\(insights\.length, 1\)/);
  assert.match(platform, /availabilityValues/);
});

test("formal mode cannot reset demo actions or display a demo supply label", async () => {
  const [improvement, platform] = await Promise.all([
    readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(improvement, /demoMode\?: boolean/);
  assert.match(improvement, /if \(!demoMode\)[\s\S]*正式模式不能写入演示任务/);
  assert.match(improvement, /\{demoMode \? <button[^>]*onClick=\{resetActions\}/);
  assert.match(platform, /<ImprovementCenter[\s\S]*demoMode=\{demoMode\}/);
  assert.match(platform, /const publishedSupplyStatus = sessionState !== "verified"/);
  assert.match(platform, /:\s*"正式数据未发布"/);
  assert.match(platform, /\{sessionState !== "verified" \|\| publishedData\.publication \? <section className="role-summary"/);
  assert.doesNotMatch(platform, /sessionState === "verified" && publishedData\.publication \?[^\n]+:\s*"演示口径：2026-V2\.0"/);
});
