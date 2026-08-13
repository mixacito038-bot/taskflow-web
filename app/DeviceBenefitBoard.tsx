"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CircleAlert, GripVertical, Search, X } from "lucide-react";

import styles from "./DeviceBenefitBoard.module.css";
import type { BenefitQuadrant, CapitalBand, DeviceDiagnosis } from "./benefit-diagnosis";
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
  MetricBinding,
  MetricCockpitConfigState,
  MetricCockpitItem,
} from "./chart-template-catalog";

/**
 * 单机效益看板：选一台设备，把指标字典的口径按这台设备算出来，就地配置成图表卡片。
 *
 * 为什么不复用 MetricCockpitBoard：它的取数范围是 scopeOf(config) 从看板配置推出来的，
 * 而 MetricCockpitConfigState 里只有 dimension / department 两个字段，表达不了「哪一台设备」——
 * 换句话说，把任何配置塞给它，算出来的都是全院或某科室的合计，不是这一台的账。
 * 那个文件正被别的改动占用，不能动，所以这里直接调 computeChartSeries(template, 单台范围, ctx) 自渲染，
 * 视觉语言（卡片、五种手写 SVG 图表、入场错峰、未接入空态）在 DeviceBenefitBoard.module.css 里等效重写。
 *
 * 两条底线跟驾驶舱完全一致，一个字不松：
 * 1. 未接入口径的指标（METRIC_VALUE_BINDINGS 为 null）渲染「未接入」空态，绝不用 0 冒充；
 * 2. 缺数一律「—」，不补 0、不估算——这些数是拿去汇报的。
 */

/* ------------------------------------------------------------------ 常量 */

const CHART_KINDS = Object.keys(CHART_KIND_LABELS) as ChartKind[];

const SIZE_SEQUENCE: MetricCockpitItem["size"][] = ["small", "medium", "wide"];

const SIZE_LABELS: Record<MetricCockpitItem["size"], string> = {
  small: "小",
  medium: "中",
  wide: "通栏",
};

/** 表格图型的表头文案；本地留一份，免得跟着别的模块一起改 */
const GROUP_BY_LABELS: Record<ChartTemplate["groupBy"], string> = {
  department: "科室",
  device: "设备",
  costField: "成本构成",
  period: "期间",
};

// 分类色点一律落在主题变量上，深浅主题各取各的色值
const TONE_CLASS: Record<MetricCategoryTone, string> = {
  blue: styles.toneBlue,
  green: styles.toneGreen,
  orange: styles.toneOrange,
  purple: styles.tonePurple,
  red: styles.toneRed,
  slate: styles.toneSlate,
};

/** 处置分档的 pill 色调，与效益分析页同一套，同一台设备在两页不能显示成两种结论 */
const BAND_TONES: Record<CapitalBand, string> = {
  必须替换: "danger",
  计划替换: "warning",
  可延寿: "success",
  共享调拨: "info",
  持续观察: "neutral",
};

const QUADRANT_TONES: Record<BenefitQuadrant, string> = {
  明星: "success",
  潜力: "info",
  低效: "warning",
  问题: "danger",
  待补数: "neutral",
};

/**
 * 环形图扇区取色顺序：相邻两片要在亮暗两套色值下都分得开，所以不按变量声明顺序排。
 * 超过 6 片并入「其他」，循环取色会出现两片同色、图例对不上号。
 */
const PIE_SLOT_COLORS = [
  "var(--primary)",
  "var(--rose)",
  "var(--orange)",
  "var(--green)",
  "var(--violet)",
  "var(--cyan)",
];

const PIE_MAX_SLICES = PIE_SLOT_COLORS.length;

/** 大数字滚动时长；再长就从「有反馈」变成「等它滚完」 */
const COUNT_UP_MS = 700;

/** 入场错峰的序号上限：每张卡 28ms，封顶后最迟一张也在半秒内到位 */
const STAGGER_MAX_INDEX = 16;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/* ------------------------------------------------------------------ 动效开关 */

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * 系统的「减少动效」开关。
 * 用 useSyncExternalStore 而不是 useState + effect：服务端渲染读不到 matchMedia，
 * 而 effect 里同步 setState 是本仓库 eslint 明令禁止的写法。
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

/** null 一律「—」：没数就是没数，显示 0 会被当成真实结果拿去汇报 */
function formatValue(value: number | null): string {
  return value === null ? "—" : formatNumber(value);
}

function pillClass(tone: string): string {
  // globals 的 status-pill 没有 info 档，蓝 pill 用模块类补齐，不动全局样式
  return tone === "info" ? `status-pill ${styles.pillInfo}` : `status-pill ${tone}`;
}

/**
 * 单台设备下的有效分组。
 *
 * 模板的分组是给全院口径定的：落到一台设备上，「按科室」和「按设备」都只剩一个分组，
 * 柱状图会退化成孤零零一根柱子。所以除数值卡（只看合计、与分组无关）外，
 * 一律改成逐期看走势；成本类的饼图改看成本构成，这才是单机最该回答的两个问题。
 */
function groupByFor(kind: ChartKind, template: ChartTemplate): ChartTemplate["groupBy"] {
  if (kind === "stat") return template.groupBy;
  if (kind === "pie" && (template.source.kind === "totalCost" || template.source.kind === "costBreakdown")) return "costField";
  return "period";
}

/**
 * 给指标绑定挑模板：先按「取值 + 聚合」完全一致找，找不到退到取值一致，再找不到 null。
 * 与驾驶舱配置页同一套规则——两边挑出不同模板，同一条指标在两个页面会算出两个数。
 */
function sourceKeyOf(source: ChartTemplate["source"]): string {
  return source.kind === "reportField" ? `field:${source.fieldKey}` : source.kind;
}

function matchTemplate(binding: MetricBinding, templates: readonly ChartTemplate[]): ChartTemplate | null {
  const key = sourceKeyOf(binding.source);
  return (
    templates.find((template) => sourceKeyOf(template.source) === key && template.aggregation === binding.aggregation) ??
    templates.find((template) => sourceKeyOf(template.source) === key) ??
    null
  );
}

/** 数值卡天生小、表格和折线要横向空间，其余中卡；用户随时能在卡片上循环切 */
function defaultSizeFor(kind: ChartKind): MetricCockpitItem["size"] {
  if (kind === "stat") return "small";
  if (kind === "table" || kind === "line") return "wide";
  return "medium";
}

function makeItem(entryId: string, order: number, templates: readonly ChartTemplate[]): MetricCockpitItem {
  const binding = METRIC_VALUE_BINDINGS[entryId] ?? null;
  const chartKind = binding?.defaultChart ?? "stat";
  return {
    entryId,
    // 没绑口径的指标模板 ID 留空：卡片走「未接入」空态，不塞一个口径不符的模板充数
    templateId: binding ? matchTemplate(binding, templates)?.id ?? "" : "",
    chartKind,
    size: defaultSizeFor(chartKind),
    order,
  };
}

/**
 * 大数字从当前值滚到目标值；返回值只用于显示。
 * null 不参与滚动，由调用方直接落到「—」——滚动的中间帧全是「看着像真数」的数字。
 */
function useCountUp(target: number | null): number {
  const reduceMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(0);
  // 记住上一帧滚到哪：数值二次变化时接着滚，而不是每次退回 0 重来
  const fromRef = useRef(0);
  useEffect(() => {
    if (target === null || reduceMotion) return;
    const from = fromRef.current;
    if (from === target) return;
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const progress = Math.min(1, (now - startedAt) / COUNT_UP_MS);
      // ease-out：最后一帧 progress = 1 时刚好等于目标值，不会差一点点
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = from + (target - from) * eased;
      fromRef.current = value;
      setDisplay(value);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    // 卸载/换数必须取消：回调里握着 setDisplay，卡片没了还在跑就是泄漏加控制台报错
    return () => cancelAnimationFrame(frame);
  }, [target, reduceMotion]);
  if (target === null) return 0;
  if (reduceMotion) return target;
  // 目标是整数时中间帧也取整：一笔整数金额滚到一半冒出小数点，看着像脏数据
  return Number.isInteger(target) ? Math.round(display) : display;
}

/* ------------------------------------------------------------------ 图表（手写 SVG，不引库） */

/**
 * 大数字按字符数分档换字号，和指标字典看板同一套规矩。
 * 单机口径的金额虽然比全院小一个量级，但「8,381,400」也有 9 个字符，
 * 而这张看板右边还挂着 232px 的指标清单，卡片比驾驶舱那边更窄。
 * 分档而不是 clamp()：字号下限（≥12px）靠静态断言守，断言只认 `NNpx` 字面量。
 */
function statSizeClass(text: string): string {
  if (text.length >= 12) return styles.statValueXs;
  if (text.length >= 10) return styles.statValueSm;
  if (text.length >= 7) return styles.statValueMd;
  return "";
}

function StatChart({ series, unit }: { series: ChartSeries; unit: string }) {
  const rolled = useCountUp(series.total);
  // 分档看终值不看滚动中的中间值：中间值从 1 位涨到 9 位，
  // 跟着它换档的话数字会一边滚一边变大小，比折行还晃眼。
  const finalText = series.total === null ? "—" : formatValue(series.total);
  const valueClass = [styles.statValue, statSizeClass(finalText)].filter(Boolean).join(" ");
  return (
    <div className={styles.statBox}>
      {/* title 兜底：万一遇到比预估更长的数，省略号之外还能悬浮看全 */}
      <span className={valueClass} title={series.total === null ? undefined : `${finalText}${unit}`}>
        {series.total === null ? "—" : formatValue(rolled)}
        {series.total !== null && unit ? <small className={styles.statUnit}>{unit}</small> : null}
      </span>
      {series.total === null ? <span className={styles.noDataHint}>本期暂无可统计数据</span> : null}
    </div>
  );
}

function BarChart({ series, unit, label }: { series: ChartSeries; unit: string; label: string }) {
  const points = series.points;
  // 缺数的点不参与量程计算：把它当 0 会把整张图的比例压扁，还让人以为那一期真的是 0
  const values = points.filter((point) => point.value !== null).map((point) => point.value as number);
  if (!values.length) return <div className={styles.noData}>本期各分组均无数据</div>;
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const aria = `${label}：${CHART_KIND_LABELS.bar}，${points.length} 个分组，单位${unit || "无"}`;
  // 分组不多时用横向条形：中文标签横排最省地方，值直接标在条尾
  if (points.length <= 8) {
    const rowHeight = 26;
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
        {points.map((point, index) => {
          const y = index * rowHeight + 4;
          const barHeight = rowHeight - 10;
          const value = point.value;
          const barX = value === null ? zeroX : Math.min(zeroX, labelWidth + ((value - min) / span) * plotWidth);
          const barWidth = value === null ? 0 : Math.abs((value / span) * plotWidth);
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
      </svg>
    );
  }
  // 分组一多标签放不下，改纵向柱状，横轴只标几个刻度，明细靠悬浮提示和明细表
  const chartWidth = 340;
  const chartHeight = 140;
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
    </svg>
  );
}

function LineChart({ series, unit, label }: { series: ChartSeries; unit: string; label: string }) {
  const points = series.points;
  const values = points.filter((point) => point.value !== null).map((point) => point.value as number);
  if (!values.length) return <div className={styles.noData}>本期各分组均无数据</div>;
  const chartWidth = 340;
  const chartHeight = 140;
  const padLeft = 12;
  const padRight = 46;
  const padTop = 14;
  const padBottom = 22;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const xOf = (index: number) => padLeft + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yOf = (value: number) => padTop + ((max - value) / span) * plotHeight;
  // 点值为 null 就断线：分成多段各自画，缺数的地方留白而不是连成一条假趋势
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
      {segments.map((segment, segmentIndex) => {
        const linePath = segment.map((point, index) => `${index === 0 ? "M" : "L"}${xOf(point.index)},${yOf(point.value)}`).join(" ");
        const baseline = yOf(Math.max(min, 0));
        const areaPath = `${linePath} L${xOf(segment[segment.length - 1].index)},${baseline} L${xOf(segment[0].index)},${baseline} Z`;
        return (
          <g key={segmentIndex}>
            {segment.length > 1 ? <path className={styles.lineArea} d={areaPath} fill="var(--primary)" fillOpacity={0.08} stroke="none" /> : null}
            {/* pathLength=1 把线长归一化，dasharray/dashoffset 就能用纯 CSS 画出来，
                不必先渲染再用 getTotalLength 量一遍（量的那一帧线是断的，会闪） */}
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
  // 单扇区占满 360° 时首尾点重合画不出弧，按 359.9° 处理
  const angle = Math.min(end - start, Math.PI * 2 - 0.002);
  const [x1, y1] = polarPoint(cx, cy, outer, start);
  const [x2, y2] = polarPoint(cx, cy, outer, start + angle);
  const [x3, y3] = polarPoint(cx, cy, inner, start + angle);
  const [x4, y4] = polarPoint(cx, cy, inner, start);
  const large = angle > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
}

function PieChart({ series, unit, label }: { series: ChartSeries; unit: string; label: string }) {
  // 0 和缺数的扇区不画：画出来是一条看不见的缝，图例里也没意义
  const positive = series.points.filter((point) => point.value !== null && point.value > 0) as { label: string; value: number }[];
  if (!positive.length) return <div className={styles.noData}>本期各分组均无数据</div>;
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const folded = sorted.length > PIE_MAX_SLICES
    ? [...sorted.slice(0, PIE_MAX_SLICES - 1), { label: "其他", value: sorted.slice(PIE_MAX_SLICES - 1).reduce((sum, point) => sum + point.value, 0) }]
    : sorted;
  const total = folded.reduce((sum, point) => sum + point.value, 0);
  const size = 116;
  const cx = size / 2;
  const outer = size / 2 - 2;
  const inner = outer * 0.62;
  // 起止角先算好再渲染：在 map 回调里累加渲染期变量，严格模式重跑一次会把角度加两遍
  const slices: { point: { label: string; value: number }; from: number; to: number }[] = [];
  let cursor = 0;
  for (const point of folded) {
    const sweep = (point.value / total) * Math.PI * 2;
    slices.push({ point, from: cursor, to: cursor + sweep });
    cursor += sweep;
  }
  const colorOf = (index: number, name: string) => (name === "其他" ? "var(--slate)" : PIE_SLOT_COLORS[index]);
  const aria = `${label}：${CHART_KIND_LABELS.pie}，共 ${folded.length} 个分组，合计 ${formatNumber(series.total ?? total)}${unit}`;
  return (
    <div className={styles.pieBox}>
      <svg className={styles.pieSvg} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={aria} style={{ width: size }}>
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
        <text x={cx} y={cx - 2} textAnchor="middle" fontSize={15} fontWeight={650} fill="var(--text)">
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

/* ------------------------------------------------------------------ 卡片 */

/** 就地编辑打开时才注入；关掉即纯展示，卡片不可拖也不出角标 */
type CardEditor = {
  dragging: boolean;
  onDragStart: (entryId: string) => void;
  onDragEnd: () => void;
  onDrop: (entryId: string) => void;
  onChartKind: (entryId: string, kind: ChartKind) => void;
  onCycleSize: (entryId: string) => void;
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
  unit,
  index,
  editor,
}: {
  item: MetricCockpitItem;
  entry: MetricDictionaryEntry | undefined;
  category: MetricCategory | undefined;
  template: ChartTemplate | null;
  /** 未接入口径时为 null，卡片走空态；绝不用 0 冒充 */
  series: ChartSeries | null;
  unit: string;
  /** 入场错峰的序号，只用来算 CSS 延迟 */
  index: number;
  editor: CardEditor | null;
}) {
  const name = entry?.name ?? "指标已被删除";
  const sizeClass = item.size === "small" ? styles.cardSmall : item.size === "wide" ? styles.cardWide : styles.cardMedium;
  const classNames = [
    styles.card,
    sizeClass,
    editor ? styles.cardEditing : "",
    editor?.dragging ? styles.cardDragging : "",
  ].filter(Boolean).join(" ");
  let body: React.ReactNode;
  if (!entry) {
    body = <UnavailableCard reason="指标已从字典移除" />;
  } else if (!series) {
    body = <UnavailableCard reason="尚未接入填报口径" />;
  } else if (series.unavailable) {
    body = <UnavailableCard reason={series.unavailableReason ?? "这台设备本期暂无数据"} />;
  } else if (item.chartKind === "stat") {
    body = <StatChart series={series} unit={unit} />;
  } else if (item.chartKind === "bar") {
    body = <BarChart series={series} unit={unit} label={name} />;
  } else if (item.chartKind === "line") {
    body = <LineChart series={series} unit={unit} label={name} />;
  } else if (item.chartKind === "pie") {
    body = <PieChart series={series} unit={unit} label={name} />;
  } else {
    body = <TableChart series={series} unit={unit} groupBy={template ? groupByFor(item.chartKind, template) : "period"} />;
  }
  return (
    <div
      className={classNames}
      style={{ "--i": Math.min(index, STAGGER_MAX_INDEX) } as CSSProperties}
      draggable={Boolean(editor)}
      onDragStart={editor ? () => editor.onDragStart(item.entryId) : undefined}
      onDragEnd={editor ? () => editor.onDragEnd() : undefined}
      // dragover 不 preventDefault，浏览器不认这里是可放置区域，drop 根本不会触发
      onDragOver={editor ? (event) => event.preventDefault() : undefined}
      onDrop={editor ? (event) => { event.preventDefault(); editor.onDrop(item.entryId); } : undefined}
    >
      <div className={styles.cardHead}>
        {category ? <i className={`${styles.toneDot} ${TONE_CLASS[category.tone]}`} aria-hidden /> : null}
        {/* 标题单行省略 + title 悬浮出全名：钳两行会让「医院设备总结余（设备盈余）」占两行、
            旁边「医院设备总使用率」占一行，同一行卡片高矮不齐，数字也跟着错位。 */}
        <strong className={styles.cardTitle} title={name}>{name}</strong>
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
              onClick={() => editor.onChartKind(item.entryId, kind)}
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
            onClick={() => editor.onCycleSize(item.entryId)}
          >
            {SIZE_LABELS[item.size]}
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionDanger}`}
            title="从看板移除"
            aria-label="从看板移除"
            onClick={() => editor.onRemove(item.entryId)}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 主组件 */

export default function DeviceBenefitBoard({
  diagnoses,
  entries,
  categories,
  templates,
  ctx,
  config,
  onConfigChange,
  periodLabel,
  selectedDeviceId,
  onSelectDevice,
  canManage,
  notify,
  onOpenReporting,
}: {
  /** 全部设备的诊断结果，来自 app/benefit-diagnosis.ts */
  diagnoses: DeviceDiagnosis[];
  entries: MetricDictionaryEntry[];
  categories: MetricCategory[];
  templates: ChartTemplate[];
  /** 算数上下文，与驾驶舱共用同一份 */
  ctx: ChartComputeContext;
  /** 单机看板的卡片配置（哪些指标、什么图型、尺寸、顺序），按医院存云端 */
  config: MetricCockpitConfigState;
  onConfigChange: (next: MetricCockpitConfigState) => void;
  periodLabel: string;
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
  /** 这台设备没有填报数据时，引导去补数 */
  onOpenReporting: (deviceId: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState(false);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);

  // 权限随时可能被收回：编辑态由「有权限 且 开着开关」共同决定，
  // 不用 effect 去把 editing 改回 false（effect 里同步 setState 是本仓库的 eslint 红线）
  const editorOn = canManage && editing;

  const filteredDevices = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) return diagnoses;
    return diagnoses.filter((item) =>
      [item.facts.name, item.facts.assetCode, item.facts.department, item.facts.model]
        .some((part) => (part ?? "").toLowerCase().includes(text)));
  }, [diagnoses, keyword]);

  const selected = useMemo(
    () => diagnoses.find((item) => item.facts.deviceId === selectedDeviceId) ?? null,
    [diagnoses, selectedDeviceId],
  );

  // 口径开关跟着看板配置走，与驾驶舱同一条规则：ctx 带的只是页面默认值
  const computeCtx = useMemo<ChartComputeContext>(
    () => ({ ...ctx, onlyConfirmed: config.onlyConfirmed }),
    [ctx, config.onlyConfirmed],
  );

  const items = useMemo(() => [...config.items].sort((left, right) => left.order - right.order), [config.items]);

  /* -------------------------------------------------- 配置写回 */

  function updateItem(entryId: string, patch: Partial<MetricCockpitItem>) {
    onConfigChange({
      ...config,
      items: config.items.map((item) => (item.entryId === entryId ? { ...item, ...patch } : item)),
    });
  }

  function toggleEntry(entry: MetricDictionaryEntry) {
    const existing = config.items.find((item) => item.entryId === entry.id);
    if (existing) {
      onConfigChange({ ...config, items: config.items.filter((item) => item.entryId !== entry.id) });
      return;
    }
    const nextOrder = config.items.reduce((max, item) => Math.max(max, item.order), -1) + 1;
    onConfigChange({ ...config, items: [...config.items, makeItem(entry.id, nextOrder, templates)] });
    if (!METRIC_VALUE_BINDINGS[entry.id]) {
      notify(`「${entry.name}」还没接入填报口径，卡片会显示「未接入」，不会给估算值`);
    }
  }

  function dropOnItem(targetEntryId: string) {
    if (!draggingEntryId || draggingEntryId === targetEntryId) return;
    const source = config.items.find((item) => item.entryId === draggingEntryId);
    const target = config.items.find((item) => item.entryId === targetEntryId);
    if (!source || !target) return;
    // 交换两张卡的 order 而不是整体插入：拖到谁就跟谁换位，与驾驶舱配置一个手感
    onConfigChange({
      ...config,
      items: config.items.map((item) => {
        if (item.entryId === source.entryId) return { ...item, order: target.order };
        if (item.entryId === target.entryId) return { ...item, order: source.order };
        return item;
      }),
    });
    setDraggingEntryId(null);
  }

  function cycleSize(entryId: string) {
    const item = config.items.find((candidate) => candidate.entryId === entryId);
    if (!item) return;
    const next = SIZE_SEQUENCE[(SIZE_SEQUENCE.indexOf(item.size) + 1) % SIZE_SEQUENCE.length];
    updateItem(entryId, { size: next });
  }

  function removeItem(entryId: string) {
    const entry = entries.find((candidate) => candidate.id === entryId);
    onConfigChange({ ...config, items: config.items.filter((item) => item.entryId !== entryId) });
    notify(`已从看板移除「${entry?.name ?? entryId}」`);
  }

  /* -------------------------------------------------- 渲染 */

  const facts = selected?.facts ?? null;
  const factCells: { label: string; value: number | null; unit: string; negative?: boolean }[] = facts
    ? [
        { label: "本期收入", value: facts.revenue, unit: "元" },
        { label: "本期成本", value: facts.cost, unit: "元" },
        { label: "本期结余", value: facts.margin, unit: "元", negative: facts.margin !== null && facts.margin < 0 },
        { label: "使用率", value: facts.utilization, unit: "%" },
        { label: "完好率", value: facts.integrity, unit: "%" },
        { label: "单次检查成本", value: facts.costPerExam, unit: "元" },
      ]
    : [];

  const board = (
    <div className={styles.board}>
      {items.map((item, index) => {
        const entry = entries.find((candidate) => candidate.id === item.entryId);
        const binding = METRIC_VALUE_BINDINGS[item.entryId] ?? null;
        const template = templates.find((candidate) => candidate.id === item.templateId) ?? null;
        // 范围永远钉死在这一台设备上：本页回答的就是「这台设备的账」
        const scope: CockpitScope = { level: "device", deviceId: selectedDeviceId };
        // 没有值绑定或模板缺失时 series 给 null：卡片渲染「未接入」空态，绝不用 0 冒充数据
        const series = binding && template
          ? computeChartSeries({ ...template, groupBy: groupByFor(item.chartKind, template) }, scope, computeCtx)
          : null;
        return (
          <BoardCard
            key={item.entryId}
            item={item}
            entry={entry}
            category={entry ? metricCategory(categories, entry.categoryId) : undefined}
            template={template}
            series={series}
            unit={template?.unit ?? binding?.unit ?? ""}
            index={index}
            editor={editorOn ? {
              dragging: draggingEntryId === item.entryId,
              onDragStart: setDraggingEntryId,
              onDragEnd: () => setDraggingEntryId(null),
              onDrop: dropOnItem,
              onChartKind: (entryId, kind) => updateItem(entryId, { chartKind: kind }),
              onCycleSize: cycleSize,
              onRemove: removeItem,
            } : null}
          />
        );
      })}
    </div>
  );

  return (
    <div className={styles.layout}>
      <aside className={styles.rail}>
        <div className={styles.railHead}>
          <strong>选择设备</strong>
          <span className="chart-note">{filteredDevices.length} / {diagnoses.length}</span>
        </div>
        <label className={`search-field ${styles.searchBox}`}>
          <Search size={15} />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="设备名称 / 资产编号 / 科室"
            aria-label="搜索设备"
          />
        </label>
        {filteredDevices.length ? (
          <ul className={styles.deviceList}>
            {filteredDevices.map((item) => {
              const device = item.facts;
              const active = device.deviceId === selectedDeviceId;
              return (
                <li key={device.deviceId}>
                  <button
                    type="button"
                    className={active ? `${styles.deviceRow} ${styles.deviceRowActive}` : styles.deviceRow}
                    aria-pressed={active}
                    onClick={() => onSelectDevice(device.deviceId)}
                  >
                    <i
                      className={device.hasReport ? `${styles.deviceDot} ${styles.dotOn}` : `${styles.deviceDot} ${styles.dotOff}`}
                      title={device.hasReport ? "本期有填报数据" : "本期没有填报数据"}
                      aria-hidden
                    />
                    <span className={styles.deviceCell}>
                      <strong>{device.name}</strong>
                      <small>{[device.model, device.department].filter(Boolean).join(" · ") || "—"}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.railEmpty}>没有匹配的设备，换个关键词试试。</div>
        )}
      </aside>

      <div className={styles.main}>
        {!selected || !facts ? (
          <section className={`panel ${styles.emptyPanel}`}>
            <CircleAlert size={20} />
            <div>
              <strong>先在左侧选一台设备</strong>
              <p>选定后这里按这台设备的口径出档案和指标看板。</p>
            </div>
          </section>
        ) : (
          <>
            <section className={`panel ${styles.profilePanel}`}>
              <div className={styles.profileHead}>
                <div className={styles.profileIdent}>
                  <strong className={styles.profileName}>{facts.name}</strong>
                  <span className={styles.profileMeta}>
                    {[facts.model || "—", facts.assetCode || "—", facts.department || "—"].join(" · ")}
                  </span>
                </div>
                <div className={styles.profilePills}>
                  <span className={pillClass(BAND_TONES[selected.band])}>{selected.band}</span>
                  <span className={pillClass(QUADRANT_TONES[selected.quadrant])}>{selected.quadrant}</span>
                  <span className={selected.riskScore >= 60 ? `${styles.riskPill} ${styles.riskDanger}` : selected.riskScore >= 40 ? `${styles.riskPill} ${styles.riskWarn}` : styles.riskPill}>
                    风险分 {selected.riskScore}
                  </span>
                  <span className="chart-note">{periodLabel} · {config.onlyConfirmed ? "仅已确认" : "含草稿"}</span>
                </div>
              </div>
              {facts.hasReport === false ? (
                <div className={styles.guide}>
                  <span className={styles.guideIcon}><CircleAlert size={18} /></span>
                  <div className={styles.guideCopy}>
                    <strong>本期没有填报数据</strong>
                    <p>{periodLabel} 内这台设备没有可用的填报记录，效益指标一律算不出来，本页不会拿 0 值凑图表。补齐填报后自动出数。</p>
                  </div>
                  <button type="button" className="primary-button" onClick={() => onOpenReporting(facts.deviceId)}>去填报</button>
                </div>
              ) : (
                <div className={styles.factGrid}>
                  {factCells.map((cell) => (
                    <div key={cell.label} className={styles.factCell}>
                      <span className={styles.factLabel}>{cell.label}</span>
                      <span
                        className={cell.negative ? `${styles.factValue} ${styles.factNegative}` : styles.factValue}
                        title={cell.value === null ? "本期缺数据" : `${formatValue(cell.value)} ${cell.unit}`}
                      >
                        {formatValue(cell.value)}
                        {cell.value === null ? null : <small className={styles.factUnit}>{cell.unit}</small>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {facts.hasReport === false ? null : (
              <section className={`panel ${styles.boardPanel}`}>
                <div className="panel-heading">
                  <div>
                    <h3>指标看板</h3>
                    <p>指标字典的口径，按这台设备算。未接入口径的指标显示「未接入」，缺数显示「—」。</p>
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={editing}
                      className={editing ? `${styles.editSwitch} ${styles.editSwitchOn}` : styles.editSwitch}
                      onClick={() => setEditing(!editing)}
                    >
                      <i aria-hidden />编辑看板
                    </button>
                  ) : null}
                </div>
                <div className={editorOn ? `${styles.boardArea} ${styles.boardAreaEditing}` : styles.boardArea}>
                  {items.length ? board : (
                    <div className={styles.boardEmpty}>
                      看板还是空的：{canManage ? "打开「编辑看板」后在右侧指标清单里勾选要展示的指标。" : "请联系有配置权限的同事勾选要展示的指标。"}
                    </div>
                  )}
                  {editorOn ? (
                    <aside className={styles.picker}>
                      <div className={styles.pickerHead}>
                        <strong>指标清单</strong>
                        <span className="chart-note">{config.items.length} / {entries.length}</span>
                      </div>
                      <ul className={styles.pickerList}>
                        {entries.map((entry) => {
                          const binding = METRIC_VALUE_BINDINGS[entry.id] ?? null;
                          const included = config.items.some((item) => item.entryId === entry.id);
                          const category = metricCategory(categories, entry.categoryId);
                          return (
                            <li key={entry.id}>
                              <label className={styles.pickerRow}>
                                <input
                                  type="checkbox"
                                  checked={included}
                                  aria-label={`加入看板：${entry.name}`}
                                  onChange={() => toggleEntry(entry)}
                                />
                                <i className={`${styles.toneDot} ${category ? TONE_CLASS[category.tone] : styles.toneSlate}`} aria-hidden />
                                <span className={styles.pickerName}>{entry.name}</span>
                                <span className={binding ? `${styles.pickerBadge} ${styles.pickerBadgeOk}` : `${styles.pickerBadge} ${styles.pickerBadgeNone}`}>
                                  {binding ? "可算" : "未接入"}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <p className={styles.pickerHint}>拖动卡片换位；悬停卡片出角标可换图型、切尺寸、移除。</p>
                    </aside>
                  ) : null}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
