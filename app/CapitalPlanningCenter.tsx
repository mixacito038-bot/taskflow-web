"use client";

import { useMemo, useState } from "react";
import { ArrowRight, BadgeDollarSign, CalendarRange, CircleAlert, GitCompareArrows, ShieldCheck } from "lucide-react";
import type { Device } from "./mock-data";
import { netBenefit, roi, totalCost } from "./mock-data";
import styles from "./CapitalPlanningCenter.module.css";

type CapitalBand = "必须替换" | "计划替换" | "可延寿" | "共享调拨" | "持续观察";

type CapitalCandidate = {
  device: Device;
  age: number;
  remainingLife: number;
  maintenanceRatio: number;
  riskScore: number;
  band: CapitalBand;
  reasons: string[];
};

type Props = {
  devices: Device[];
  onSelectDevice: (device: Device) => void;
};

const money = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function classify(device: Device): CapitalCandidate {
  const age = Math.max(0, 2026 - Number(device.enabledDate.slice(0, 4)));
  const usefulLife = device.usefulLifeYears ?? 10;
  const remainingLife = usefulLife - age;
  const maintenanceRatio = device.revenue > 0 ? (device.cost.maintenance / device.revenue) * 100 : 100;
  const paybackDelay = Math.max(0, device.forecastPayback - device.planPayback);
  const riskScore = Math.min(100, Math.round(
    Math.max(0, age / usefulLife) * 35
      + Math.max(0, 70 - device.utilization) * 0.75
      + Math.min(25, maintenanceRatio)
      + Math.min(20, paybackDelay * 6),
  ));
  const reasons: string[] = [];
  if (remainingLife <= 1) reasons.push("接近或超过预计寿命");
  if (maintenanceRatio >= 15) reasons.push("维护收入比偏高");
  if (device.utilization < 60) reasons.push("利用率低于 60%");
  if (paybackDelay >= 1.5) reasons.push("回收期明显延后");
  if (!reasons.length) reasons.push("运行与经济指标处于可接受区间");

  let band: CapitalBand = "持续观察";
  if (remainingLife <= 0 && riskScore >= 65) band = "必须替换";
  else if (remainingLife <= 2 || riskScore >= 60) band = "计划替换";
  else if (device.utilization < 60 && age < usefulLife * 0.7) band = "共享调拨";
  else if (remainingLife <= 4 || maintenanceRatio >= 12) band = "可延寿";
  return { device, age, remainingLife, maintenanceRatio, riskScore, band, reasons };
}

function scenario(candidate: CapitalCandidate, mode: "不行动" | "维修延寿" | "更新替换") {
  const device = candidate.device;
  const annualContribution = netBenefit(device);
  if (mode === "不行动") {
    return { investment: 0, annualImpact: annualContribution, riskChange: 0, note: "维持当前运行与维护策略" };
  }
  if (mode === "维修延寿") {
    const investment = Math.max(20, device.cost.maintenance * 0.45);
    return {
      investment,
      annualImpact: annualContribution + device.revenue * 0.03 - investment / 3,
      riskChange: -Math.min(22, Math.round(candidate.riskScore * 0.3)),
      note: "按三年摊销改造投入，并估算可用率改善带来的贡献",
    };
  }
  const investment = Math.max(device.investment * 0.82, device.investment - device.cost.depreciation * candidate.age);
  return {
    investment,
    annualImpact: Math.max(annualContribution, device.revenue * 0.16) - investment / (device.usefulLifeYears ?? 10),
    riskChange: -Math.min(55, candidate.riskScore),
    note: "以替换估算价和预计寿命进行管理情景测算",
  };
}

export default function CapitalPlanningCenter({ devices, onSelectDevice }: Props) {
  const candidates = useMemo(() => devices.map(classify).sort((a, b) => b.riskScore - a.riskScore), [devices]);
  const [selectedId, setSelectedId] = useState(candidates[0]?.device.id ?? "");
  const selected = candidates.find((item) => item.device.id === selectedId) ?? candidates[0];
  const summary = useMemo(() => ({
    urgent: candidates.filter((item) => item.band === "必须替换" || item.band === "计划替换").length,
    share: candidates.filter((item) => item.band === "共享调拨").length,
    budget: candidates.filter((item) => item.band === "必须替换" || item.band === "计划替换")
      .reduce((sum, item) => sum + item.device.investment * 0.82, 0),
  }), [candidates]);

  if (!selected) return <div className={styles.empty}>暂无可用于资本规划的已发布设备数据。</div>;
  const scenarios = (["不行动", "维修延寿", "更新替换"] as const).map((mode) => ({ mode, ...scenario(selected, mode) }));

  return (
    <div className={styles.root}>
      <header className={styles.heading}>
        <div><span><CalendarRange size={15} />战略资产管理</span><h1>3—5 年资本计划</h1></div>
        <div className={styles.guardrail}><ShieldCheck size={17} /><b>管理建议，不替代临床安全与预算审批</b></div>
      </header>

      <section className={styles.metrics}>
        <article><CircleAlert size={19} /><div><span>更新候选</span><strong>{summary.urgent} 台</strong><small>必须替换或计划替换</small></div></article>
        <article><GitCompareArrows size={19} /><div><span>共享调拨候选</span><strong>{summary.share} 台</strong><small>优先盘活而非新增采购</small></div></article>
        <article><BadgeDollarSign size={19} /><div><span>更新预算情景</span><strong>{money.format(summary.budget)} 万</strong><small>按当前重置成本 82% 粗估</small></div></article>
      </section>

      <section className={styles.layout}>
        <div className={styles.tablePanel}>
          <div className={styles.panelTitle}><div><h2>设备更新优先级</h2></div></div>
          <div className={styles.tableWrap}><table><thead><tr><th>设备</th><th>年限</th><th>利用率</th><th>维护/收入</th><th>风险分</th><th>建议</th></tr></thead>
            <tbody>{candidates.map((item) => <tr key={item.device.id} className={item.device.id === selected.device.id ? styles.selected : ""} onClick={() => setSelectedId(item.device.id)}>
              <td><b>{item.device.shortName}</b><small>{item.device.department}</small></td><td>{item.age} 年<small>剩余 {item.remainingLife} 年</small></td><td>{item.device.utilization}%</td><td>{item.maintenanceRatio.toFixed(1)}%</td><td><strong>{item.riskScore}</strong></td><td><span className={`${styles.band} ${styles[`band${item.band}`]}`}>{item.band}</span></td>
            </tr>)}</tbody></table></div>
        </div>

        <aside className={styles.detail}>
          <div><span className={styles.kicker}>评分依据</span><h2>{selected.device.shortName}</h2><p>{selected.device.assetCode} · {selected.device.model}</p></div>
          <div className={styles.score}><strong>{selected.riskScore}</strong><span>/100 风险分</span></div>
          <ul>{selected.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <dl><div><dt>当前总成本</dt><dd>{money.format(totalCost(selected.device))} 万/年</dd></div><div><dt>当前净收益</dt><dd>{money.format(netBenefit(selected.device))} 万/年</dd></div><div><dt>投资收益率</dt><dd>{roi(selected.device).toFixed(1)}%</dd></div></dl>
          <button onClick={() => onSelectDevice(selected.device)}>查看单机证据<ArrowRight size={16} /></button>
        </aside>
      </section>

      <section className={styles.scenarios}>
        <div className={styles.panelTitle}><div><h2>处置 scenario 情景比较</h2><p>所有估算均需在正式立项时替换为财务确认值。</p></div></div>
        <div className={styles.scenarioGrid}>{scenarios.map((item) => <article key={item.mode}>
          <span>{item.mode}</span><strong>{money.format(item.investment)} 万</strong><small>预计新增投入</small>
          <dl><div><dt>年影响</dt><dd>{money.format(item.annualImpact)} 万</dd></div><div><dt>风险变化</dt><dd>{item.riskChange} 分</dd></div></dl>
          <p>{item.note}</p>
        </article>)}</div>
      </section>
    </div>
  );
}

