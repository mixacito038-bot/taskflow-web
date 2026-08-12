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
  // 改进中心不再自己算可靠性均值——缺数判断已收口到诊断内核，
  // 页面只负责把 null 显示成「—」。多一处判断就是多一处口径分裂。
  assert.doesNotMatch(improvement, /function finiteAverage/);
  assert.doesNotMatch(improvement, /insights\.reduce[\s\S]*Math\.max\(insights\.length, 1\)/);
  const kernel = await readFile(new URL("../app/benefit-diagnosis.ts", import.meta.url), "utf8");
  // 内核里分母为 0 一律返回 null，绝不落成 0 或 NaN
  assert.match(kernel, /=== 0 \? null|denominator[\s\S]{0,80}null/);
  assert.match(platform, /availabilityValues/);
});

test("formal mode cannot reset demo actions or display a demo supply label", async () => {
  const [improvement, platform] = await Promise.all([
    readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
  ]);

  // 演示任务的写入守卫从组件搬到了平台层：改进中心不再关心自己在哪个模式下，
  // 由数据兜底那一处统一决定「正式模式拿到的是空数组」。
  // 守卫只有一处，比组件和平台各判一次更不容易漏。
  assert.doesNotMatch(improvement, /demoMode\?: boolean/);
  assert.match(platform, /improvementStore\[effectiveHospitalId\] \?\? \(demoMode \? initialActions : \[\]\)/);
  assert.match(platform, /const current = currentStore\[effectiveHospitalId\] \?\? \(demoMode \? initialActions : \[\]\)/);
  assert.match(platform, /const publishedSupplyStatus = sessionState !== "verified"/);
  assert.match(platform, /:\s*"正式数据未发布"/);
  assert.match(platform, /\{sessionState !== "verified" \|\| publishedData\.publication \? <section className="role-summary"/);
  assert.doesNotMatch(platform, /sessionState === "verified" && publishedData\.publication \?[^\n]+:\s*"演示口径：2026-V2\.0"/);
});
