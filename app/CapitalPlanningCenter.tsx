"use client";

// 本页的分档、风险分、情景测算一律来自 app/benefit-diagnosis.ts。
// 之前这里自带 classify() 和 scenario()，改进中心另有一套情景测算，alert-rules 又有一套问题判定：
// 同一台设备在三个页面会给出互相矛盾的结论（分析页说该换、资本计划说可延寿），
// 院长照着哪一页拍板都可能是错的。所以这里只做展示，一行口径都不再自己算。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarRange,
  CircleAlert,
  Download,
  GitCompareArrows,
  Search,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { SCENARIO_MODES, scenarioFor } from "./benefit-diagnosis";
import type { CapitalBand, DeviceDiagnosis, FindingSeverity } from "./benefit-diagnosis";
import styles from "./CapitalPlanningCenter.module.css";

// 金额口径是元（台账是万元，内核已经换算过），页面只负责加千分位。
const moneyFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const ratioFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

/** 缺数一律显示「—」：论证材料里编一个 0 比留白危险得多 */
function moneyText(value: number | null): string {
  return value === null ? "—" : `${moneyFormat.format(value)} 元`;
}

function ratioText(value: number | null): string {
  return value === null ? "—" : `${ratioFormat.format(value)}%`;
}

function yearsText(value: number | null): string {
  return value === null ? "—" : `${ratioFormat.format(value)} 年`;
}

/** 风险分的条色只有三档，条本身在 CSS 里，颜色跟着数据走所以只能 inline 传 */
function riskFill(score: number): string {
  return score >= 70 ? "var(--red)" : score >= 45 ? "var(--orange)" : "var(--primary)";
}

// 分档到模块类的显式映射：不用 styles[`band${band}`] 拼串，拼出来的类名静态检查抓不到，
// 少写一条样式时页面会静悄悄塌掉。
const BAND_CLASS: Record<CapitalBand, string> = {
  必须替换: styles.bandReplaceNow,
  计划替换: styles.bandReplacePlan,
  可延寿: styles.bandExtend,
  共享调拨: styles.bandShare,
  持续观察: styles.bandWatch,
};

const SEVERITY_CLASS: Record<FindingSeverity, string> = {
  high: styles.sevHigh,
  medium: styles.sevMedium,
  low: styles.sevLow,
};

// 筛选条里的分档顺序是展示顺序（紧急在前），不是判定口径，判定全在内核里
const BAND_ORDER: readonly CapitalBand[] = ["必须替换", "计划替换", "共享调拨", "可延寿", "持续观察"];

const SUMMARY_CARDS = [
  { band: "必须替换" as CapitalBand, hint: "已到寿且风险偏高", Icon: CircleAlert },
  { band: "计划替换" as CapitalBand, hint: "列入年度预算排队", Icon: CalendarRange },
  { band: "共享调拨" as CapitalBand, hint: "先盘活存量再采购", Icon: GitCompareArrows },
  { band: "可延寿" as CapitalBand, hint: "维修改造后可续用", Icon: Wrench },
];

function csvCell(value: string | number): string {
  const text = String(value);
  // 以 =+-@ 开头的内容加前导引号，防 CSV 注入
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(fileName: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  // 首行 BOM 让 Excel 认出 UTF-8，否则中文列头全是乱码
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}

export default function CapitalPlanningCenter({
  diagnoses,
  periodLabel,
  onSelectDevice,
  focusDeviceId,
  onFocusConsumed,
  canManage,
  notify,
}: {
  diagnoses: DeviceDiagnosis[];
  periodLabel: string;
  onSelectDevice: (deviceId: string) => void;
  /** 从效益分析页/改进中心点「送资本论证」带过来的设备：进页面直接选中它 */
  focusDeviceId?: string;
  onFocusConsumed?: () => void;
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
}) {
  const ranked = useMemo(
    () => [...diagnoses].sort((left, right) => right.riskScore - left.riskScore),
    [diagnoses],
  );

  const [keyword, setKeyword] = useState("");
  const [bandFilter, setBandFilter] = useState<CapitalBand | "全部">("全部");
  // 惰性初值：带着 focusDeviceId 进来就在首帧选中它。
  // 若改成「先选第一台、再在 effect 里 setSelectedId」，会多一次级联渲染，仓库的 eslint 也会拦。
  const [selectedId, setSelectedId] = useState(() => {
    const focused = focusDeviceId && diagnoses.some((item) => item.facts.deviceId === focusDeviceId)
      ? focusDeviceId
      : "";
    return focused || ranked[0]?.facts.deviceId || "";
  });

  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const focusHandled = useRef(false);

  useEffect(() => {
    // 一次性：焦点设备只在进页面时消费一次，之后用户自己点行，不该被父级的旧焦点再拽回去
    if (focusHandled.current) return;
    focusHandled.current = true;
    if (!focusDeviceId) return;
    rowRefs.current.get(focusDeviceId)?.scrollIntoView({ block: "center", behavior: "smooth" });
    // 找不到也要通知父级清掉，否则这个焦点会一直挂在上游状态里
    onFocusConsumed?.();
  }, [focusDeviceId, onFocusConsumed]);

  const bandCounts = useMemo(() => {
    const counts = new Map<CapitalBand, number>();
    for (const item of ranked) counts.set(item.band, (counts.get(item.band) ?? 0) + 1);
    return counts;
  }, [ranked]);

  // 预算情景 = 需要更新的那批设备走「更新替换」情景的投入合计，仍然由内核算，本页只求和
  const replaceBudget = useMemo(
    () => ranked
      .filter((item) => item.band === "必须替换" || item.band === "计划替换")
      .reduce((sum, item) => sum + scenarioFor(item, "更新替换").investment, 0),
    [ranked],
  );

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return ranked.filter((item) => {
      if (bandFilter !== "全部" && item.band !== bandFilter) return false;
      if (!key) return true;
      return [item.facts.name, item.facts.assetCode, item.facts.department]
        .some((text) => text.toLowerCase().includes(key));
    });
  }, [ranked, keyword, bandFilter]);

  const selected = ranked.find((item) => item.facts.deviceId === selectedId) ?? ranked[0];

  function exportPlan() {
    if (!filtered.length) return notify("当前筛选条件下没有设备可导出", "error");
    const header = [
      "资产编号", "设备名称", "型号", "科室", "已用年限", "剩余寿命",
      "使用率(%)", "维护收入比(%)", "本期结余(元)", "风险分", "处置分档", "问题标签", "更新替换投入(元)",
    ];
    const rows = filtered.map((item) => {
      const facts = item.facts;
      return [
        facts.assetCode, facts.name, facts.model, facts.department, facts.age, facts.remainingLife,
        // 缺数导出成空单元格，不补 0：财务拿去做预算时空格能被看见，0 会被直接求和
        facts.utilization === null ? "" : facts.utilization,
        facts.maintenanceRatio === null ? "" : facts.maintenanceRatio,
        facts.margin === null ? "" : facts.margin,
        item.riskScore,
        item.band,
        item.findings.map((finding) => finding.title).join(" / "),
        Math.round(scenarioFor(item, "更新替换").investment),
      ];
    });
    downloadCsv(`资本计划-${periodLabel}-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
    notify(`已导出 ${filtered.length} 台设备的资本论证清单`);
  }

  if (!selected) {
    return <div className={styles.empty}>本期没有可用于资本论证的设备诊断数据，请先在设备数据填报里录入本期数据。</div>;
  }

  const facts = selected.facts;
  const outcomes = SCENARIO_MODES.map((mode) => scenarioFor(selected, mode));

  return (
    <div className={styles.root}>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><CalendarRange size={15} />战略资产管理</div>
          <h1>资本计划</h1>
          <p>期间口径 {periodLabel} · 分档与风险分来自统一诊断内核</p>
        </div>
        <div className="heading-actions">
          {canManage ? (
            <button className="secondary-button" onClick={exportPlan}><Download size={16} />导出论证清单</button>
          ) : null}
          <div className={styles.guardrail}>
            <ShieldCheck size={16} />
            <b>管理建议，不替代临床安全与预算审批</b>
          </div>
        </div>
      </div>

      <section className={styles.metrics}>
        {SUMMARY_CARDS.map(({ band, hint, Icon }) => (
          <article key={band} className={styles.metricCard}>
            <span className={`${styles.metricIcon} ${BAND_CLASS[band]}`}><Icon size={18} /></span>
            <div>
              <span>{band}</span>
              <strong>{bandCounts.get(band) ?? 0} 台</strong>
              <small>{hint}</small>
            </div>
          </article>
        ))}
        <article className={styles.metricCard}>
          <span className={`${styles.metricIcon} ${styles.metricIconBudget}`}><BadgeDollarSign size={18} /></span>
          <div>
            <span>更新预算情景合计</span>
            <strong>{moneyText(replaceBudget)}</strong>
            <small>必须替换与计划替换设备的更新替换投入之和</small>
          </div>
        </article>
      </section>

      <div className={styles.layout}>
        <section className={styles.tablePanel}>
          <div className={styles.panelHead}>
            <div>
              <h2>设备更新优先级</h2>
              <p>按风险分降序，当前 {filtered.length} / {ranked.length} 台</p>
            </div>
            <div className={styles.filters}>
              <label className={`search-field ${styles.searchBox}`}>
                <Search size={15} />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索设备名称 / 资产编号 / 科室"
                  aria-label="搜索设备"
                />
              </label>
              <div className={styles.chipRow} role="group" aria-label="处置分档筛选">
                <button
                  type="button"
                  className={`${styles.chip} ${bandFilter === "全部" ? styles.chipActive : ""}`}
                  aria-pressed={bandFilter === "全部"}
                  onClick={() => setBandFilter("全部")}
                >
                  全部<i>{ranked.length}</i>
                </button>
                {BAND_ORDER.map((band) => (
                  <button
                    key={band}
                    type="button"
                    className={`${styles.chip} ${bandFilter === band ? styles.chipActive : ""}`}
                    aria-pressed={bandFilter === band}
                    onClick={() => setBandFilter(band)}
                  >
                    {band}<i>{bandCounts.get(band) ?? 0}</i>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th>科室</th>
                  <th>资产编号</th>
                  <th>年限</th>
                  <th className="num">使用率</th>
                  <th className="num">维护收入比</th>
                  <th className="num">本期结余</th>
                  <th className="num">风险分</th>
                  <th>问题</th>
                  <th>处置分档</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length ? filtered.map((item) => {
                  const row = item.facts;
                  return (
                    <tr
                      key={row.deviceId}
                      ref={(node) => {
                        if (node) rowRefs.current.set(row.deviceId, node);
                        else rowRefs.current.delete(row.deviceId);
                      }}
                      className={row.deviceId === facts.deviceId ? styles.selectedRow : undefined}
                      onClick={() => setSelectedId(row.deviceId)}
                    >
                      <td>
                        <div className={styles.deviceCell}>
                          <strong>{row.name}</strong>
                          <small>{row.model}</small>
                        </div>
                      </td>
                      <td>{row.department}</td>
                      <td>{row.assetCode}</td>
                      <td>
                        {row.age} 年
                        <small className={styles.subLine}>剩余 {row.remainingLife} 年</small>
                      </td>
                      <td className="num">{ratioText(row.utilization)}</td>
                      <td className="num">{ratioText(row.maintenanceRatio)}</td>
                      <td className={`num ${row.margin !== null && row.margin < 0 ? styles.marginNegative : ""}`}>
                        {moneyText(row.margin)}
                      </td>
                      <td className="num">
                        <div className={styles.riskCell}>
                          <strong>{item.riskScore}</strong>
                          <span className={styles.riskTrack}>
                            <i style={{ width: `${Math.min(100, item.riskScore)}%`, background: riskFill(item.riskScore) }} />
                          </span>
                        </div>
                      </td>
                      <td>
                        {/* 问题标签就是论证依据，hover 出 evidence：不给证据的分档在预算会上一句话就被问倒 */}
                        <div className={styles.findingTags}>
                          {item.findings.length ? item.findings.map((finding) => (
                            <span
                              key={finding.code}
                              className={`${styles.tag} ${SEVERITY_CLASS[finding.severity]}`}
                              title={finding.evidence}
                            >
                              {finding.title}
                            </span>
                          )) : <span className={styles.tag}>无</span>}
                        </div>
                      </td>
                      <td><span className={`${styles.band} ${BAND_CLASS[item.band]}`}>{item.band}</span></td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={10} className={styles.emptyRow}>没有符合筛选条件的设备</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className={styles.detail}>
          <div className={styles.detailHead}>
            <span className="eyebrow">评分依据</span>
            <h2>{facts.name}</h2>
            <p>{facts.assetCode} · {facts.model} · {facts.department}</p>
          </div>

          <div className={styles.scoreBox}>
            <strong>{selected.riskScore}</strong>
            <span>/100 风险分</span>
            <span className={`${styles.band} ${BAND_CLASS[selected.band]}`}>{selected.band}</span>
            <span className={styles.quadrantPill}>{selected.quadrant}</span>
          </div>

          {!facts.hasReport ? (
            <p className={styles.noteBox}>本期（{facts.periodLabel}）没有填报记录，收入、成本类指标显示为「—」，情景年影响也估不出来。</p>
          ) : null}

          <ul className={styles.findingList}>
            {selected.findings.length ? selected.findings.map((finding) => (
              <li key={finding.code} className={SEVERITY_CLASS[finding.severity]}>
                <strong>{finding.title}</strong>
                <p title={finding.evidence}>{finding.evidence}</p>
                <small>{finding.suggestion}</small>
              </li>
            )) : <li><strong>本期未触发问题项</strong><p>各项指标处于可接受区间</p></li>}
          </ul>

          <dl className={styles.factList}>
            <div><dt>本期收入</dt><dd>{moneyText(facts.revenue)}</dd></div>
            <div><dt>本期成本</dt><dd>{moneyText(facts.cost)}</dd></div>
            <div><dt>本期结余</dt><dd className={facts.margin !== null && facts.margin < 0 ? styles.marginNegative : undefined}>{moneyText(facts.margin)}</dd></div>
            <div><dt>回收期</dt><dd>{yearsText(facts.paybackYears)}（计划 {facts.planPayback} 年）</dd></div>
            <div><dt>设备原值</dt><dd>{moneyText(facts.investment)}</dd></div>
            <div><dt>统计期间</dt><dd>{facts.periodLabel} · {facts.periodCount} 期</dd></div>
          </dl>

          <button className={`primary-button ${styles.detailAction}`} onClick={() => onSelectDevice(facts.deviceId)}>
            查看单机证据<ArrowRight size={16} />
          </button>

          <div className={styles.scenarioBlock}>
            <h3>处置情景比较</h3>
            <div className={styles.scenarioGrid}>
              {outcomes.map((outcome) => (
                <article key={outcome.mode} className={styles.scenarioCard}>
                  <div className={styles.scenarioHead}>
                    <span>{outcome.mode}</span>
                    <b className={outcome.riskChange <= 0 ? styles.riskDown : styles.riskUp}>
                      风险 {outcome.riskChange > 0 ? "+" : ""}{outcome.riskChange} 分
                    </b>
                  </div>
                  <dl>
                    <div><dt>新增投入</dt><dd>{moneyText(outcome.investment)}</dd></div>
                    <div><dt>年影响</dt><dd>{moneyText(outcome.annualImpact)}</dd></div>
                  </dl>
                  {outcome.annualImpact === null ? (
                    <p className={styles.missingNote}>本期没有填报数据，估不出年影响</p>
                  ) : null}
                  <p className={styles.scenarioNote}>{outcome.note}</p>
                  <small className={styles.caveat}>{outcome.caveat}</small>
                </article>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
