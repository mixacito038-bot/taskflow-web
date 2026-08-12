"use client";

import { useMemo, useState } from "react";
import { Building2, CircleAlert, ClipboardList, Gauge, Search, TriangleAlert } from "lucide-react";

import {
  BenefitQuadrant,
  CapitalBand,
  DEFAULT_DIAGNOSIS_THRESHOLDS,
  DeviceDiagnosis,
  departmentRollup,
  diagnosisSummary,
  Finding,
  FindingCode,
  FindingSeverity,
} from "./benefit-diagnosis";
import styles from "./BenefitAnalysisCenter.module.css";

/* ------------------------------------------------------------------ 常量与格式化 */

// 四象限只画有坐标的四格，「待补数」不是一个位置、是一种缺数状态，它走图右侧的补数清单。
const QUADRANTS: readonly BenefitQuadrant[] = ["明星", "潜力", "低效", "问题"];

// 象限配色全走主题变量：写死色值在 midnight 主题下会变成刺眼的亮点
const QUADRANT_COLORS: Record<BenefitQuadrant, string> = {
  明星: "var(--green)",
  潜力: "var(--primary)",
  低效: "var(--orange)",
  问题: "var(--red)",
  待补数: "var(--muted)",
};

const QUADRANT_HINTS: Record<BenefitQuadrant, string> = {
  明星: "使用率达标且盈利",
  潜力: "盈利但使用率不足",
  低效: "使用率达标仍亏损",
  问题: "使用率不足且亏损",
  待补数: "缺使用率或结余",
};

const FINDING_LABELS: Record<FindingCode, string> = {
  loss: "亏损",
  low_utilization: "使用率不足",
  payback_delay: "回本滞后",
  high_fault: "故障偏高",
  high_maintenance: "维护占比高",
  no_data: "缺填报数据",
};

const FINDING_CODES = Object.keys(FINDING_LABELS) as FindingCode[];

const SEVERITY_LABELS: Record<FindingSeverity, string> = { high: "高危", medium: "中危", low: "低危" };

// 严重度 → 标签配色。写成显式映射而不是 styles[severity]：
// 后者绕过了「用到的类必须在 module.css 里有定义」这条测试，少写一个类页面会静悄悄地裸奔。
const SEVERITY_PILL: Record<FindingSeverity, string> = {
  high: styles.sevHigh,
  medium: styles.sevMedium,
  low: styles.sevLow,
};

// 同一台设备的问题按严重度排，高危标签排在最前：一行里只扫得到前两三个标签
const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };

const SEVERITIES = Object.keys(SEVERITY_LABELS) as FindingSeverity[];

// 按处置去向给按钮：一条问题该谁接手是诊断内核判好的，本页只负责把它送到对应的中心
const ROUTE_LABELS = { improvement: "建改进任务", capital: "送资本论证", data: "去填报" } as const;
const ROUTE_READONLY = { improvement: "待运营改进", capital: "待资本论证", data: "待补填报" } as const;

const BAND_TONES: Record<CapitalBand, string> = {
  必须替换: "danger",
  计划替换: "warning",
  可延寿: "success",
  共享调拨: "info",
  持续观察: "neutral",
};

// 金额口径是元，千分位；缺数一律「—」，绝不补 0（补 0 会让亏损设备看起来像没开机）
const moneyFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
// 坐标轴刻度不留小数：轴上是量级参考，两位小数只会把标签撑到压住图形
const axisMoneyFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function formatMoney(value: number | null): string {
  return value === null ? "—" : moneyFormat.format(value);
}

/** 使用率、完好率、维护收入比在诊断内核里都是百分数（0—100），与阈值同一量纲 */
function formatRate(value: number | null): string {
  return value === null ? "—" : `${decimalFormat.format(value)}%`;
}

function moneyClass(value: number | null): string {
  if (value === null) return "";
  return value < 0 ? styles.netNegative : styles.netPositive;
}

/** globals 的 status-pill 只有 success/warning/danger/neutral，「共享调拨」需要一档中性偏蓝，在模块里补 */
function bandPillClass(band: CapitalBand): string {
  const tone = BAND_TONES[band];
  return tone === "info" ? `status-pill ${styles.pillInfo}` : `status-pill ${tone}`;
}

/* ------------------------------------------------------------------ 四象限散点（手写 SVG，不引图表库） */

const SCATTER_WIDTH = 660;
const SCATTER_HEIGHT = 340;
const SCATTER_PAD_LEFT = 82;
const SCATTER_PAD_RIGHT = 18;
const SCATTER_PAD_TOP = 20;
const SCATTER_PAD_BOTTOM = 34;

type ScatterPoint = { diagnosis: DeviceDiagnosis; utilization: number; margin: number };

function QuadrantScatter({ points, onOpenDevice }: { points: ScatterPoint[]; onOpenDevice: (deviceId: string) => void }) {
  const floor = DEFAULT_DIAGNOSIS_THRESHOLDS.utilizationFloor;
  const plotWidth = SCATTER_WIDTH - SCATTER_PAD_LEFT - SCATTER_PAD_RIGHT;
  const plotHeight = SCATTER_HEIGHT - SCATTER_PAD_TOP - SCATTER_PAD_BOTTOM;

  // 横轴固定从 0 起、至少到 100：使用率是百分数，按数据自适应会让「都在 30% 上下」的一屏看起来很分散
  const utilizations = points.map((point) => point.utilization);
  const xMax = Math.max(100, floor + 10, ...utilizations);
  const xOf = (value: number) => SCATTER_PAD_LEFT + (value / xMax) * plotWidth;

  // 纵轴必须包含 0：盈亏线是这张图的分界，把它挤出画布四象限就不成立了
  const margins = points.map((point) => point.margin);
  const rawTop = Math.max(0, ...margins);
  const rawBottom = Math.min(0, ...margins);
  const rawSpan = rawTop - rawBottom;
  const pad = rawSpan === 0 ? 1 : rawSpan * 0.08;
  const yTop = rawTop + pad;
  const yBottom = rawBottom - pad;
  const ySpan = yTop - yBottom;
  const yOf = (value: number) => SCATTER_PAD_TOP + ((yTop - value) / ySpan) * plotHeight;

  const floorX = xOf(floor);
  const zeroY = yOf(0);
  // 全盈或全亏时零线贴着画布边，象限名要夹回可见范围，否则文字会被裁掉半行
  const clampLabelY = (value: number) =>
    Math.min(SCATTER_PAD_TOP + plotHeight - 8, Math.max(SCATTER_PAD_TOP + 14, value));
  const topLabelY = clampLabelY((SCATTER_PAD_TOP + zeroY) / 2);
  const bottomLabelY = clampLabelY((zeroY + SCATTER_PAD_TOP + plotHeight) / 2);

  const regions: { quadrant: BenefitQuadrant; x: number; y: number; anchor: "start" | "end" }[] = [
    { quadrant: "潜力", x: SCATTER_PAD_LEFT + 8, y: topLabelY, anchor: "start" },
    { quadrant: "明星", x: SCATTER_PAD_LEFT + plotWidth - 8, y: topLabelY, anchor: "end" },
    { quadrant: "问题", x: SCATTER_PAD_LEFT + 8, y: bottomLabelY, anchor: "start" },
    { quadrant: "低效", x: SCATTER_PAD_LEFT + plotWidth - 8, y: bottomLabelY, anchor: "end" },
  ];

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * xMax);
  const yTicks = [yTop, 0, yBottom];
  const aria = `设备效益四象限散点图：横轴使用率百分比，纵轴当期结余（元），使用率管理线 ${floor}%，共 ${points.length} 台设备`;

  return (
    <svg className={styles.chartSvg} viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`} role="img" aria-label={aria}>
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            x1={SCATTER_PAD_LEFT}
            x2={SCATTER_PAD_LEFT + plotWidth}
            y1={yOf(tick)}
            y2={yOf(tick)}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <text x={SCATTER_PAD_LEFT - 8} y={yOf(tick) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
            {axisMoneyFormat.format(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line
            x1={xOf(tick)}
            x2={xOf(tick)}
            y1={SCATTER_PAD_TOP}
            y2={SCATTER_PAD_TOP + plotHeight}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <text x={xOf(tick)} y={SCATTER_HEIGHT - 14} textAnchor="middle" fontSize={12} fill="var(--muted)">
            {decimalFormat.format(tick)}
          </text>
        </g>
      ))}

      {/* 两条参考线是分格依据：竖线取诊断内核的使用率管理线，横线是盈亏线，
          阈值改了图要跟着改，所以这里读常量而不是抄一个数字进来。 */}
      <line
        x1={floorX}
        x2={floorX}
        y1={SCATTER_PAD_TOP}
        y2={SCATTER_PAD_TOP + plotHeight}
        stroke="var(--border-strong)"
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <line
        x1={SCATTER_PAD_LEFT}
        x2={SCATTER_PAD_LEFT + plotWidth}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border-strong)"
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <text x={floorX + 5} y={SCATTER_PAD_TOP + 12} fontSize={12} fill="var(--muted)">
        使用率管理线 {floor}%
      </text>

      {regions.map((region) => (
        <text
          key={region.quadrant}
          x={region.x}
          y={region.y}
          textAnchor={region.anchor}
          fontSize={12}
          fontWeight={650}
          fill={QUADRANT_COLORS[region.quadrant]}
        >
          {region.quadrant}
        </text>
      ))}

      {points.map((point) => (
        <circle
          key={point.diagnosis.facts.deviceId}
          className={styles.dot}
          cx={xOf(point.utilization)}
          cy={yOf(point.margin)}
          r={5.5}
          fill={QUADRANT_COLORS[point.diagnosis.quadrant]}
          stroke="var(--surface)"
          strokeWidth={1.5}
          tabIndex={0}
          role="button"
          aria-label={`${point.diagnosis.facts.name}：使用率 ${formatRate(point.utilization)}，结余 ${formatMoney(point.margin)} 元`}
          onClick={() => onOpenDevice(point.diagnosis.facts.deviceId)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onOpenDevice(point.diagnosis.facts.deviceId);
          }}
        >
          <title>
            {`${point.diagnosis.facts.name}｜使用率 ${formatRate(point.utilization)}｜结余 ${formatMoney(point.margin)} 元`}
          </title>
        </circle>
      ))}

      <text x={6} y={12} fontSize={12} fill="var(--muted)">
        结余(元)
      </text>
      <text x={SCATTER_WIDTH - 6} y={SCATTER_HEIGHT - 2} textAnchor="end" fontSize={12} fill="var(--muted)">
        使用率(%)
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 科室结余条形图（手写 SVG） */

type DeptBar = { department: string; margin: number | null };

const DEPT_WIDTH = 660;
const DEPT_LABEL_WIDTH = 104;
const DEPT_VALUE_WIDTH = 92;
const DEPT_ROW_HEIGHT = 26;

function DepartmentMarginChart({ rows }: { rows: DeptBar[] }) {
  const plotWidth = DEPT_WIDTH - DEPT_LABEL_WIDTH - DEPT_VALUE_WIDTH;
  // 零轴居中：正负两侧等宽，才能一眼比出「亏得比赚得多」而不用读数字
  const zeroX = DEPT_LABEL_WIDTH + plotWidth / 2;
  const half = plotWidth / 2;
  const amplitudes = rows.map((row) => (row.margin === null ? 0 : Math.abs(row.margin)));
  const maxAbs = Math.max(...amplitudes, 0);
  const scale = maxAbs === 0 ? 1 : maxAbs;
  const height = rows.length * DEPT_ROW_HEIGHT + 8;
  const aria = `科室结余对比条形图：共 ${rows.length} 个科室，零轴居中，结余为正向右、为负向左，单位元`;

  return (
    <svg className={styles.chartSvg} viewBox={`0 0 ${DEPT_WIDTH} ${height}`} role="img" aria-label={aria}>
      <line x1={zeroX} x2={zeroX} y1={2} y2={height - 2} stroke="var(--border-strong)" strokeWidth={1} />
      {rows.map((row, index) => {
        const y = index * DEPT_ROW_HEIGHT + 5;
        const barHeight = DEPT_ROW_HEIGHT - 12;
        const margin = row.margin;
        const barWidth = margin === null ? 0 : (Math.abs(margin) / scale) * half;
        const positive = margin !== null && margin >= 0;
        return (
          <g key={row.department}>
            <title>{`${row.department}：结余 ${formatMoney(margin)} 元`}</title>
            <text x={DEPT_LABEL_WIDTH - 8} y={y + barHeight / 2 + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
              {row.department.length > 6 ? `${row.department.slice(0, 6)}…` : row.department}
            </text>
            {margin === null ? null : (
              <rect
                x={positive ? zeroX : zeroX - barWidth}
                y={y}
                width={Math.max(barWidth, 1)}
                height={barHeight}
                rx={3}
                fill={positive ? "var(--green)" : "var(--red)"}
              />
            )}
            <text
              x={margin === null ? zeroX + 6 : positive ? zeroX + barWidth + 6 : zeroX - barWidth - 6}
              y={y + barHeight / 2 + 4}
              textAnchor={margin !== null && !positive ? "end" : "start"}
              fontSize={12}
              fill={margin === null ? "var(--muted)" : positive ? "var(--green)" : "var(--red)"}
            >
              {formatMoney(margin)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ 页面 */

export default function BenefitAnalysisCenter({
  diagnoses,
  periodLabel,
  onlyConfirmed,
  onOnlyConfirmedChange,
  onOpenDevice,
  onCreateAction,
  onSendToCapital,
  onOpenReporting,
  canManage,
  notify,
}: {
  diagnoses: DeviceDiagnosis[];
  /** 当前统计口径的人话，例如「2026年1—8月（8 期）」 */
  periodLabel: string;
  onlyConfirmed: boolean;
  onOnlyConfirmedChange: (next: boolean) => void;
  /** 点设备名进单机分析 */
  onOpenDevice: (deviceId: string) => void;
  /** 把一条问题送去运营改进中心建任务 */
  onCreateAction: (deviceId: string, finding: Finding) => void;
  /** 把一台设备送去资本计划论证 */
  onSendToCapital: (deviceId: string) => void;
  /** 去设备数据填报补数 */
  onOpenReporting: (deviceId: string) => void;
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
}) {
  const summary = useMemo(() => diagnosisSummary(diagnoses), [diagnoses]);
  // 直接用诊断内核排好的顺序（按结余升序、缺数垫底）：表和图共用它，
  // 页面再排一遍只会和内核的口径打架，还得复制一份「缺数排最后」的规则。
  const rollups = useMemo(() => departmentRollup(diagnoses), [diagnoses]);

  /* -------------------------------------------------- 散点与补数清单 */
  const scatterPoints = useMemo<ScatterPoint[]>(() => {
    const points: ScatterPoint[] = [];
    for (const item of diagnoses) {
      // 待补数没有坐标，硬画进散点就等于替它编一个位置；这些设备改走右侧补数清单。
      if (item.quadrant === "待补数") continue;
      const { utilization, margin } = item.facts;
      if (utilization === null || margin === null) continue;
      points.push({ diagnosis: item, utilization, margin });
    }
    return points;
  }, [diagnoses]);

  const pendingDevices = useMemo(() => diagnoses.filter((item) => item.quadrant === "待补数"), [diagnoses]);

  /* -------------------------------------------------- 问题清单筛选 */
  const [keyword, setKeyword] = useState("");
  const [quadrantFilter, setQuadrantFilter] = useState<"all" | BenefitQuadrant>("all");
  const [codeFilter, setCodeFilter] = useState<"all" | FindingCode>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | FindingSeverity>("all");

  const problems = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    const matched = diagnoses.filter((item) => {
      // 清单只放触发了阈值的设备：全院台账在别的页面看，这里要的是「该管哪几台」
      if (item.findings.length === 0) return false;
      if (quadrantFilter !== "all" && item.quadrant !== quadrantFilter) return false;
      if (codeFilter !== "all" && !item.findings.some((finding) => finding.code === codeFilter)) return false;
      if (severityFilter !== "all" && !item.findings.some((finding) => finding.severity === severityFilter)) return false;
      if (!text) return true;
      return [item.facts.name, item.facts.assetCode, item.facts.department].some((part) =>
        part.toLowerCase().includes(text),
      );
    });
    // 风险分从高到低：清单第一屏就该是最该处理的那几台
    return matched.sort((a, b) => b.riskScore - a.riskScore);
  }, [diagnoses, keyword, quadrantFilter, codeFilter, severityFilter]);

  function toggleScope() {
    const next = !onlyConfirmed;
    onOnlyConfirmedChange(next);
    notify(next ? "已切到正式口径：只统计已确认的填报数据" : "已切到预览口径：填报中、已提交的数据一并计入");
  }

  /** 一条问题该谁接手是诊断内核判好的，这里只按 route 把它送到对应的中心 */
  function dispatchFinding(deviceId: string, finding: Finding) {
    switch (finding.route) {
      case "improvement":
        onCreateAction(deviceId, finding);
        break;
      case "capital":
        onSendToCapital(deviceId);
        break;
      case "data":
        onOpenReporting(deviceId);
        break;
    }
  }

  function sortedFindings(list: readonly Finding[]): Finding[] {
    return [...list].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }

  const hasDevices = diagnoses.length > 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><Gauge size={15} />全院设备效益</div>
          <h1>效益分析</h1>
        </div>
        <div className="heading-actions">
          <div className={styles.scopeSwitch}>
            <button
              type="button"
              role="switch"
              aria-checked={onlyConfirmed}
              className={onlyConfirmed ? `${styles.scopeToggle} ${styles.scopeToggleOn}` : styles.scopeToggle}
              onClick={toggleScope}
            >
              <i aria-hidden />
            </button>
            <span className={styles.scopeText}>
              <strong>正式口径</strong>
              <small>开：只算已确认的填报数据；关：填报中、已提交的一并计入。</small>
            </span>
          </div>
        </div>
      </div>

      <div className={`admin-stats ${styles.statsRow}`}>
        <div>
          <span>总收入(元)</span>
          <strong>{formatMoney(summary.revenue)}</strong>
        </div>
        <div>
          <span>总成本(元)</span>
          <strong>{formatMoney(summary.cost)}</strong>
        </div>
        <div>
          <span>总结余(元)</span>
          <strong className={moneyClass(summary.margin)}>{formatMoney(summary.margin)}</strong>
        </div>
        <div>
          <span>整体使用率</span>
          <strong>{formatRate(summary.utilization)}</strong>
        </div>
        <div>
          <span>待处置问题</span>
          <strong className={summary.highFindings > 0 ? styles.netNegative : ""}>{summary.highFindings}</strong>
          <small>高危 · 中危 {summary.mediumFindings}</small>
        </div>
      </div>

      <p className={styles.summaryLine}>
        <ClipboardList size={14} />
        已填报 {summary.reported} / 共 {summary.total} 台 · 统计口径：{periodLabel} · {onlyConfirmed ? "仅已确认" : "含未确认"}
      </p>

      {!hasDevices ? (
        <section className="panel">
          <div className="ledger-empty">
            <ClipboardList size={26} />
            <strong>还没有可分析的设备</strong>
            <p>效益分析按台账逐台诊断。请先在「设备台账」建档，并在「设备数据填报」录入本期成本与业务量。</p>
          </div>
        </section>
      ) : (
        <>
          <section className={`panel ${styles.panelGap}`}>
            <div className="panel-heading">
              <div>
                <h3>效益四象限</h3>
                <p>横轴使用率、纵轴当期结余；竖虚线是使用率管理线，横虚线是盈亏线。点一台设备进单机分析。</p>
              </div>
            </div>

            <div className={styles.scatterLayout}>
              <div className={styles.chartScroll}>
                {scatterPoints.length > 0 ? (
                  <QuadrantScatter points={scatterPoints} onOpenDevice={onOpenDevice} />
                ) : (
                  <p className={styles.chartEmpty}>本期没有同时具备使用率和结余的设备，散点无法定位，请先补齐填报。</p>
                )}
              </div>

              <aside className={styles.pendingBox}>
                <h4 className={styles.pendingTitle}>
                  <CircleAlert size={14} />待补数 {pendingDevices.length} 台
                </h4>
                {pendingDevices.length > 0 ? (
                  <ul className={styles.pendingList}>
                    {pendingDevices.map((item) => (
                      <li key={item.facts.deviceId} className={styles.pendingItem}>
                        <span title={`${item.facts.name}｜${item.facts.department}`}>{item.facts.name}</span>
                        {/* 补数是所有人都该做的事，不按 cost.manage 收权限：拦住只会让缺口一直挂着 */}
                        <button className="text-button" type="button" onClick={() => onOpenReporting(item.facts.deviceId)}>
                          去填报
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.pendingEmpty}>本期设备都有坐标，无需补数。</p>
                )}
              </aside>
            </div>

            <div className={styles.quadRow}>
              {QUADRANTS.map((quadrant) => (
                <button
                  key={quadrant}
                  type="button"
                  className={`${styles.quadCard} ${quadrantFilter === quadrant ? styles.quadCardActive : ""}`}
                  aria-pressed={quadrantFilter === quadrant}
                  onClick={() => setQuadrantFilter(quadrantFilter === quadrant ? "all" : quadrant)}
                >
                  <i className={styles.quadDot} style={{ background: QUADRANT_COLORS[quadrant] }} aria-hidden />
                  <span>{quadrant}</span>
                  <strong>{summary.quadrantCounts[quadrant]}</strong>
                  <small>{QUADRANT_HINTS[quadrant]}</small>
                </button>
              ))}
            </div>
          </section>

          <section className={`panel ${styles.panelGap}`}>
            <div className="panel-heading">
              <div>
                <h3>科室对比</h3>
                <p>按当期结余从低到高排，最该管的科室在最前；条形零轴居中，向左为亏损。</p>
              </div>
              <span className={`status-pill neutral ${styles.countPill}`}><Building2 size={13} />{rollups.length} 个科室</span>
            </div>

            {rollups.length > 0 ? (
              <>
                <div className={styles.chartScroll}>
                  <DepartmentMarginChart rows={rollups.map((row) => ({ department: row.department, margin: row.margin }))} />
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>科室</th>
                        <th className="num">设备数</th>
                        <th className="num">已填报</th>
                        <th className="num">收入(元)</th>
                        <th className="num">成本(元)</th>
                        <th className="num">结余(元)</th>
                        <th className="num">使用率</th>
                        <th className="num">高危问题</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollups.map((row) => (
                        <tr key={row.department}>
                          <td>{row.department}</td>
                          <td className="num">{row.deviceCount}</td>
                          <td className="num">{row.reported}</td>
                          <td className="num">{formatMoney(row.revenue)}</td>
                          <td className="num">{formatMoney(row.cost)}</td>
                          <td className={`num ${moneyClass(row.margin)}`}>{formatMoney(row.margin)}</td>
                          <td className="num">{formatRate(row.utilization)}</td>
                          <td className={`num ${row.highFindings > 0 ? styles.netNegative : ""}`}>{row.highFindings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="ledger-empty">
                <Building2 size={24} />
                <strong>没有可对比的科室</strong>
                <p>台账里的设备还没有归属科室，先在「设备台账」补齐使用科室。</p>
              </div>
            )}
          </section>

          <section className={`panel ${styles.panelGap}`}>
            <div className="panel-heading">
              <div>
                <h3>问题设备清单</h3>
                <p>按风险分从高到低排；每条问题按处置去向直接派单。</p>
              </div>
              <span className="status-pill neutral">{problems.length} 台</span>
            </div>

            <div className={`filter-bar ${styles.filterRow}`}>
              <label className={`search-field ${styles.searchBox}`}>
                <Search size={15} />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索设备名称 / 资产编号 / 科室"
                  aria-label="搜索问题设备"
                />
              </label>
              <label>
                <span>象限</span>
                <select
                  value={quadrantFilter}
                  onChange={(event) => setQuadrantFilter(event.target.value as "all" | BenefitQuadrant)}
                >
                  <option value="all">全部象限</option>
                  {QUADRANTS.map((quadrant) => <option key={quadrant} value={quadrant}>{quadrant}</option>)}
                  <option value="待补数">待补数</option>
                </select>
              </label>
              <label>
                <span>问题类型</span>
                <select value={codeFilter} onChange={(event) => setCodeFilter(event.target.value as "all" | FindingCode)}>
                  <option value="all">全部类型</option>
                  {FINDING_CODES.map((code) => <option key={code} value={code}>{FINDING_LABELS[code]}</option>)}
                </select>
              </label>
              <label>
                <span>严重度</span>
                <select
                  value={severityFilter}
                  onChange={(event) => setSeverityFilter(event.target.value as "all" | FindingSeverity)}
                >
                  <option value="all">全部严重度</option>
                  {SEVERITIES.map((severity) => <option key={severity} value={severity}>{SEVERITY_LABELS[severity]}</option>)}
                </select>
              </label>
            </div>

            {problems.length === 0 ? (
              <div className="ledger-empty">
                <TriangleAlert size={24} />
                <strong>本期没有触发阈值的设备</strong>
                <p>换个筛选条件，或到「效益四象限」按象限查看全部设备。</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className={`data-table ${styles.problemTable}`}>
                  <thead>
                    <tr>
                      <th>设备</th>
                      <th>科室 / 资产编号</th>
                      <th className="num">结余(元)</th>
                      <th className="num">使用率</th>
                      <th className="num">完好率</th>
                      <th className="num">维护收入比</th>
                      <th>风险分</th>
                      <th>处置分档</th>
                      <th>问题</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.map((item) => {
                      const facts = item.facts;
                      const findings = sortedFindings(item.findings);
                      // riskScore 是诊断内核封顶到 100 的分数，进度条按绝对量纲画；
                      // 60 分是内核里「计划替换」的分档线，颜色跟着同一条线走，两处才对得上。
                      const riskPercent = Math.min(100, Math.max(0, item.riskScore));
                      const riskTone = item.riskScore >= 60 ? "var(--red)" : item.riskScore >= 40 ? "var(--orange)" : "var(--primary)";
                      return (
                        <tr key={facts.deviceId}>
                          <td>
                            <div className={styles.deviceCell}>
                              <button className={styles.deviceButton} type="button" onClick={() => onOpenDevice(facts.deviceId)}>
                                {facts.name}
                              </button>
                              <small>{facts.model || "—"}</small>
                            </div>
                          </td>
                          <td>
                            <div className={styles.deviceCell}>
                              <strong>{facts.department}</strong>
                              <small>{facts.assetCode || "—"}</small>
                            </div>
                          </td>
                          <td className={`num ${moneyClass(facts.margin)}`}>{formatMoney(facts.margin)}</td>
                          <td className="num">{formatRate(facts.utilization)}</td>
                          <td className="num">{formatRate(facts.integrity)}</td>
                          <td className="num">{formatRate(facts.maintenanceRatio)}</td>
                          <td>
                            <div className={styles.riskCell}>
                              <b>{decimalFormat.format(item.riskScore)}</b>
                              <span className={styles.riskTrack}>
                                <i style={{ width: `${riskPercent}%`, background: riskTone }} />
                              </span>
                            </div>
                          </td>
                          <td><span className={bandPillClass(item.band)}>{item.band}</span></td>
                          <td>
                            <div className={styles.findingCell}>
                              {findings.map((finding, index) => (
                                <span
                                  key={`${finding.code}-${index}`}
                                  className={`${styles.findingPill} ${SEVERITY_PILL[finding.severity]}`}
                                  title={`${finding.title}｜依据：${finding.evidence}｜建议：${finding.suggestion}`}
                                >
                                  {FINDING_LABELS[finding.code]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="action-col">
                            <div className={styles.actionStack}>
                              {findings.map((finding, index) => (canManage ? (
                                <button
                                  key={`${finding.code}-${index}`}
                                  type="button"
                                  className={styles.actionButton}
                                  title={`${finding.title}：${finding.suggestion}`}
                                  onClick={() => dispatchFinding(facts.deviceId, finding)}
                                >
                                  {ROUTE_LABELS[finding.route]}
                                  <em>{FINDING_LABELS[finding.code]}</em>
                                </button>
                              ) : (
                                <span
                                  key={`${finding.code}-${index}`}
                                  className={styles.readonlyAction}
                                  title={`${finding.title}：${finding.suggestion}`}
                                >
                                  {ROUTE_READONLY[finding.route]}
                                  <em>{FINDING_LABELS[finding.code]}</em>
                                </span>
                              )))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
