"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, GripVertical, LayoutDashboard, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";

import styles from "./MetricCockpitConfig.module.css";
import {
  MetricCategory,
  MetricCategoryTone,
  MetricDictionaryEntry,
  metricCategory,
} from "./metric-dictionary";
import {
  CHART_KIND_LABELS,
  ChartAggregation,
  ChartComputeContext,
  ChartKind,
  ChartSeries,
  ChartTemplate,
  ChartValueSource,
  COCKPIT_DIMENSION_PRESETS,
  CockpitScope,
  computeChartSeries,
  METRIC_VALUE_BINDINGS,
  MetricBinding,
  MetricCockpitConfigState,
  MetricCockpitItem,
  RateSpec,
} from "./chart-template-catalog";
import { REPORT_FIELD_GROUPS, reportFieldLabel } from "./device-report-fields";

const CHART_KINDS = Object.keys(CHART_KIND_LABELS) as ChartKind[];

const SIZE_SEQUENCE: MetricCockpitItem["size"][] = ["small", "medium", "wide"];

const SIZE_LABELS: Record<MetricCockpitItem["size"], string> = {
  small: "小",
  medium: "中",
  wide: "通栏",
};

const GROUP_BY_LABELS: Record<ChartTemplate["groupBy"], string> = {
  department: "科室",
  device: "设备",
  costField: "成本构成",
  period: "期间",
};

const AGGREGATION_LABELS: Record<ChartAggregation, string> = {
  sum: "求和",
  rate: "比率",
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

function sourceToKey(source: ChartValueSource): string {
  return source.kind === "reportField" ? `field:${source.fieldKey}` : source.kind;
}

function keyToSource(key: string): ChartValueSource {
  if (key.startsWith("field:")) return { kind: "reportField", fieldKey: key.slice("field:".length) };
  return { kind: key as "totalCost" | "margin" | "costBreakdown" };
}

function denominatorToKey(denominator: RateSpec["denominator"]): string {
  return typeof denominator === "string" ? denominator : `field:${denominator.fieldKey}`;
}

function keyToDenominator(key: string): RateSpec["denominator"] {
  if (key.startsWith("field:")) return { fieldKey: key.slice("field:".length) };
  return key as "calendarDays" | "usageHours" | "deviceCount";
}

const DENOMINATOR_LABELS: Record<string, string> = {
  calendarDays: "周期日历天数",
  usageHours: "使用小时数",
  deviceCount: "在用设备台数",
};

function fieldLabelOf(ctx: ChartComputeContext, fieldKey: string): string {
  const granularity = ctx.periods.length ? ctx.periods[0].granularity : "month";
  const field = ctx.fields.find((item) => item.key === fieldKey);
  return field ? reportFieldLabel(field, granularity) : fieldKey;
}

function describeSource(ctx: ChartComputeContext, source: ChartValueSource): string {
  if (source.kind === "reportField") return `填报字段「${fieldLabelOf(ctx, source.fieldKey)}」`;
  if (source.kind === "totalCost") return "当期总成本（计入成本的填报项合计）";
  if (source.kind === "margin") return "结余（总收入 − 当期总成本）";
  return "成本构成（计入成本的字段逐项拆分）";
}

function describeDenominator(ctx: ChartComputeContext, denominator: RateSpec["denominator"]): string {
  if (typeof denominator === "string") return DENOMINATOR_LABELS[denominator] ?? denominator;
  return `填报字段「${fieldLabelOf(ctx, denominator.fieldKey)}」`;
}

function describeTemplate(ctx: ChartComputeContext, template: ChartTemplate): string {
  const base = describeSource(ctx, template.source);
  const grouped = `按${GROUP_BY_LABELS[template.groupBy]}分组`;
  if (template.aggregation === "rate" && template.rate) {
    return `${describeSource(ctx, template.rate.numerator)} ÷ ${describeDenominator(ctx, template.rate.denominator)}，${grouped}`;
  }
  return `${base}求和，${grouped}`;
}

/**
 * 给指标绑定挑模板：先按取值 + 聚合完全一致找，找不到再退到取值一致的。
 * 匹配不上返回 null，让卡片走「未接入」空态，绝不随手塞一个口径不符的模板充数。
 */
function matchTemplate(binding: MetricBinding, templates: readonly ChartTemplate[]): ChartTemplate | null {
  const key = sourceToKey(binding.source);
  return (
    templates.find((template) => sourceToKey(template.source) === key && template.aggregation === binding.aggregation) ??
    templates.find((template) => sourceToKey(template.source) === key) ??
    null
  );
}

/** stat 天生是小卡、表格和折线需要横向空间，其余默认中卡；用户随时可在预览里循环切。 */
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
    templateId: binding ? matchTemplate(binding, templates)?.id ?? "" : "",
    chartKind,
    size: defaultSizeFor(chartKind),
    order,
  };
}

function presetItems(entryIds: readonly string[], templates: readonly ChartTemplate[]): MetricCockpitItem[] {
  return entryIds.map((entryId, index) => makeItem(entryId, index, templates));
}

function sameItems(left: readonly MetricCockpitItem[], right: readonly MetricCockpitItem[]): boolean {
  if (left.length !== right.length) return false;
  const sortByOrder = (list: readonly MetricCockpitItem[]) => [...list].sort((a, b) => a.order - b.order);
  const a = sortByOrder(left);
  const b = sortByOrder(right);
  return a.every((item, index) =>
    item.entryId === b[index].entryId &&
    item.templateId === b[index].templateId &&
    item.chartKind === b[index].chartKind &&
    item.size === b[index].size);
}

function scopeOf(config: MetricCockpitConfigState): CockpitScope {
  return config.dimension === "department" && config.department
    ? { level: "department", department: config.department }
    : { level: "hospital" };
}

/* ------------------------------------------------------------------ 图表渲染（手写 SVG，不引库） */

function StatChart({ series, unit, compact }: { series: ChartSeries; unit: string; compact?: boolean }) {
  return (
    <div className={styles.statBox}>
      <span className={compact ? `${styles.statValue} ${styles.statValueCompact}` : styles.statValue}>
        {formatValue(series.total)}
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
                <rect x={barX} y={y} width={Math.max(barWidth, 1)} height={barHeight} rx={3} fill="var(--primary)" />
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
      {points.map((point, index) => {
        const value = point.value;
        const x = padLeft + index * slot + (slot - barWidth) / 2;
        const barHeight = value === null ? 0 : (Math.abs(value) / span) * plotHeight;
        const y = value !== null && value >= 0 ? zeroY - barHeight : zeroY;
        return (
          <g key={`${point.label}-${index}`}>
            <title>{`${point.label}：${formatValue(value)}${value === null ? "" : unit}`}</title>
            {value !== null ? <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} rx={3} fill="var(--primary)" /> : null}
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
            {segment.length > 1 ? <path d={areaPath} fill="var(--primary)" fillOpacity={0.08} stroke="none" /> : null}
            <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {segment.map((point) => (
              <circle
                key={point.index}
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
        <text x={xOf(lastPoint.index) + 8} y={yOf(lastPoint.value) + 4} fontSize={12} fontWeight={600} fill="var(--text)">
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
  return (
    <div className={styles.pieBox}>
      <svg className={styles.pieSvg} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={aria} style={{ width: size }}>
        {slices.map(({ point, from, to }, index) => (
          <path
            key={point.label}
            d={donutSlicePath(cx, cx, outer, inner, from, to)}
            fill={colorOf(index, point.label)}
            stroke="var(--surface)"
            strokeWidth={2}
          >
            <title>{`${point.label}：${formatNumber(point.value)}${unit}`}</title>
          </path>
        ))}
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
  compact,
  editor,
}: {
  item: MetricCockpitItem;
  entry: MetricDictionaryEntry | undefined;
  category: MetricCategory | undefined;
  template: ChartTemplate | null;
  series: ChartSeries | null;
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
      draggable={Boolean(editor)}
      onDragStart={editor ? () => editor.onDragStart(item.entryId) : undefined}
      onDragEnd={editor ? () => editor.onDragEnd() : undefined}
      onDragOver={editor ? (event) => event.preventDefault() : undefined}
      onDrop={editor ? () => editor.onDrop(item.entryId) : undefined}
      onClick={editor ? () => editor.onSelect(item.entryId) : undefined}
    >
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
  editor,
}: {
  config: MetricCockpitConfigState;
  entries: MetricDictionaryEntry[];
  categories: MetricCategory[];
  ctx: ChartComputeContext;
  templates: ChartTemplate[];
  compact?: boolean;
  /** 仅配置页传：拖拽、图型切换、尺寸、编辑、移除都挂在这里，正式页不传即纯展示 */
  editor?: BoardEditorHooks;
}) {
  const scope = scopeOf(config);
  // 口径开关以配置里的选择为准：ctx 带的是页面默认值，预览和正式页都要跟着配置走。
  const computeCtx: ChartComputeContext = { ...ctx, onlyConfirmed: config.onlyConfirmed };
  const items = [...config.items].sort((left, right) => left.order - right.order);
  if (!items.length) {
    return <div className={styles.boardEmpty}>看板还是空的：在左侧指标清单里勾选要展示的指标。</div>;
  }
  return (
    <div className={compact ? `${styles.board} ${styles.boardCompact}` : styles.board}>
      {items.map((item) => {
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
            compact={compact}
            editor={editor}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ 配置页 */

function nextTemplateId(templates: readonly ChartTemplate[]): string {
  let index = templates.length + 1;
  while (templates.some((template) => template.id === `hospital-chart-${index}`)) index += 1;
  return `hospital-chart-${index}`;
}

function emptyTemplate(): ChartTemplate {
  return {
    id: "",
    name: "",
    description: "",
    chartKind: "bar",
    source: { kind: "totalCost" },
    aggregation: "sum",
    unit: "元",
    groupBy: "department",
    builtin: false,
  };
}

export default function MetricCockpitConfig({
  config,
  onConfigChange,
  templates,
  onTemplatesChange,
  entries,
  categories,
  ctx,
  canManage,
  notify,
}: {
  config: MetricCockpitConfigState;
  onConfigChange: (next: MetricCockpitConfigState) => void;
  templates: ChartTemplate[];
  onTemplatesChange: (next: ChartTemplate[]) => void;
  entries: MetricDictionaryEntry[];
  categories: MetricCategory[];
  ctx: ChartComputeContext;
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
}) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [confirmPreset, setConfirmPreset] = useState<"leader" | "department" | "board" | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<ChartTemplate | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const departments = useMemo(() => {
    const seen = new Set<string>();
    for (const device of ctx.devices) {
      const department = device.department?.trim();
      if (department) seen.add(department);
    }
    return [...seen];
  }, [ctx.devices]);

  const currentPreset = COCKPIT_DIMENSION_PRESETS.find((preset) => preset.id === config.dimension) ?? null;
  // 只有在用户确实改过看板时才拦一道确认：没改过就静默重置，弹窗会变成狼来了。
  const itemsDirty = currentPreset ? !sameItems(config.items, presetItems(currentPreset.entryIds, templates)) : true;

  function applyPreset(presetId: "leader" | "department" | "board") {
    const preset = COCKPIT_DIMENSION_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    onConfigChange({
      ...config,
      dimension: presetId,
      department: presetId === "department" ? (config.department || departments[0] || "") : config.department,
      items: presetItems(preset.entryIds, templates),
    });
    setConfirmPreset(null);
    notify(`已切换到「${preset.label}」，看板已重置为该视角的默认指标组合`);
  }

  function handlePresetClick(presetId: "leader" | "department" | "board") {
    if (presetId === config.dimension) return;
    if (itemsDirty) {
      setConfirmPreset(presetId);
      return;
    }
    applyPreset(presetId);
  }

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
    setSelectedEntryId(entry.id);
  }

  function dropOnItem(targetEntryId: string) {
    if (!draggingEntryId || draggingEntryId === targetEntryId) return;
    const source = config.items.find((item) => item.entryId === draggingEntryId);
    const target = config.items.find((item) => item.entryId === targetEntryId);
    if (!source || !target) return;
    // 交换两张卡片的 order 而不是整体插入：和驾驶舱模块编排一个手感，拖到谁就跟谁换位。
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
    onConfigChange({ ...config, items: config.items.filter((item) => item.entryId !== entryId) });
  }

  function saveTemplate(event: FormEvent) {
    event.preventDefault();
    if (!templateDraft) return;
    const name = templateDraft.name.trim();
    if (!name) {
      notify("请填写模板名称", "error");
      return;
    }
    if (templateDraft.aggregation === "rate" && !templateDraft.rate) {
      notify("比率模板必须配置分子和分母", "error");
      return;
    }
    const next: ChartTemplate = {
      ...templateDraft,
      name,
      // 聚合从比率改回求和时把 rate 一并清掉，否则残留配置会在导出的口径说明里冒出来。
      rate: templateDraft.aggregation === "rate" ? templateDraft.rate : undefined,
    };
    if (next.id) {
      onTemplatesChange(templates.map((template) => (template.id === next.id ? next : template)));
      notify(`模板「${name}」已更新`);
    } else {
      onTemplatesChange([...templates, { ...next, id: nextTemplateId(templates) }]);
      notify(`模板「${name}」已创建`);
    }
    setTemplateDraft(null);
  }

  function removeTemplate(template: ChartTemplate) {
    if (config.items.some((item) => item.templateId === template.id)) {
      notify("该模板正被看板卡片使用，请先把对应卡片换到其它模板", "error");
      return;
    }
    onTemplatesChange(templates.filter((candidate) => candidate.id !== template.id));
    notify(`模板「${template.name}」已删除`);
  }

  const editingItem = editingItemId ? config.items.find((item) => item.entryId === editingItemId) ?? null : null;
  const editingEntry = editingItem ? entries.find((entry) => entry.id === editingItem.entryId) ?? null : null;
  const scopeLabel = config.dimension === "department" ? `科室：${config.department || "未选择"}` : "全院口径";
  const draftRate: RateSpec = templateDraft?.rate ?? { numerator: templateDraft?.source ?? { kind: "totalCost" }, denominator: "calendarDays", percent: true };

  const sourceOptions = (
    <>
      {REPORT_FIELD_GROUPS.map((group) => {
        const fields = ctx.fields.filter((field) => field.groupId === group.id);
        if (!fields.length) return null;
        return (
          <optgroup key={group.id} label={group.label}>
            {fields.map((field) => (
              <option key={field.key} value={`field:${field.key}`}>
                {fieldLabelOf(ctx, field.key)}
              </option>
            ))}
          </optgroup>
        );
      })}
      <optgroup label="派生口径">
        <option value="totalCost">当期总成本</option>
        <option value="margin">结余（收入 − 成本）</option>
        <option value="costBreakdown">成本构成</option>
      </optgroup>
    </>
  );

  return (
    <div className={styles.layout}>
      <div className={styles.sideColumn}>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>维度</h3>
              <p>驾驶舱按谁在看分三个视角，切换会重置右侧看板为该视角的默认指标。</p>
            </div>
          </div>
          <div className={styles.presetGrid}>
            {COCKPIT_DIMENSION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={preset.id === config.dimension ? `${styles.presetCard} ${styles.presetActive}` : styles.presetCard}
                onClick={() => handlePresetClick(preset.id)}
              >
                <LayoutDashboard size={15} aria-hidden />
                <span>
                  <strong>{preset.label}</strong>
                  <small>{preset.description}</small>
                </span>
              </button>
            ))}
          </div>
          {config.dimension === "department" ? (
            <label className={`form-field ${styles.departmentField}`}>
              <span>统计科室</span>
              <select
                value={config.department}
                onChange={(event) => onConfigChange({ ...config, department: event.target.value })}
              >
                <option value="">请选择科室</option>
                {departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
              <small>科室清单来自设备台账的使用科室，看板只统计该科室名下的设备。</small>
            </label>
          ) : null}
          <div className={styles.switchRow}>
            <button
              type="button"
              role="switch"
              aria-checked={config.onlyConfirmed}
              className={config.onlyConfirmed ? `${styles.switch} ${styles.switchOn}` : styles.switch}
              onClick={() => onConfigChange({ ...config, onlyConfirmed: !config.onlyConfirmed })}
            >
              <i aria-hidden />
            </button>
            <span>
              <strong>正式口径</strong>
              <small>开：只统计已确认的填报数据；关：连同填报中、已提交的草稿一起算（预览口径）。</small>
            </span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>指标清单</h3>
              <p>勾选加入看板；「未接入」的指标也能加，等填报口径覆盖后自动点亮，不显示估算值。</p>
            </div>
            <span className="chart-note">{config.items.length} / {entries.length} 已上板</span>
          </div>
          <ul className={styles.metricList}>
            {entries.map((entry) => {
              const binding = METRIC_VALUE_BINDINGS[entry.id] ?? null;
              const included = config.items.some((item) => item.entryId === entry.id);
              const category = metricCategory(categories, entry.categoryId);
              const rowClass = [
                styles.metricRow,
                selectedEntryId === entry.id ? styles.metricRowSelected : "",
              ].filter(Boolean).join(" ");
              return (
                <li key={entry.id}>
                  <div className={rowClass} onClick={() => setSelectedEntryId(entry.id)}>
                    <input
                      type="checkbox"
                      checked={included}
                      aria-label={`加入看板：${entry.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleEntry(entry)}
                    />
                    <i className={`${styles.toneDot} ${category ? TONE_CLASS[category.tone] : styles.toneSlate}`} aria-hidden />
                    <span className={styles.metricName}>{entry.name}</span>
                    <span className={binding ? `${styles.bindBadge} ${styles.bindOk}` : `${styles.bindBadge} ${styles.bindNone}`}>
                      {binding ? "可自动计算" : "未接入"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>
                <button type="button" className={styles.libraryToggle} onClick={() => setLibraryOpen((open) => !open)} aria-expanded={libraryOpen}>
                  模板库
                  <ChevronDown size={15} className={libraryOpen ? styles.chevronOpen : styles.chevron} aria-hidden />
                </button>
              </h3>
              <p>计算规则和引用哪一个值都在模板里配好，卡片只负责选模板和挑图型。</p>
            </div>
            {canManage ? (
              <button type="button" className="secondary-button" onClick={() => { setLibraryOpen(true); setTemplateDraft(emptyTemplate()); }}>
                <Plus size={15} />新增模板
              </button>
            ) : null}
          </div>
          {libraryOpen ? (
            <ul className={styles.templateList}>
              {templates.map((template) => (
                <li key={template.id} className={styles.templateRow}>
                  <div className={styles.templateCopy}>
                    <div className={styles.templateTitle}>
                      <strong>{template.name}</strong>
                      <span className={styles.kindTag}>{CHART_KIND_LABELS[template.chartKind]}</span>
                      {template.builtin ? <span className={styles.builtinTag}>内置</span> : null}
                    </div>
                    <small>{describeTemplate(ctx, template)}</small>
                  </div>
                  {canManage ? (
                    <div className={styles.templateActions}>
                      <button type="button" className="icon-button" aria-label={`编辑模板 ${template.name}`} onClick={() => setTemplateDraft({ ...template })}>
                        <Pencil size={14} />
                      </button>
                      {!template.builtin ? (
                        <button type="button" className="icon-button danger" aria-label={`删除模板 ${template.name}`} onClick={() => removeTemplate(template)}>
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className={`panel ${styles.previewPanel}`}>
        <div className="panel-heading">
          <div>
            <h3>当前布局预览</h3>
            <p>预览用的就是正式看板的渲染器，所见即所得；拖拽卡片换位，悬停出操作角标可换图型（比如从饼状图换成柱状图）、切尺寸、换模板或移除。</p>
          </div>
          <span className="chart-note">{scopeLabel} · {config.onlyConfirmed ? "仅已确认" : "含草稿"}</span>
        </div>
        <MetricCockpitBoard
          compact
          config={config}
          entries={entries}
          categories={categories}
          ctx={ctx}
          templates={templates}
          editor={{
            selectedEntryId,
            draggingEntryId,
            onSelect: setSelectedEntryId,
            onDragStart: setDraggingEntryId,
            onDragEnd: () => setDraggingEntryId(null),
            onDrop: dropOnItem,
            onChartKind: (entryId, kind) => updateItem(entryId, { chartKind: kind }),
            onCycleSize: cycleSize,
            onEditItem: setEditingItemId,
            onRemove: removeItem,
          }}
        />
      </section>

      {confirmPreset ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="cockpit-preset-confirm">
          <section className="confirmation-dialog">
            <span className="confirmation-icon"><RotateCcw size={22} /></span>
            <div>
              <small>重置当前看板</small>
              <h2 id="cockpit-preset-confirm">
                切换到「{COCKPIT_DIMENSION_PRESETS.find((preset) => preset.id === confirmPreset)?.label ?? confirmPreset}」？
              </h2>
              <p>当前看板的卡片组合、图型和排序是手工调整过的。切换维度会把看板重置为该视角的默认指标，手工调整不会保留，也无法撤销。</p>
            </div>
            <footer>
              <button className="secondary-button" onClick={() => setConfirmPreset(null)}>取消</button>
              <button className="primary-button" onClick={() => applyPreset(confirmPreset)}>确认切换并重置</button>
            </footer>
          </section>
        </div>
      ) : null}

      {editingItem ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingItemId(null); }}>
          <div className={`editor-drawer ${styles.smallDrawer}`}>
            <div className="editor-header">
              <div>
                <span className="eyebrow">更换模板</span>
                <h2>{editingEntry?.name ?? editingItem.entryId}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditingItemId(null)} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={template.id === editingItem.templateId ? `${styles.templatePick} ${styles.templatePickActive}` : styles.templatePick}
                  onClick={() => {
                    updateItem(editingItem.entryId, { templateId: template.id });
                    notify(`已改用模板「${template.name}」`);
                    setEditingItemId(null);
                  }}
                >
                  <strong>{template.name}</strong>
                  <span className={styles.kindTag}>{CHART_KIND_LABELS[template.chartKind]}</span>
                  <small>{describeTemplate(ctx, template)}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {templateDraft ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateDraft(null); }}>
          <form className="editor-drawer" onSubmit={saveTemplate}>
            <div className="editor-header">
              <div>
                <span className="eyebrow">模板库</span>
                <h2>{templateDraft.id ? "编辑模板" : "新增模板"}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setTemplateDraft(null)} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              <label className="form-field">
                <span>模板名称</span>
                <input
                  value={templateDraft.name}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })}
                  placeholder="例如：科室收入占比"
                  required
                />
                <small>显示在模板库和卡片编辑里的名字，起一个业务上一眼能懂的。</small>
              </label>
              <div className="form-row two">
                <label className="form-field">
                  <span>图表类型</span>
                  <select
                    value={templateDraft.chartKind}
                    onChange={(event) => setTemplateDraft({ ...templateDraft, chartKind: event.target.value as ChartKind })}
                  >
                    {CHART_KINDS.map((kind) => (
                      <option key={kind} value={kind}>{CHART_KIND_LABELS[kind]}</option>
                    ))}
                  </select>
                  <small>卡片默认用这个图型，上板后还能在预览里快捷切换。</small>
                </label>
                <label className="form-field">
                  <span>单位</span>
                  <input
                    value={templateDraft.unit}
                    onChange={(event) => setTemplateDraft({ ...templateDraft, unit: event.target.value })}
                    placeholder="例如：元、小时、%"
                  />
                  <small>跟着数值一起显示；比率按百分比时一般填「%」。</small>
                </label>
              </div>
              <label className="form-field">
                <span>取值（引用哪一个值）</span>
                <select
                  value={sourceToKey(templateDraft.source)}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, source: keyToSource(event.target.value) })}
                >
                  {sourceOptions}
                </select>
                <small>数据从哪来：18 项填报字段按填报页的分组列出，后面三项是平台算好的派生口径。</small>
              </label>
              <label className="form-field">
                <span>聚合方式</span>
                <select
                  value={templateDraft.aggregation}
                  onChange={(event) => {
                    const aggregation = event.target.value as ChartAggregation;
                    setTemplateDraft({
                      ...templateDraft,
                      aggregation,
                      rate: aggregation === "rate" ? draftRate : undefined,
                    });
                  }}
                >
                  {(Object.keys(AGGREGATION_LABELS) as ChartAggregation[]).map((aggregation) => (
                    <option key={aggregation} value={aggregation}>{AGGREGATION_LABELS[aggregation]}</option>
                  ))}
                </select>
                <small>求和：把范围内所有设备、所有期间的取值加总；比率：分子 ÷ 分母，用来做占比和率。</small>
              </label>
              {templateDraft.aggregation === "rate" ? (
                <div className={styles.rateBox}>
                  <label className="form-field">
                    <span>分子</span>
                    <select
                      value={sourceToKey(draftRate.numerator)}
                      onChange={(event) => setTemplateDraft({ ...templateDraft, rate: { ...draftRate, numerator: keyToSource(event.target.value) } })}
                    >
                      {sourceOptions}
                    </select>
                    <small>被除的那个数，通常和取值一致。</small>
                  </label>
                  <label className="form-field">
                    <span>分母</span>
                    <select
                      value={denominatorToKey(draftRate.denominator)}
                      onChange={(event) => setTemplateDraft({ ...templateDraft, rate: { ...draftRate, denominator: keyToDenominator(event.target.value) } })}
                    >
                      <option value="calendarDays">周期日历天数</option>
                      <option value="usageHours">使用小时数</option>
                      <option value="deviceCount">在用设备台数</option>
                      {ctx.fields.map((field) => (
                        <option key={field.key} value={`field:${field.key}`}>
                          填报字段：{fieldLabelOf(ctx, field.key)}
                        </option>
                      ))}
                    </select>
                    <small>除以什么：按天摊、按小时摊、按台数摊，或除以另一个填报字段。</small>
                  </label>
                  <label className={styles.percentField}>
                    <input
                      type="checkbox"
                      checked={draftRate.percent}
                      onChange={(event) => setTemplateDraft({ ...templateDraft, rate: { ...draftRate, percent: event.target.checked } })}
                    />
                    <span>按百分比显示（× 100）</span>
                  </label>
                </div>
              ) : null}
              <label className="form-field">
                <span>分组维度</span>
                <select
                  value={templateDraft.groupBy}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, groupBy: event.target.value as ChartTemplate["groupBy"] })}
                >
                  {(Object.keys(GROUP_BY_LABELS) as ChartTemplate["groupBy"][]).map((groupBy) => (
                    <option key={groupBy} value={groupBy}>{GROUP_BY_LABELS[groupBy]}</option>
                  ))}
                </select>
                <small>图上的每根柱子 / 每个扇区代表什么：按科室、按设备、按成本构成拆，或按期间看趋势。</small>
              </label>
              <label className="form-field">
                <span>取值说明</span>
                <textarea
                  rows={2}
                  value={templateDraft.description}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, description: event.target.value })}
                  placeholder="给同事看的一句话说明，例如：按科室汇总当期维修费"
                />
                <small>选填；显示在模板库列表里，帮别人判断该不该用这个模板。</small>
              </label>
            </div>
            <div className="editor-footer">
              <button className="secondary-button" type="button" onClick={() => setTemplateDraft(null)}>取消</button>
              <button className="primary-button" type="submit"><Save size={16} />保存模板</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
