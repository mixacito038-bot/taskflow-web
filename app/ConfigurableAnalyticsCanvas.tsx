"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { MetricDefinition, VisualizationDefinition } from "./analytics-semantic-layer";
import styles from "./ConfigurableAnalyticsCanvas.module.css";

export type AnalyticsPoint = { label: string; value: number; secondary?: number; group?: string };
export type ConfigurableAnalyticsCanvasProps = {
  metric: MetricDefinition;
  visualization: VisualizationDefinition;
  data: AnalyticsPoint[];
  metricDefinitionVersion: number;
  visualizationVersion: number;
  height?: number;
};

const chartLabels = { kpi: "KPI", table: "表格", bar: "柱状图", line: "折线图", pie: "饼图", scatter: "散点图", heatmap: "热力图" } as const;
const colors = ["var(--primary)", "var(--green)", "var(--orange)", "var(--violet)", "var(--cyan)", "var(--rose)"];

export default function ConfigurableAnalyticsCanvas({ metric, visualization, data, metricDefinitionVersion, visualizationVersion, height }: ConfigurableAnalyticsCanvasProps) {
  const sorted = useMemo(() => [...data]
    .sort((a, b) => visualization.sort === "asc" ? a.value - b.value : visualization.sort === "desc" ? b.value - a.value : 0)
    .slice(0, visualization.limit ?? data.length), [data, visualization.limit, visualization.sort]);
  const total = sorted.reduce((sum, point) => sum + point.value, 0);

  let content: React.ReactNode;
  if (visualization.chartType === "kpi") {
    content = <div className={styles.kpi}><strong>{total.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}{metric.unit ?? ""}</strong><span>{metric.name}</span></div>;
  } else if (visualization.chartType === "table") {
    content = <div className={styles.tableWrap}><table><thead><tr><th>{visualization.dimension ?? "维度"}</th><th>{metric.name}</th></tr></thead><tbody>{sorted.map((point) => <tr key={`${point.group ?? ""}-${point.label}`}><td>{point.label}</td><td>{point.value.toLocaleString("zh-CN")}{metric.unit ?? ""}</td></tr>)}</tbody></table></div>;
  } else if (visualization.chartType === "pie") {
    content = <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={sorted} dataKey="value" nameKey="label" outerRadius="76%" label>{sorted.map((point, index) => <Cell key={point.label} fill={colors[index % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>;
  } else if (visualization.chartType === "line") {
    content = <ResponsiveContainer width="100%" height="100%"><LineChart data={sorted}><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="label" /><YAxis /><Tooltip /><Line dataKey="value" name={metric.name} stroke="var(--primary)" strokeWidth={2.5} /></LineChart></ResponsiveContainer>;
  } else if (visualization.chartType === "scatter") {
    content = <ResponsiveContainer width="100%" height="100%"><ScatterChart><CartesianGrid stroke="var(--chart-grid)" /><XAxis dataKey="value" name={metric.name} /><YAxis dataKey="secondary" name={visualization.series ?? "对比值"} /><Tooltip cursor={{ strokeDasharray: "3 3" }} /><Scatter data={sorted} fill="var(--primary)" /></ScatterChart></ResponsiveContainer>;
  } else if (visualization.chartType === "heatmap") {
    const maximum = Math.max(...sorted.map((point) => point.value), 1);
    content = <div className={styles.heatmap}>{sorted.map((point) => <div key={point.label} style={{ "--intensity": String(Math.max(.08, point.value / maximum)) } as React.CSSProperties}><strong>{point.value.toLocaleString("zh-CN")}</strong><span>{point.label}</span></div>)}</div>;
  } else {
    content = <ResponsiveContainer width="100%" height="100%"><BarChart data={sorted}><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="value" name={metric.name} fill="var(--primary)" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>;
  }

  return <section className={styles.canvas}>
    <header><div><h3>{visualization.name}</h3><p>{chartLabels[visualization.chartType]} · {metric.name}</p></div><span>指标 v{metricDefinitionVersion} · 展示 v{visualizationVersion}</span></header>
    <div className={`${styles.chart} ${visualization.chartType === "kpi" || visualization.chartType === "table" || visualization.chartType === "heatmap" ? styles.autoHeight : ""}`} style={typeof height === "number" ? { height } : undefined}>{content}</div>
  </section>;
}

