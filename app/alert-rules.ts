import type { Device } from "./mock-data";

export type AlertMetric = "utilization" | "forecastPayback" | "netBenefit" | "reliabilityScore";
export type AlertOperator = "lt" | "gt";
export type AlertSeverity = "high" | "medium";

export type AlertRule = {
  id: string;
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  unit: string;
  severity: AlertSeverity;
  enabled: boolean;
  suggestion: string;
};

export type DeviceAlert = {
  ruleId: string;
  deviceId: string;
  deviceName: string;
  department: string;
  severity: AlertSeverity;
  currentValue: number;
  threshold: number;
  unit: string;
  message: string;
  suggestedAction: { title: string; issue: string; owner: string };
};

export type AlertRuleInsight = { scores: { reliability: number } };
export type AlertInsightLookup = (deviceId: string) => AlertRuleInsight | undefined;

export const alertMetricLabels: Record<AlertMetric, string> = {
  utilization: "使用率",
  forecastPayback: "预计回本",
  netBenefit: "年度净收益",
  reliabilityScore: "可靠性评分",
};

export const defaultAlertRules: AlertRule[] = [
  {
    id: "rule-utilization-low",
    name: "使用率过低",
    metric: "utilization",
    operator: "lt",
    threshold: 55,
    unit: "%",
    severity: "high",
    enabled: true,
    suggestion: "对{device}开展低使用率专项：梳理适应证池、合并或共享排班并复核预约模板",
  },
  {
    id: "rule-payback-delay",
    name: "预计回本周期过长",
    metric: "forecastPayback",
    operator: "gt",
    threshold: 8,
    unit: "年",
    severity: "medium",
    enabled: true,
    suggestion: "对{device}组织回本偏差分析：核对收入结构与现金成本，形成提量或降本方案",
  },
  {
    id: "rule-net-benefit-negative",
    name: "年度净收益为负",
    metric: "netBenefit",
    operator: "lt",
    threshold: 0,
    unit: "万元",
    severity: "high",
    enabled: true,
    suggestion: "对{device}启动亏损设备治理：评估合并排班、调拨共享或纳入更新论证",
  },
  {
    id: "rule-reliability-low",
    name: "可靠性评分偏低",
    metric: "reliabilityScore",
    operator: "lt",
    threshold: 60,
    unit: "分",
    severity: "medium",
    enabled: true,
    suggestion: "对{device}制定保障提升计划：复盘故障史、前置关键备件并比价维保方案",
  },
];

const suggestedOwnerByMetric: Record<AlertMetric, (department: string) => string> = {
  utilization: (department) => `${department} / 运营部`,
  forecastPayback: (department) => `${department} / 财务部`,
  netBenefit: (department) => `${department} / 财务部`,
  reliabilityScore: (department) => `医学装备部 / ${department}`,
};

function deviceNetBenefit(device: Device) {
  return device.revenue - Object.values(device.cost).reduce((sum, value) => sum + value, 0);
}

function metricValueFor(rule: AlertRule, device: Device, insightFor: AlertInsightLookup): number | null {
  switch (rule.metric) {
    case "utilization":
      return device.utilization;
    case "forecastPayback":
      return device.forecastPayback;
    case "netBenefit":
      return deviceNetBenefit(device);
    case "reliabilityScore": {
      const insight = insightFor(device.id);
      if (!insight) return null;
      return insight.scores.reliability;
    }
  }
}

function formatAlertValue(value: number) {
  return String(Number(value.toFixed(1)));
}

export function evaluateAlertRules(
  rules: readonly AlertRule[],
  devices: readonly Device[],
  insightFor: AlertInsightLookup,
): DeviceAlert[] {
  const alerts: DeviceAlert[] = [];
  for (const rule of rules) {
    if (!rule.enabled || validateAlertRule(rule).length) continue;
    for (const device of devices) {
      const value = metricValueFor(rule, device, insightFor);
      if (value === null || !Number.isFinite(value)) continue;
      const hit = rule.operator === "lt" ? value < rule.threshold : value > rule.threshold;
      if (!hit) continue;
      const direction = rule.operator === "lt" ? "低于" : "高于";
      const message = `${device.name}${alertMetricLabels[rule.metric]} ${formatAlertValue(value)}${rule.unit}，${direction}预警阈值 ${formatAlertValue(rule.threshold)}${rule.unit}`;
      alerts.push({
        ruleId: rule.id,
        deviceId: device.id,
        deviceName: device.name,
        department: device.department,
        severity: rule.severity,
        currentValue: Number(value.toFixed(1)),
        threshold: rule.threshold,
        unit: rule.unit,
        message,
        suggestedAction: {
          title: rule.suggestion.replaceAll("{device}", device.name),
          issue: message,
          owner: suggestedOwnerByMetric[rule.metric](device.department),
        },
      });
    }
  }
  return alerts.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "high" ? -1 : 1;
    const leftDistance = Math.abs(left.currentValue - left.threshold);
    const rightDistance = Math.abs(right.currentValue - right.threshold);
    if (leftDistance !== rightDistance) return rightDistance - leftDistance;
    if (left.deviceId !== right.deviceId) return left.deviceId < right.deviceId ? -1 : 1;
    return left.ruleId < right.ruleId ? -1 : 1;
  });
}

export function validateAlertRule(rule: AlertRule): string[] {
  const errors: string[] = [];
  if (!rule.name.trim()) errors.push("规则名称不能为空");
  if (!Number.isFinite(rule.threshold)) errors.push("预警阈值必须是有效数字");
  return errors;
}
