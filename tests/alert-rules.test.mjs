import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { defaultAlertRules, evaluateAlertRules, validateAlertRule } from "../app/alert-rules.ts";

const baseCost = { labor: 10, consumables: 10, depreciation: 10, maintenance: 5, energy: 3, space: 2, indirect: 5 };

function buildDevice(overrides = {}) {
  return {
    id: "dev-1",
    name: "测试设备",
    department: "医学影像科",
    investment: 1000,
    revenue: 100,
    serviceVolume: 1000,
    utilization: 80,
    forecastPayback: 5,
    cost: { ...baseCost },
    ...overrides,
  };
}

const noInsight = () => undefined;

test("default rules cover utilization, payback, net benefit and reliability with sensible thresholds", () => {
  assert.equal(defaultAlertRules.length, 4);
  const byMetric = Object.fromEntries(defaultAlertRules.map((rule) => [rule.metric, rule]));
  assert.deepEqual(
    [byMetric.utilization.operator, byMetric.utilization.threshold, byMetric.utilization.severity],
    ["lt", 55, "high"],
  );
  assert.deepEqual(
    [byMetric.forecastPayback.operator, byMetric.forecastPayback.threshold, byMetric.forecastPayback.severity],
    ["gt", 8, "medium"],
  );
  assert.deepEqual(
    [byMetric.netBenefit.operator, byMetric.netBenefit.threshold, byMetric.netBenefit.severity],
    ["lt", 0, "high"],
  );
  assert.deepEqual(
    [byMetric.reliabilityScore.operator, byMetric.reliabilityScore.threshold, byMetric.reliabilityScore.severity],
    ["lt", 60, "medium"],
  );
  for (const rule of defaultAlertRules) {
    assert.equal(rule.enabled, true);
    assert.equal(validateAlertRule(rule).length, 0);
    assert.match(rule.suggestion, /\{device\}/);
  }
});

test("lt and gt operators trigger strictly and boundary values do not fire", () => {
  const devices = [
    buildDevice({ id: "low-util", name: "低使用率设备", utilization: 48, forecastPayback: 12 }),
    buildDevice({ id: "healthy", name: "正常设备", utilization: 83, forecastPayback: 5 }),
    buildDevice({ id: "boundary", name: "临界设备", utilization: 55, forecastPayback: 8 }),
  ];
  const alerts = evaluateAlertRules(defaultAlertRules, devices, noInsight);
  assert.deepEqual(
    alerts.map((alert) => `${alert.ruleId}:${alert.deviceId}`).sort(),
    ["rule-payback-delay:low-util", "rule-utilization-low:low-util"],
  );
  const utilizationAlert = alerts.find((alert) => alert.ruleId === "rule-utilization-low");
  assert.equal(utilizationAlert.currentValue, 48);
  assert.equal(utilizationAlert.threshold, 55);
  assert.equal(utilizationAlert.unit, "%");
  assert.match(utilizationAlert.message, /低使用率设备/);
  assert.match(utilizationAlert.message, /低于预警阈值 55%/);
  const paybackAlert = alerts.find((alert) => alert.ruleId === "rule-payback-delay");
  assert.match(paybackAlert.message, /高于预警阈值 8年/);
});

test("net benefit equals revenue minus the sum of all cost fields", () => {
  const losing = buildDevice({ id: "losing", name: "亏损设备", revenue: 40 });
  const alerts = evaluateAlertRules(defaultAlertRules, [losing], noInsight);
  const benefitAlert = alerts.find((alert) => alert.ruleId === "rule-net-benefit-negative");
  assert.ok(benefitAlert, "negative net benefit should trigger the high severity rule");
  assert.equal(benefitAlert.currentValue, 40 - 45);
  assert.equal(benefitAlert.severity, "high");
  assert.match(benefitAlert.message, /年度净收益 -5万元/);
});

test("devices without insight are skipped for reliability instead of fabricating a score", () => {
  const devices = [
    buildDevice({ id: "with-insight", name: "带洞察设备" }),
    buildDevice({ id: "no-insight", name: "无洞察设备" }),
    buildDevice({ id: "nan-insight", name: "洞察缺失设备" }),
  ];
  const insights = {
    "with-insight": { scores: { reliability: 58 } },
    "nan-insight": { scores: { reliability: Number.NaN } },
  };
  const alerts = evaluateAlertRules(defaultAlertRules, devices, (deviceId) => insights[deviceId]);
  const reliabilityAlerts = alerts.filter((alert) => alert.ruleId === "rule-reliability-low");
  assert.deepEqual(reliabilityAlerts.map((alert) => alert.deviceId), ["with-insight"]);
  assert.equal(reliabilityAlerts[0].currentValue, 58);
});

test("alerts order deterministically by severity then distance from threshold", () => {
  const devices = [
    buildDevice({ id: "near-medium", name: "轻微超期", utilization: 80, forecastPayback: 9 }),
    buildDevice({ id: "far-high", name: "严重闲置", utilization: 10, forecastPayback: 5 }),
    buildDevice({ id: "far-medium", name: "严重超期", utilization: 80, forecastPayback: 20 }),
    buildDevice({ id: "near-high", name: "轻微闲置", utilization: 50, forecastPayback: 5 }),
  ];
  const alerts = evaluateAlertRules(defaultAlertRules, devices, noInsight);
  assert.deepEqual(
    alerts.map((alert) => alert.deviceId),
    ["far-high", "near-high", "far-medium", "near-medium"],
  );
});

test("disabled or invalid rules never emit alerts", () => {
  const losing = buildDevice({ id: "losing", name: "亏损设备", revenue: 40, utilization: 20 });
  const disabled = defaultAlertRules.map((rule) => ({ ...rule, enabled: false }));
  assert.deepEqual(evaluateAlertRules(disabled, [losing], noInsight), []);
  const invalid = defaultAlertRules.map((rule) => ({ ...rule, threshold: Number.NaN }));
  assert.deepEqual(evaluateAlertRules(invalid, [losing], noInsight), []);
});

test("suggested actions replace the device placeholder and carry an owner", () => {
  const losing = buildDevice({ id: "dr-99", name: "体检 DR", revenue: 40, utilization: 20 });
  const alerts = evaluateAlertRules(defaultAlertRules, [losing], noInsight);
  assert.ok(alerts.length >= 2);
  for (const alert of alerts) {
    assert.doesNotMatch(alert.suggestedAction.title, /\{device\}/);
    assert.match(alert.suggestedAction.title, /体检 DR/);
    assert.equal(alert.suggestedAction.issue, alert.message);
    assert.ok(alert.suggestedAction.owner.includes(losing.department) || alert.suggestedAction.owner.includes("医学装备部"));
  }
});

test("validateAlertRule reports Chinese messages for empty name and non-finite threshold", () => {
  const errors = validateAlertRule({ ...defaultAlertRules[0], name: "  ", threshold: Number.NaN });
  assert.deepEqual(errors, ["规则名称不能为空", "预警阈值必须是有效数字"]);
  assert.deepEqual(validateAlertRule(defaultAlertRules[0]), []);
});

test("改进中心把诊断问题接成任务，去重靠结构化来源而不是拼字符串 id", async () => {
  const source = await readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8");
  // 旧实现把 ruleId+deviceId 拼成 action id 当去重键：一旦规则改名或设备换 id，
  // 同一个问题就会被当成新问题再冒出来一次。改成任务上挂结构化的 sourceFinding。
  assert.match(source, /sourceFinding\?: ActionSource/);
  assert.match(source, /function matchesFinding\(action: ImprovementAction, deviceId: string, finding: Finding\)/);
  // 已认领的问题要从待认领里摘掉，并显示是被哪条任务领走的
  assert.match(source, /pendingRows/);
  assert.match(source, /claimedRows/);
  assert.match(source, /已认领/);
  // 空态要说清是"没问题"还是"没数据"，不能笼统一句"暂无"
  assert.match(source, /本期诊断没有产生问题，或数据尚未发布。/);
  assert.match(source, /运营类问题都已认领。/);
  // 基线取自诊断事实，目标取自阈值；取不到就留空，不编数字
  assert.match(source, /没有对应事实就留空，不编数字/);
});
