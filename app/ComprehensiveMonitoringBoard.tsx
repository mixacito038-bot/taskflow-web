"use client";

import { useMemo } from "react";
import { Database, Gauge, ShieldCheck } from "lucide-react";
import styles from "./ComprehensiveMonitoring.module.css";
import {
  COMPREHENSIVE_MONITORING_VERSION,
  comprehensiveMonitoringCatalog,
  comprehensiveMonitoringCategories,
} from "./comprehensive-monitoring-template";
import type {
  HospitalMetricEvidence,
  HospitalMetricReadiness,
} from "./hospital-metric-catalog";
import { evaluateMetricSet, type FormulaFailureReason } from "./metric-formula";
import type { Device } from "./mock-data";

const readinessLabels: Record<HospitalMetricReadiness, string> = {
  ready: "首批核心",
  configure: "配置后启用",
  deferred: "暂缓展示",
};

const evidenceLabels: Record<HospitalMetricEvidence, string> = {
  direct: "资料直接",
  partial: "部分相关",
  industry: "行业补充",
  incomplete: "依据待补",
};

const failureLabels: Record<FormulaFailureReason, string> = {
  parse_error: "不可计算 · 公式错误",
  unknown_ref: "不可计算 · 引用缺失",
  missing_value: "数据缺失 · 待字段映射",
  division_by_zero: "不可计算 · 分母为零",
  not_finite: "不可计算 · 结果非有限值",
  circular_reference: "不可计算 · 循环引用",
};

function formatMetricValue(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  if (abs >= 1) return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

/**
 * 全面监测看板：五大类 30 项指标。数值只来自当前工作区真实持有的设备台账
 * 字段；派生指标经安全公式引擎计算。无法从现有字段推导的指标一律显示
 * “数据缺失 · 待字段映射”，绝不用演示数据冒充监测结果。
 */
export default function ComprehensiveMonitoringBoard({ devices }: { devices: Device[] }) {
  const { results, textValues, notes, computedCount } = useMemo(() => {
    const base = new Map<string, number | null>();
    const notes = new Map<string, string>();
    const textValues = new Map<string, string>();
    const hasDevices = devices.length > 0;

    const revenue = hasDevices ? devices.reduce((sum, device) => sum + device.revenue, 0) : null;
    base.set("hospital.monitor.revenue", revenue);
    if (revenue !== null) notes.set("hospital.monitor.revenue", `按 ${devices.length} 台设备台账收入合计`);

    const controllableCost = hasDevices
      ? devices.reduce(
        (sum, device) =>
          sum
          + device.cost.labor
          + device.cost.consumables
          + device.cost.depreciation
          + device.cost.maintenance
          + device.cost.energy,
        0,
      )
      : null;
    base.set("hospital.monitor.cost", controllableCost);
    if (controllableCost !== null) {
      notes.set("hospital.monitor.cost", "按台账人工+耗材+折旧+维保+能耗归集，不含空间与间接成本");
    }

    const examDevices = devices.filter((device) => device.serviceUnit === "检查人次");
    const examCount = examDevices.length
      ? examDevices.reduce((sum, device) => sum + device.serviceVolume, 0)
      : null;
    base.set("hospital.monitor.exam_count", examCount);
    if (examCount !== null) {
      notes.set(
        "hospital.monitor.exam_count",
        `仅合计服务单位为“检查人次”的 ${examDevices.length}/${devices.length} 台设备`,
      );
      notes.set("hospital.monitor.revenue_per_exam", "分母同检查人次口径，仅覆盖检查类设备");
      notes.set("hospital.monitor.cost_per_exam", "分母同检查人次口径，仅覆盖检查类设备");
    }

    const investment = hasDevices ? devices.reduce((sum, device) => sum + device.investment, 0) : null;
    const roi = revenue !== null && controllableCost !== null && investment !== null && investment > 0
      ? ((revenue - controllableCost) / investment) * 100
      : null;
    base.set("hospital.monitor.roi_rate", roi);
    if (roi !== null) {
      notes.set("hospital.monitor.roi_rate", "按（台账收入−可控直接成本）÷ 购置投入计算，非年度审计口径");
    }

    const payback = hasDevices
      ? devices.reduce((sum, device) => sum + device.forecastPayback, 0) / devices.length
      : null;
    base.set("hospital.monitor.payback_years", payback);
    if (payback !== null) {
      notes.set("hospital.monitor.payback_years", `${devices.length} 台设备台账预测回收期的台均值，非现金流核算结果`);
    }

    const warrantyStatuses = devices
      .map((device) => device.maintenanceStatus?.trim())
      .filter((status): status is string => Boolean(status));
    if (warrantyStatuses.length) {
      const counts = new Map<string, number>();
      for (const status of warrantyStatuses) counts.set(status, (counts.get(status) ?? 0) + 1);
      textValues.set(
        "hospital.monitor.warranty_status",
        [...counts.entries()].map(([status, count]) => `${status} ${count} 台`).join(" · "),
      );
      notes.set("hospital.monitor.warranty_status", `按 ${warrantyStatuses.length}/${devices.length} 台设备台账维保状态统计`);
    }

    const results = evaluateMetricSet(
      comprehensiveMonitoringCatalog.map((item) => ({ code: item.code, formulaExpr: item.formulaExpr })),
      (code) => (base.has(code) ? base.get(code) ?? null : null),
    );

    let computedCount = 0;
    for (const item of comprehensiveMonitoringCatalog) {
      if (results.get(item.code)?.ok || textValues.has(item.code)) computedCount += 1;
    }
    return { results, textValues, notes, computedCount };
  }, [devices]);

  return (
    <div className={styles.board}>
      <section className={`panel ${styles.intro}`} aria-label="全面监测模板说明">
        <div>
          <div className="eyebrow"><Gauge size={15} />全面监测专业分析模板</div>
          <p className={styles.introNote}>
            五大类 {comprehensiveMonitoringCatalog.length} 项指标覆盖设备效益、效率、临床使用质量、患者体验与设备保障。
            数值仅来自当前工作区已持有的设备台账字段；派生指标由安全公式引擎按口径计算，缺值、除零与循环引用都显式失败。
          </p>
          <p className={styles.introNote}>
            <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            数据准备中心可将该模板批量写入指标草稿（指标配置页选择“全面监测专业分析模板”后导入）；
            启用仍需完成字段映射与审核，未映射指标在此如实显示“数据缺失”。
          </p>
        </div>
        <div className={styles.introFacts}>
          <span>模板版本 {COMPREHENSIVE_MONITORING_VERSION}</span>
          <span>指标总数 {comprehensiveMonitoringCatalog.length}</span>
          <span>当前可计算 {computedCount} 项</span>
          <span>待字段映射 {comprehensiveMonitoringCatalog.length - computedCount} 项</span>
        </div>
      </section>

      {comprehensiveMonitoringCategories.map((category) => {
        const items = comprehensiveMonitoringCatalog.filter((item) => category.metricCodes.includes(item.code));
        return (
          <section className="panel" key={category.dimension} aria-label={`${category.title}指标`}>
            <div className="panel-heading">
              <div>
                <h3><Database size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />{category.title}</h3>
                <p>按单类/台设备口径 · {items.length} 项</p>
              </div>
              <span className="chart-note">
                可计算 {items.filter((item) => results.get(item.code)?.ok || textValues.has(item.code)).length}/{items.length}
              </span>
            </div>
            <div className={styles.grid}>
              {items.map((item) => {
                const text = textValues.get(item.code);
                const result = results.get(item.code);
                const note = notes.get(item.code);
                return (
                  <article className={styles.card} key={item.code}>
                    <div className={styles.cardHead}>
                      <div>
                        <strong>{item.name}</strong>
                        <small>{item.code}</small>
                      </div>
                      <span className={`status-pill ${item.readiness === "ready" ? "success" : item.readiness === "configure" ? "warning" : "neutral"}`}>
                        {readinessLabels[item.readiness]}
                      </span>
                    </div>
                    {text ? (
                      <div className={styles.value}>{text}</div>
                    ) : result?.ok ? (
                      <div className={styles.value}>
                        {formatMetricValue(result.value)}
                        <small>{item.unit}</small>
                      </div>
                    ) : (
                      <span className={styles.missing}>
                        {failureLabels[result?.ok === false ? result.reason : "missing_value"]}
                      </span>
                    )}
                    {note ? <span className={styles.valueNote}>{note}</span> : null}
                    <code className={styles.formula}>{item.formula}</code>
                    <div className={styles.cardFoot}>
                      <span className={`status-pill ${item.evidence === "direct" ? "success" : item.evidence === "incomplete" ? "danger" : "warning"}`}>
                        {evidenceLabels[item.evidence]}
                      </span>
                      {item.formulaExpr ? <span className={styles.derivedTag}>派生 · 公式引擎</span> : null}
                      <span className={styles.valueNote}>{item.unit} · {item.grain}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
