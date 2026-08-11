import { evaluateMetricSet, validateFormulaExpression, type FormulaResult } from "./metric-formula";

export type MetadataStatus = "draft" | "active" | "retired";
export type FieldDataType = "text" | "number" | "date" | "datetime" | "boolean" | "dictionary" | "identifier";
export type Aggregation = "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
export type ChartType = "kpi" | "table" | "bar" | "line" | "pie" | "scatter" | "heatmap";
export type AllocationRule = "primary" | "equal" | "weighted";

export type FieldDefinition = {
  code: string;
  name: string;
  dataType: FieldDataType;
  unit?: string;
  dictionaryCode?: string;
  required?: boolean;
  validation?: { min?: number; max?: number; pattern?: string };
  status: MetadataStatus;
  version?: number;
};

export type MetricDefinition = {
  code: string;
  name: string;
  aggregation: Aggregation;
  /** 单字段聚合的取数字段；派生指标（含 formulaExpr）可不填。 */
  field?: string;
  /** 机器可执行的派生公式，引用其他指标编码，由安全公式引擎计算。 */
  formulaExpr?: string;
  unit?: string;
  allowedDimensions?: string[];
  allocationRule?: AllocationRule;
  status?: MetadataStatus;
  version?: number;
};

export type VisualizationDefinition = {
  code: string;
  name: string;
  metricCode: string;
  chartType: ChartType;
  dimension?: string;
  series?: string;
  sort?: "asc" | "desc";
  limit?: number;
  status: MetadataStatus;
  version: number;
};

export type ExamBodyPart = { code: string; name: string; primary?: boolean; weight?: number };
export type ExamFact = {
  examId: string;
  deviceId: string;
  revenue: number;
  durationMinutes: number;
  bodyParts: ExamBodyPart[];
  [key: string]: unknown;
};

const codePattern = /^[a-z][a-z0-9_]{1,63}$/;

export function validateFieldDefinition(field: FieldDefinition) {
  const errors: string[] = [];
  if (!codePattern.test(field.code)) errors.push("字段编码需为小写英文、数字和下划线");
  if (!field.name.trim()) errors.push("字段名称不能为空");
  if (field.dataType === "dictionary" && field.dictionaryCode !== undefined && !field.dictionaryCode.trim()) errors.push("字典编码不能为空");
  if (field.validation?.min !== undefined && field.validation?.max !== undefined && field.validation.min > field.validation.max) errors.push("最小值不能大于最大值");
  return errors;
}

export function validateMetricDefinition(metric: MetricDefinition) {
  const errors: string[] = [];
  if (!codePattern.test(metric.code)) errors.push("指标编码不合法");
  if (!metric.name.trim()) errors.push("指标名称不能为空");
  if (metric.formulaExpr !== undefined) {
    errors.push(...validateFormulaExpression(metric.formulaExpr));
  } else if (!metric.field?.trim()) {
    errors.push("指标必须引用字段");
  }
  if ((metric.version ?? 1) < 1) errors.push("指标版本必须大于零");
  return errors;
}

export function validateVisualizationDefinition(view: VisualizationDefinition) {
  const errors: string[] = [];
  if (!codePattern.test(view.code)) errors.push("展示编码不合法");
  if (!view.name.trim() || !view.metricCode.trim()) errors.push("展示名称和指标不能为空");
  if (view.limit !== undefined && (view.limit < 1 || view.limit > 500)) errors.push("展示数量必须在 1—500 之间");
  if (view.version < 1) errors.push("展示版本必须大于零");
  return errors;
}

function numberValue(row: ExamFact, field: string) {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function aggregateExamFacts(events: ExamFact[], metric: Pick<MetricDefinition, "aggregation" | "field" | "code">) {
  const field = metric.field ?? "";
  if (metric.aggregation === "count_distinct") {
    return { metricCode: metric.code, value: new Set(events.map((event) => String(event[field] ?? "")).filter(Boolean)).size };
  }
  if (metric.aggregation === "count") return { metricCode: metric.code, value: events.length };
  const values = events.map((event) => numberValue(event, field));
  if (!values.length) return { metricCode: metric.code, value: 0 };
  if (metric.aggregation === "avg") return { metricCode: metric.code, value: values.reduce((sum, value) => sum + value, 0) / values.length };
  if (metric.aggregation === "min") return { metricCode: metric.code, value: Math.min(...values) };
  if (metric.aggregation === "max") return { metricCode: metric.code, value: Math.max(...values) };
  return { metricCode: metric.code, value: values.reduce((sum, value) => sum + value, 0) };
}

/**
 * 计算带 formulaExpr 的派生指标：基础指标取值来自 baseResolve，
 * 派生指标可引用同组指标编码；缺值、除零和循环引用显式失败，绝不补零。
 */
export function evaluateDerivedMetrics(
  metrics: ReadonlyArray<Pick<MetricDefinition, "code" | "formulaExpr">>,
  baseResolve: (code: string) => number | null | undefined,
): Map<string, FormulaResult> {
  return evaluateMetricSet(metrics, baseResolve);
}

export function allocateExamByBodyPart(events: ExamFact[], rule: AllocationRule) {
  return events.flatMap((event) => {
    const parts = event.bodyParts.length ? event.bodyParts : [{ code: "UNSPECIFIED", name: "未标注", primary: true }];
    const primary = parts.find((part) => part.primary) ?? parts[0];
    const weightTotal = parts.reduce((sum, part) => sum + Math.max(0, part.weight ?? 0), 0);
    return parts.map((part) => {
      let share = 0;
      if (rule === "primary") share = part.code === primary.code ? 1 : 0;
      else if (rule === "weighted" && weightTotal > 0) share = Math.max(0, part.weight ?? 0) / weightTotal;
      else share = 1 / parts.length;
      return {
        examId: event.examId,
        deviceId: event.deviceId,
        bodyPartCode: part.code,
        bodyPartName: part.name,
        primary: part.code === primary.code,
        allocatedRevenue: event.revenue * share,
        allocatedDurationMinutes: event.durationMinutes * share,
      };
    });
  });
}

