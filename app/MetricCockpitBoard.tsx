"use client";

import { CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GripVertical, Pencil, X } from "lucide-react";

import styles from "./MetricCockpitBoard.module.css";
import {
  MetricCategory,
  MetricCategoryTone,
  MetricDictionaryEntry,
  metricCategory,
} from "./metric-dictionary";
import {
  CHART_KIND_LABELS,
  ChartComputeContext,
  ChartKind,
  ChartSeries,
  ChartTemplate,
  CockpitScope,
  computeChartSeries,
  METRIC_VALUE_BINDINGS,
  MetricCockpitConfigState,
  MetricCockpitItem,
} from "./chart-template-catalog";

const CHART_KINDS = Object.keys(CHART_KIND_LABELS) as ChartKind[];

const SIZE_LABELS: Record<MetricCockpitItem["size"], string> = {
  small: "小",
  medium: "中",
  wide: "通栏",
};

/** 分组维度的中文名：表格图的表头和配置页的模板表单都读它，只留这一份免得两处叫法不一样。 */
export const GROUP_BY_LABELS: Record<ChartTemplate["groupBy"], string> = {
  department: "科室",
  device: "设备",
  costField: "成本构成",
  period: "期间",
};

// 色标沿用指标字典配置页的思路：一律落在主题变量上，深浅主题各自取各自的色值。
const TONE_CLASS: Record<MetricCategoryTone, string> = {
  blue: styles.toneBlue,
  green: styles.toneGreen,
  orange: styles.toneOrange,
  purple: styles.tonePurple,
  red: styles.toneRed,
  slate: styles.toneSlate,
};

/**
 * 环形图扇区的取色顺序。
 * 不是变量声明顺序：深色主题里 --primary 和 --cyan、--green 三个都是冷色，挨在一起分不开。
 * 这个顺序是拿 CVD 模拟逐对算过的（亮/暗两套色值一起算），相邻扇区的区分度最差的一对
 * 也能过正常视觉下限；再配合图例数值和 2px 底色缝，色弱读者也能对上号。
 */
const PIE_SLOT_COLORS = [
  "var(--primary)",
  "var(--rose)",
  "var(--orange)",
  "var(--green)",
  "var(--violet)",
  "var(--cyan)",
];

/** 扇区超过 6 个不再生成新颜色：第 7 个起并入「其他」，否则循环取色会让两个扇区同色。 */
const PIE_MAX_SLICES = PIE_SLOT_COLORS.length;

/** 大数字滚动时长；再长就从「有反馈」变成「等它滚完」。 */
const COUNT_UP_MS = 700;

/**
 * 入场错峰的序号上限。
 * 每张卡 28ms，封顶第 16 张 = 448ms 全部到位；不封顶的话十七张之后的卡片要等半秒多，
 * 看着不像错峰，像页面卡住了。
 */
const STAGGER_MAX_INDEX = 16;

/* ------------------------------------------------------------------ 动效开关 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * 系统的「减少动效」开关。
 * 用 useSyncExternalStore 而不是 useState + effect：服务端渲染读不到 matchMedia，
 * 拿 state 兜底会在水合时和客户端真实值对不上，整页报水合失败；
 * 而 effect 里同步 setState 又是本仓库 eslint 明令禁止的写法。
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/* ------------------------------------------------------------------ 纯函数 */

/**
 * 千分位手写而不用 toLocaleString：服务端和浏览器的 ICU 数据可能不一致，
 * 金额格式在水合时对不上会整页告警。
 */
function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  const [int, frac] = String(Math.abs(rounded)).split(".");
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

/** null 一律显示「—」：没数就是没数，显示 0 会被当成真实结果拿去汇报。 */
function formatValue(value: number | null): string {
  return value === null ? "—" : formatNumber(value);
}

function scopeOf(config: MetricCockpitConfigState): CockpitScope {
  return config.dimension === "department" && config.department
    ? { level: "department", department: config.department }
    : { level: "hospital" };
}

/**
 * 数据指纹。
 * CSS 动画只在元素重新挂载时重播，所以把指纹当 key：数真的变了才换 key、才重画；
 * 父组件因为别的状态重渲染时指纹不变，图表不会莫名其妙抖一下。
 */
function seriesSignature(series: ChartSeries | null, suffix: string): string {
  if (!series) return `none|${suffix}`;
  return `${series.total}|${series.points.map((point) => `${point.label}=${point.value}`).join(",")}|${suffix}`;
}

/**
 * 大数字从当前值滚到目标值。
 * 返回值只用于显示；null 不参与滚动，由调用方直接落到「—」。
 */
function useCountUp(target: number | null): number {
  const reduceMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(0);
  // 记住上一帧滚到哪：数值二次变化时从当前显示值接着滚，而不是每次都退回 0 重来。
  const fromRef = useRef(0);
  useEffect(() => {
    if (target === null || reduceMotion) return;
    const from = fromRef.current;
    if (from === target) return;
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const progress = Math.min(1, (now - startedAt) / COUNT_UP_MS);
      // ease-out：起手快、收尾慢，最后一帧 progress = 1 时刚好等于目标值，不会差一点点。
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = from + (target - from) * eased;
      fromRef.current = value;
      setDisplay(value);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    // 卸载/换数时必须取消：回调里握着 setDisplay，卡片没了还在跑就是泄漏加控制台报错。
    return () => cancelAnimationFrame(frame);
  }, [target, reduceMotion]);
  if (target === null) return 0;
  if (reduceMotion) return target;
  // 目标是整数时中间帧也取整：一笔整数金额滚到一半冒出小数点，看着像脏数据。
  return Number.isInteger(target) ? Math.round(display) : display;
}

/* ------------------------------------------------------------------ 图表渲染（手写 SVG，不引库） */

function StatChart({ series, unit, compact }: { series: ChartSeries; unit: string; compact?: boolean }) {
  const rolled = useCountUp(series.total);
  return (
    <div className={styles.statBox}>
      <span className={compact ? `${styles.statValue} ${styles.statValueCompact}` : styles.statValue}>
        {/* 缺数直接「—」：滚动动画绝不能在没有数的卡片上滚出一串看着像真数的中间值。 */}
        {series.total === null ? "—" : formatValue(rolled)}
        {series.total !== null && unit ? <small className={styles.statUnit}>{unit}</small> : null}
      </span>
      {series.total === null ? <span className={styles.noDataHint}>本期暂无可统计数据</span> : null}
    </div>
  );
}

function BarChart({ series, unit, label, compact }: { series: ChartSeries; unit: string; label: string; compact?: boolean }) {
  const points = series.points;
  const hasData = points.some((point) => point.value !== null);
  if (!hasData) return <div className={styles.noData}>本期各分组均无数据</div>;
  const values = points.map((point) => point.value ?? 0);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const aria = `${label}：${CHART_KIND_LABELS.bar}，${points.length} 个分组，单位${unit || "无"}`;
  const drawKey = seriesSignature(series, "bar");
  // 分组不多时用横向条形：中文科室名横排最省地方，值直接标在条尾。
  if (points.length <= 8) {
    const rowHeight = compact ? 24 : 28;
    const labelWidth = 96;
    const valueWidth = 64;
    const chartWidth = 340;
    const height = points.length * rowHeight + 6;
    const plotWidth = chartWidth - labelWidth - valueWidth;
    const zeroX = labelWidth + ((0 - min) / span) * plotWidth;
    return (
      <svg className={styles.chartSvg} viewBox={`0 0 ${chartWidth} ${height}`} role="img" aria-label={aria}>
        {[0.25, 0.5, 0.75, 1].map((step) => (
          <line
            key={step}
            x1={labelWidth + step * plotWidth}
            x2={labelWidth + step * plotWidth}
            y1={2}
            y2={height - 2}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        ))}
        <g key={drawKey}>
          {points.map((point, index) => {
            const y = index * rowHeight + 4;
            const barHeight = rowHeight - 10;
            const value = point.value;
            const barX = value === null ? zeroX : Math.min(zeroX, labelWidth + ((value - min) / span) * plotWidth);
            const barWidth = value === null ? 0 : Math.abs(((value - 0) / span) * plotWidth);
            return (
              <g key={`${point.label}-${index}`}>
                <title>{`${point.label}：${formatValue(value)}${value === null ? "" : unit}`}</title>
                <text x={labelWidth - 8} y={y + barHeight / 2 + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
                  {point.label.length > 6 ? `${point.label.slice(0, 6)}…` : point.label}
                </text>
                {value !== null ? (
                  <rect
                    className={value < 0 ? `${styles.barGrow} ${styles.barGrowNegative}` : styles.barGrow}
                    style={{ "--b": index } as CSSProperties}
                    x={barX}
                    y={y}
                    width={Math.max(barWidth, 1)}
                    height={barHeight}
                    rx={3}
                    fill="var(--primary)"
                  />
                ) : null}
                <text
                  x={value === null ? zeroX + 6 : barX + (value >= 0 ? barWidth : 0) + 6}
                  y={y + barHeight / 2 + 4}
                  fontSize={12}
                  fill="var(--text)"
                >
                  {formatValue(value)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    );
  }
  // 分组一多标签放不下，改纵向柱状，横轴只标首尾和中间的刻度，明细靠悬浮提示和表格图型。
  const chartWidth = 340;
  const chartHeight = compact ? 130 : 150;
  const padLeft = 8;
  const padBottom = 22;
  const plotHeight = chartHeight - padBottom - 16;
  const slot = (chartWidth - padLeft * 2) / points.length;
  const barWidth = Math.min(18, slot - 2);
  const zeroY = 14 + (max / span) * plotHeight;
  const labelEvery = Math.ceil(points.length / 6);
  return (
    <svg className={styles.chartSvg} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={aria}>
      {[0, 0.5, 1].map((step) => (
        <line
          key={step}
          x1={padLeft}
          x2={chartWidth - padLeft}
          y1={14 + step * plotHeight}
          y2={14 + step * plotHeight}
          stroke="var(--chart-grid)"
          strokeWidth={1}
        />
      ))}
      <g key={drawKey}>
        {points.map((point, index) => {
          const value = point.value;
          const x = padLeft + index * slot + (slot - barWidth) / 2;
          const barHeight = value === null ? 0 : (Math.abs(value) / span) * plotHeight;
          const y = value !== null && value >= 0 ? zeroY - barHeight : zeroY;
          return (
            <g key={`${point.label}-${index}`}>
              <title>{`${point.label}：${formatValue(value)}${value === null ? "" : unit}`}</title>
              {value !== null ? (
                <rect
                  className={value < 0 ? `${styles.barRise} ${styles.barRiseNegative}` : styles.barRise}
                  style={{ "--b": index } as CSSProperties}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 1)}
                  rx={3}
                  fill="var(--primary)"
                />
              ) : null}
              {index % labelEvery === 0 ? (
                <text x={x + barWidth / 2} y={chartHeight - 6} textAnchor="middle" fontSize={12} fill="var(--muted)">
                  {point.label.length > 4 ? `${point.label.slice(0, 4)}…` : point.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function LineChart({ series, unit, label, compact }: { series: ChartSeries; unit: string; label: string; compact?: boolean }) {
  const points = series.points;
  const hasData = points.some((point) => point.value !== null);
  if (!hasData) return <div className={styles.noData}>本期各分组均无数据</div>;
  const chartWidth = 340;
  const chartHeight = compact ? 130 : 150;
  const padLeft = 12;
  const padRight = 46;
  const padTop = 14;
  const padBottom = 22;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;
  const values = points.filter((point) => point.value !== null).map((point) => point.value as number);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const xOf = (index: number) => padLeft + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yOf = (value: number) => padTop + ((max - value) / span) * plotHeight;
  // 点值为 null 就断线：分成多段 path，各段独立画线和淡填充，缺数的地方留白而不是连成假趋势。
  const segments: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, value: point.value });
  });
  if (current.length) segments.push(current);
  const lastPoint = [...segments].reverse().flatMap((segment) => [...segment].reverse())[0];
  const labelEvery = Math.ceil(points.length / 6);
  const aria = `${label}：${CHART_KIND_LABELS.line}，${points.length} 个期间，单位${unit || "无"}`;
  const drawKey = seriesSignature(series, "line");
  return (
    <svg className={styles.chartSvg} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={aria}>
      {[0, 0.5, 1].map((step) => (
        <line
          key={step}
          x1={padLeft}
          x2={chartWidth - padRight}
          y1={padTop + step * plotHeight}
          y2={padTop + step * plotHeight}
          stroke="var(--chart-grid)"
          strokeWidth={1}
        />
      ))}
      <g key={drawKey}>
        {segments.map((segment, segmentIndex) => {
          const linePath = segment.map((point, index) => `${index === 0 ? "M" : "L"}${xOf(point.index)},${yOf(point.value)}`).join(" ");
          const baseline = yOf(Math.max(min, 0));
          const areaPath = `${linePath} L${xOf(segment[segment.length - 1].index)},${baseline} L${xOf(segment[0].index)},${baseline} Z`;
          return (
            <g key={segmentIndex}>
              {segment.length > 1 ? <path className={styles.lineArea} d={areaPath} fill="var(--primary)" fillOpacity={0.08} stroke="none" /> : null}
              {/* pathLength=1 把折线长度归一化，dasharray/dashoffset 就能用纯 CSS 画出来，
                  不必先渲染再用 getTotalLength 量一遍（量的那一帧线是断的，会闪）。 */}
              <path
                className={styles.lineDraw}
                d={linePath}
                pathLength={1}
                strokeDasharray={1}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {segment.map((point) => (
                <circle
                  key={point.index}
                  className={styles.lineDot}
                  style={{ "--p": point.index } as CSSProperties}
                  cx={xOf(point.index)}
                  cy={yOf(point.value)}
                  r={point === lastPoint ? 5 : 3.5}
                  fill="var(--primary)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                >
                  <title>{`${points[point.index].label}：${formatNumber(point.value)}${unit}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {lastPoint ? (
          <text className={styles.lineDot} x={xOf(lastPoint.index) + 8} y={yOf(lastPoint.value) + 4} fontSize={12} fontWeight={600} fill="var(--text)">
            {formatNumber(lastPoint.value)}
          </text>
        ) : null}
      </g>
      {points.map((point, index) =>
        index % labelEvery === 0 ? (
          <text key={index} x={xOf(index)} y={chartHeight - 6} textAnchor="middle" fontSize={12} fill="var(--muted)">
            {point.label.length > 5 ? `${point.label.slice(0, 5)}…` : point.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function polarPoint(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle - Math.PI / 2), cy + radius * Math.sin(angle - Math.PI / 2)];
}

function donutSlicePath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  // 单扇区占满 360° 时首尾点重合画不出弧，按 359.9° 处理。
  const angle = Math.min(end - start, Math.PI * 2 - 0.002);
  const [x1, y1] = polarPoint(cx, cy, outer, start);
  const [x2, y2] = polarPoint(cx, cy, outer, start + angle);
  const [x3, y3] = polarPoint(cx, cy, inner, start + angle);
  const [x4, y4] = polarPoint(cx, cy, inner, start);
  const large = angle > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
}

function PieChart({ series, unit, label, compact }: { series: ChartSeries; unit: string; label: string; compact?: boolean }) {
  // 0 和 null 扇区不画：画出来是一条看不见的缝，图例里也没意义。
  const positive = series.points.filter((point) => point.value !== null && point.value > 0) as { label: string; value: number }[];
  if (!positive.length) return <div className={styles.noData}>本期各分组均无数据</div>;
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  // 超过 6 个扇区把尾部并成「其他」：颜色只有 6 个正规槽位，循环复用会出现两个同色扇区。
  const folded = sorted.length > PIE_MAX_SLICES
    ? [...sorted.slice(0, PIE_MAX_SLICES - 1), { label: "其他", value: sorted.slice(PIE_MAX_SLICES - 1).reduce((sum, point) => sum + point.value, 0) }]
    : sorted;
  const total = folded.reduce((sum, point) => sum + point.value, 0);
  const size = compact ? 104 : 124;
  const cx = size / 2;
  const outer = size / 2 - 2;
  const inner = outer * 0.62;
  // 起止角先算好再渲染：在 map 回调里累加一个渲染期变量，React 严格模式下重跑一次
  // 就会把角度累加两遍，扇区错位。
  const slices: { point: { label: string; value: number }; from: number; to: number }[] = [];
  let cursor = 0;
  for (const point of folded) {
    const sweep = (point.value / total) * Math.PI * 2;
    slices.push({ point, from: cursor, to: cursor + sweep });
    cursor += sweep;
  }
  const colorOf = (index: number, name: string) => (name === "其他" ? "var(--slate)" : PIE_SLOT_COLORS[index]);
  const aria = `${label}：${CHART_KIND_LABELS.pie}，共 ${folded.length} 个分组，合计 ${formatNumber(series.total ?? total)}${unit}`;
  const drawKey = seriesSignature(series, "pie");
  return (
    <div className={styles.pieBox}>
      <svg className={styles.pieSvg} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={aria} style={{ width: size }}>
        {/* 扇区按顺序转进来：逐段延迟淡入 + 一点点回正的旋转，比逐帧扫角度简单，
            也不会因为每帧重算弧线路径而闪。 */}
        <g key={drawKey}>
          {slices.map(({ point, from, to }, index) => (
            <path
              key={point.label}
              className={styles.pieSweep}
              style={{ "--s": index } as CSSProperties}
              d={donutSlicePath(cx, cx, outer, inner, from, to)}
              fill={colorOf(index, point.label)}
              stroke="var(--surface)"
              strokeWidth={2}
            >
              <title>{`${point.label}：${formatNumber(point.value)}${unit}`}</title>
            </path>
          ))}
        </g>
        <text x={cx} y={cx - 2} textAnchor="middle" fontSize={compact ? 14 : 16} fontWeight={650} fill="var(--text)">
          {formatValue(series.total ?? total)}
        </text>
        <text x={cx} y={cx + 14} textAnchor="middle" fontSize={12} fill="var(--muted)">
          合计{unit ? `（${unit}）` : ""}
        </text>
      </svg>
      <ul className={styles.legend}>
        {folded.map((point, index) => (
          <li key={point.label} className={styles.legendRow}>
            <i className={styles.legendDot} style={{ background: colorOf(index, point.label) }} aria-hidden />
            <span className={styles.legendLabel}>{point.label}</span>
            <span className={styles.legendValue}>{formatNumber(point.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableChart({ series, unit, groupBy }: { series: ChartSeries; unit: string; groupBy: ChartTemplate["groupBy"] }) {
  return (
    <div className={styles.tableWrap}>
      <table className="data-table">
        <thead>
          <tr>
            <th>{GROUP_BY_LABELS[groupBy]}</th>
            <th className="num">数值{unit ? `（${unit}）` : ""}</th>
          </tr>
        </thead>
        <tbody>
          {series.points.map((point, index) => (
            <tr key={`${point.label}-${index}`}>
              <td>{point.label}</td>
              <td className="num">{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ 看板卡片 */

/** 配置页注入的交互钩子；正式驾驶舱页不传，看板就是纯展示。 */
export type BoardEditorHooks = {
  selectedEntryId: string | null;
  draggingEntryId: string | null;
  onSelect: (entryId: string) => void;
  onDragStart: (entryId: string) => void;
  onDragEnd: () => void;
  onDrop: (entryId: string) => void;
  onChartKind: (entryId: string, kind: ChartKind) => void;
  onCycleSize: (entryId: string) => void;
  onEditItem: (entryId: string) => void;
  onRemove: (entryId: string) => void;
};

function UnavailableCard({ reason }: { reason: string }) {
  return (
    <div className={styles.unavailableBody}>
      <span className={styles.unavailableBadge}>未接入</span>
      <p className={styles.unavailableReason}>{reason}</p>
    </div>
  );
}

function BoardCard({
  item,
  entry,
  category,
  template,
  series,
  index,
  spotlight,
  dimmed,
  compact,
  editor,
}: {
  item: MetricCockpitItem;
  entry: MetricDictionaryEntry | undefined;
  category: MetricCategory | undefined;
  template: ChartTemplate | null;
  series: ChartSeries | null;
  /** 入场错峰的序号，只用来算 CSS 延迟 */
  index: number;
  /** 大屏轮播焦点落在本卡 */
  spotlight?: boolean;
  /** 轮播中但焦点不在本卡 */
  dimmed?: boolean;
  compact?: boolean;
  editor?: BoardEditorHooks;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const selected = editor?.selectedEntryId === item.entryId;
  useEffect(() => {
    // 左侧点了指标行，预览要滚到对应卡片，否则「高亮」在视口外等于没高亮。
    if (selected) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const name = entry?.name ?? "指标已被删除";
  const unit = template?.unit ?? METRIC_VALUE_BINDINGS[item.entryId]?.unit ?? "";
  const sizeClass = item.size === "small" ? styles.cardSmall : item.size === "wide" ? styles.cardWide : styles.cardMedium;
  const classNames = [
    styles.card,
    sizeClass,
    compact ? styles.cardCompact : "",
    selected ? styles.cardSelected : "",
    spotlight ? styles.cardSpotlight : "",
    dimmed ? styles.cardDimmed : "",
    editor?.draggingEntryId === item.entryId ? styles.cardDragging : "",
  ].filter(Boolean).join(" ");
  let body: React.ReactNode;
  if (!entry) {
    body = <UnavailableCard reason="指标已从字典移除" />;
  } else if (!series) {
    body = <UnavailableCard reason="尚未接入填报口径" />;
  } else if (series.unavailable) {
    body = <UnavailableCard reason={series.unavailableReason ?? "当前口径下暂无数据"} />;
  } else if (item.chartKind === "stat") {
    body = <StatChart series={series} unit={unit} compact={compact} />;
  } else if (item.chartKind === "bar") {
    body = <BarChart series={series} unit={unit} label={name} compact={compact} />;
  } else if (item.chartKind === "line") {
    body = <LineChart series={series} unit={unit} label={name} compact={compact} />;
  } else if (item.chartKind === "pie") {
    body = <PieChart series={series} unit={unit} label={name} compact={compact} />;
  } else {
    body = <TableChart series={series} unit={unit} groupBy={template?.groupBy ?? "department"} />;
  }
  return (
    <div
      ref={cardRef}
      className={classNames}
      style={{ "--i": Math.min(index, STAGGER_MAX_INDEX) } as CSSProperties}
      draggable={Boolean(editor)}
      onDragStart={editor ? () => editor.onDragStart(item.entryId) : undefined}
      onDragEnd={editor ? () => editor.onDragEnd() : undefined}
      onDragOver={editor ? (event) => event.preventDefault() : undefined}
      onDrop={editor ? () => editor.onDrop(item.entryId) : undefined}
      onClick={editor ? () => editor.onSelect(item.entryId) : undefined}
    >
      {/* 刷新脉冲：指纹变了这一层才重新挂载，重新挂载才重播动画——
          于是「数真的变了」才闪一下，父组件重渲染不会满屏乱闪。 */}
      <span key={seriesSignature(series, item.chartKind)} className={styles.freshPulse} aria-hidden />
      <div className={styles.cardHead}>
        {category ? <i className={`${styles.toneDot} ${TONE_CLASS[category.tone]}`} aria-hidden /> : null}
        <strong className={styles.cardTitle}>{name}</strong>
        {editor ? <GripVertical size={14} className={styles.cardGrip} aria-hidden /> : null}
      </div>
      {body}
      {editor ? (
        <div className={styles.cardActions}>
          {CHART_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={kind === item.chartKind ? `${styles.kindButton} ${styles.kindButtonActive}` : styles.kindButton}
              title={`切换为${CHART_KIND_LABELS[kind]}`}
              aria-label={`切换为${CHART_KIND_LABELS[kind]}`}
              aria-pressed={kind === item.chartKind}
              onClick={(event) => { event.stopPropagation(); editor.onChartKind(item.entryId, kind); }}
            >
              {CHART_KIND_LABELS[kind].charAt(0)}
            </button>
          ))}
          <span className={styles.actionDivider} aria-hidden />
          <button
            type="button"
            className={styles.actionButton}
            title="切换卡片尺寸"
            aria-label={`切换卡片尺寸（当前：${SIZE_LABELS[item.size]}）`}
            onClick={(event) => { event.stopPropagation(); editor.onCycleSize(item.entryId); }}
          >
            {SIZE_LABELS[item.size]}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            title="更换图表模板"
            aria-label="更换图表模板"
            onClick={(event) => { event.stopPropagation(); editor.onEditItem(item.entryId); }}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionDanger}`}
            title="从看板移除"
            aria-label="从看板移除"
            onClick={(event) => { event.stopPropagation(); editor.onRemove(item.entryId); }}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 大屏轮播 */

/**
 * 轮播焦点下标。
 * 返回 -1 表示不轮播（配置页预览、只有一张卡、或者调用方没传 rotateMs）。
 */
function useSpotlight(count: number, rotateMs: number, enabled: boolean) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!enabled || paused || count < 2 || rotateMs <= 0) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % count), rotateMs);
    // 卸载、暂停、卡片数变化都会走到这里：不清掉就会有第二个定时器叠着跑，焦点乱跳还漏内存。
    return () => clearInterval(timer);
  }, [enabled, paused, count, rotateMs]);
  return {
    // 卡片被移除后下标可能越界，取模兜一下，别把焦点丢到不存在的卡上。
    index: enabled && count > 0 ? index % count : -1,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  };
}

/**
 * 看板渲染器：配置页预览和正式驾驶舱页共用这一个组件，保证所见即所得——
 * 预览里长什么样，驾驶舱就长什么样，不允许出现两套渲染逻辑各自漂移。
 */
export function MetricCockpitBoard({
  config,
  entries,
  categories,
  ctx,
  templates,
  compact,
  rotateMs,
  editor,
}: {
  config: MetricCockpitConfigState;
  entries: MetricDictionaryEntry[];
  categories: MetricCategory[];
  ctx: ChartComputeContext;
  templates: ChartTemplate[];
  compact?: boolean;
  /** 大屏轮播：每隔 N 毫秒把焦点移到下一张卡片并放大高亮。0 或不传则不轮播 */
  rotateMs?: number;
  /** 仅配置页传：拖拽、图型切换、尺寸、编辑、移除都挂在这里，正式页不传即纯展示 */
  editor?: BoardEditorHooks;
}) {
  const scope = scopeOf(config);
  // 口径开关以配置里的选择为准：ctx 带的是页面默认值，预览和正式页都要跟着配置走。
  const computeCtx: ChartComputeContext = { ...ctx, onlyConfirmed: config.onlyConfirmed };
  const items = [...config.items].sort((left, right) => left.order - right.order);
  // 轮播只在正式展示态生效：配置页传了 editor，卡片自己转起来用户根本点不中要改的那张。
  const rotating = !editor && (rotateMs ?? 0) > 0 && items.length > 1;
  const spotlight = useSpotlight(items.length, rotateMs ?? 0, rotating);
  if (!items.length) {
    return <div className={styles.boardEmpty}>看板还是空的：在左侧指标清单里勾选要展示的指标。</div>;
  }
  return (
    <div
      // 换维度就是换一整套指标，整块重新挂载让入场错峰重播一遍，而不是新旧卡片混在一起跳。
      key={`${config.dimension}:${config.department}`}
      className={compact ? `${styles.board} ${styles.boardCompact}` : styles.board}
      onMouseEnter={rotating ? spotlight.pause : undefined}
      onMouseLeave={rotating ? spotlight.resume : undefined}
    >
      {items.map((item, index) => {
        const entry = entries.find((candidate) => candidate.id === item.entryId);
        const binding = METRIC_VALUE_BINDINGS[item.entryId] ?? null;
        const template = templates.find((candidate) => candidate.id === item.templateId) ?? null;
        // 未接入（没有值绑定或模板缺失）时 series 给 null：卡片渲染空态，绝不用 0 冒充数据。
        const series = binding && template ? computeChartSeries(template, scope, computeCtx) : null;
        return (
          <BoardCard
            key={item.entryId}
            item={item}
            entry={entry}
            category={entry ? metricCategory(categories, entry.categoryId) : undefined}
            template={template}
            series={series}
            index={index}
            spotlight={spotlight.index === index}
            dimmed={spotlight.index >= 0 && spotlight.index !== index}
            compact={compact}
            editor={editor}
          />
        );
      })}
    </div>
  );
}
