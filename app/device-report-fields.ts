/**
 * 设备数据填报字段配置（原「成本填报中心」的数据层）。
 *
 * 这一层只管三件事：填什么（字段目录）、按什么周期填（周期模型）、填完能推出什么（派生指标）。
 * 不含任何 React 组件——填报页、驾驶舱、导出都复用同一份口径，口径只能有一处定义，
 * 否则「使用率」在两个页面算出两个数，医院会先怀疑系统再怀疑数据。
 *
 * 值一律按字符串存（DeviceReportRecord.values），和台账自定义字段同一套理由：
 * 要原样回显医院填的内容，数字只在录入时校验格式，不做隐式转换。
 */

import { normalizeFieldKey } from "./device-ledger-fields";

export type ReportFieldGroupId = "usage" | "workload" | "direct" | "space" | "maintenance" | "other";

export type ReportFieldGroup = {
  id: ReportFieldGroupId;
  label: string;
  hint: string;
  order: number;
};

export const REPORT_FIELD_GROUPS: readonly ReportFieldGroup[] = [
  { id: "usage", label: "使用情况", hint: "开机、运行与故障停机时长，用来算使用率和完好率", order: 1 },
  // 业务量三项走数据准备中心的表格上传：这些数来自 HIS/RIS 导出，手工抄容易错且量大。
  { id: "workload", label: "业务量与收入", hint: "由数据准备中心的表格导入，本页只读回显，不手工填", order: 2 },
  { id: "direct", label: "直接成本", hint: "直接消耗在本设备上的支出", order: 3 },
  { id: "space", label: "空间与能耗", hint: "按机房面积或实际用量分摊的水电与房屋成本", order: 4 },
  { id: "maintenance", label: "维护成本", hint: "维修、维保、保养、计量检测等维持性支出", order: 5 },
  { id: "other", label: "其它", hint: "以上口径都装不下的支出", order: 6 },
];

export type ReportFieldType = "integer" | "decimal" | "text";

/** manual = 本页手工填报；import = 数据准备中心表格导入，本页只读回显 */
export type ReportFieldSource = "manual" | "import";

export type ReportFieldDefinition = {
  key: string;
  /** 名称模板，{期} 会按所选周期粒度替换成 日/周/月/季度/当期 */
  labelPattern: string;
  unit: string;
  groupId: ReportFieldGroupId;
  type: ReportFieldType;
  required: boolean;
  source: ReportFieldSource;
  /** 是否计入「设备当期总成本」合计 */
  countsToCost: boolean;
  hint: string;
  order: number;
  /** 出厂 18 项为 true：可改名称/必填/提示，不可删除、不可改 key 和 source */
  builtin: boolean;
};

/**
 * 出厂 18 项。
 *
 * 顺序即 order，key 是填报记录的下标，落库后再改就等于把历史数据丢掉，所以 builtin 项一律不可改键。
 * required 全部为 false：医院不一定每项都有数（比如独立机房才有物业费），
 * 把没有的项设成必填只会逼着填 0，反而污染成本口径。
 */
export const DEFAULT_REPORT_FIELDS: readonly ReportFieldDefinition[] = [
  { key: "usageDays", labelPattern: "{期}使用天数", unit: "天", groupId: "usage", type: "integer", required: false, source: "manual", countsToCost: false, hint: "本期实际开机使用的天数，不含停机日", order: 1, builtin: true },
  { key: "usageHours", labelPattern: "{期}使用时间", unit: "小时", groupId: "usage", type: "decimal", required: false, source: "manual", countsToCost: false, hint: "本期设备实际运行的小时数，可填小数", order: 2, builtin: true },
  { key: "faultHours", labelPattern: "故障时间", unit: "小时", groupId: "usage", type: "decimal", required: false, source: "manual", countsToCost: false, hint: "本期因故障停机的小时数，含等待维修的时间", order: 3, builtin: true },
  { key: "examVolume", labelPattern: "{期}检查人数/项目", unit: "人次", groupId: "workload", type: "integer", required: false, source: "import", countsToCost: false, hint: "由数据准备中心的业务量表导入，本页只读", order: 4, builtin: true },
  { key: "positiveCount", labelPattern: "检阳性数", unit: "例", groupId: "workload", type: "integer", required: false, source: "import", countsToCost: false, hint: "阳性报告例数，随业务量表一同导入", order: 5, builtin: true },
  { key: "totalRevenue", labelPattern: "总收入", unit: "元", groupId: "workload", type: "decimal", required: false, source: "import", countsToCost: false, hint: "本期该设备产生的医疗收入，随业务量表导入", order: 6, builtin: true },
  { key: "consumableCost", labelPattern: "直接耗材支出", unit: "元", groupId: "direct", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "试剂、胶片、导管等直接消耗的支出", order: 7, builtin: true },
  { key: "deviceDepreciation", labelPattern: "设备{期}折旧费", unit: "元", groupId: "direct", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "按设备原值和折旧年限分摊到本期的金额", order: 8, builtin: true },
  { key: "laborCost", labelPattern: "人员成本支出", unit: "元", groupId: "direct", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "操作与诊断人员分摊到本设备的人力成本", order: 9, builtin: true },
  { key: "waterFee", labelPattern: "水费", unit: "元", groupId: "space", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "设备及其机房本期分摊的水费", order: 10, builtin: true },
  { key: "powerFee", labelPattern: "电费", unit: "元", groupId: "space", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "设备及其机房本期分摊的电费", order: 11, builtin: true },
  { key: "buildingDepreciation", labelPattern: "房屋折旧费", unit: "元", groupId: "space", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "按机房占用面积分摊的房屋折旧", order: 12, builtin: true },
  { key: "propertyFee", labelPattern: "物业管理费", unit: "元", groupId: "space", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "按机房占用面积分摊的物业管理费", order: 13, builtin: true },
  { key: "repairFee", labelPattern: "{期}维修费", unit: "元", groupId: "maintenance", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "本期发生的故障维修支出，含配件", order: 14, builtin: true },
  { key: "maintenanceFee", labelPattern: "{期}维保费", unit: "元", groupId: "maintenance", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "本期分摊的维保合同金额", order: 15, builtin: true },
  { key: "upkeepFee", labelPattern: "日常保养（一级）费", unit: "元", groupId: "maintenance", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "一级保养（日常清洁、校准等）的支出", order: 16, builtin: true },
  { key: "meteringFee", labelPattern: "计量检测费", unit: "元", groupId: "maintenance", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "计量所强检、检定、校准的费用", order: 17, builtin: true },
  { key: "otherFee", labelPattern: "其它费用", unit: "元", groupId: "other", type: "decimal", required: false, source: "manual", countsToCost: true, hint: "不属于以上口径的其它支出", order: 18, builtin: true },
];

const FACTORY_FIELD_BY_KEY = new Map(DEFAULT_REPORT_FIELDS.map((field) => [field.key, field]));

/* ------------------------------------------------------------------ 周期模型 */

export type PeriodGranularity = "day" | "week" | "month" | "quarter" | "range";

export const PERIOD_GRANULARITY_LABELS: Record<PeriodGranularity, string> = {
  day: "日",
  week: "周",
  month: "月",
  quarter: "季度",
  range: "自定义区间",
};

/** {期} 占位符的替换值 */
export const PERIOD_FIELD_PREFIX: Record<PeriodGranularity, string> = {
  day: "日",
  week: "周",
  month: "月",
  quarter: "季度",
  range: "当期",
};

export type ReportPeriod = {
  granularity: PeriodGranularity;
  /** 稳定键，填报记录以它为下标 */
  key: string;
  label: string;
  /** YYYY-MM-DD */
  start: string;
  end: string;
  /** 本期日历天数，用于算开机率 */
  days: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTER_LABELS = ["第一季度", "第二季度", "第三季度", "第四季度"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 日期一律走 UTC。
 *
 * 本地时区解析 "2026-07-01" 在东八区是 UTC 前一天 16:00，一旦中途用 getMonth()/getDate()
 * 就可能整体偏一天，月末那天直接掉到下个月——填报周期错一天，全院数据全错。
 */
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function formatIso(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function formatMonthDay(date: Date): string {
  return `${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** 严格解析 YYYY-MM-DD；回写比对可以挡下 2026-02-30 这种「格式对但日子不存在」的输入。 */
function parseIsoDate(text: string): Date | null {
  const value = (text ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = utcDate(year, month - 1, day);
  return formatIso(parsed) === value ? parsed : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** ISO 8601：周一为一周之始，含当年第一个周四的那周为第 1 周（即 1 月 4 日所在周）。 */
function isoWeekStart(year: number, week: number): Date {
  const jan4 = utcDate(year, 0, 4);
  const weekday = jan4.getUTCDay() || 7;
  return new Date(jan4.getTime() - (weekday - 1) * DAY_MS + (week - 1) * 7 * DAY_MS);
}

function isoWeekNumber(date: Date): number {
  const thursday = new Date(date.getTime());
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const yearStart = utcDate(thursday.getUTCFullYear(), 0, 1);
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

/** 12 月 28 日必定落在本年最后一周，用它就能判断这一年是 52 周还是 53 周。 */
function isoWeeksInYear(year: number): number {
  return isoWeekNumber(utcDate(year, 11, 28));
}

export function listPeriods(granularity: PeriodGranularity, year: number, month?: number): ReportPeriod[] {
  if (granularity === "month") {
    return Array.from({ length: 12 }, (_, index) => {
      const start = utcDate(year, index, 1);
      const days = daysInMonth(year, index);
      return {
        granularity,
        key: `${year}-${pad2(index + 1)}`,
        label: `${index + 1}月`,
        start: formatIso(start),
        end: formatIso(utcDate(year, index, days)),
        days,
      };
    });
  }
  if (granularity === "quarter") {
    return Array.from({ length: 4 }, (_, index) => {
      const firstMonth = index * 3;
      const start = utcDate(year, firstMonth, 1);
      const end = utcDate(year, firstMonth + 2, daysInMonth(year, firstMonth + 2));
      return {
        granularity,
        key: `${year}-Q${index + 1}`,
        label: QUARTER_LABELS[index],
        start: formatIso(start),
        end: formatIso(end),
        days: Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1,
      };
    });
  }
  if (granularity === "week") {
    return Array.from({ length: isoWeeksInYear(year) }, (_, index) => {
      const start = isoWeekStart(year, index + 1);
      const end = new Date(start.getTime() + 6 * DAY_MS);
      return {
        granularity,
        key: `${year}-W${pad2(index + 1)}`,
        label: `第${index + 1}周（${formatMonthDay(start)} ~ ${formatMonthDay(end)}）`,
        start: formatIso(start),
        end: formatIso(end),
        days: 7,
      };
    });
  }
  if (granularity === "day") {
    // 日粒度必须指定月份：一年 365 个选项摊在下拉框里没人能选。
    if (!month || month < 1 || month > 12) return [];
    return Array.from({ length: daysInMonth(year, month - 1) }, (_, index) => {
      const date = utcDate(year, month - 1, index + 1);
      return {
        granularity,
        key: formatIso(date),
        label: `${month}月${index + 1}日`,
        start: formatIso(date),
        end: formatIso(date),
        days: 1,
      };
    });
  }
  // 自定义区间由用户自己选起止，没有可枚举的清单。
  return [];
}

export function customRangePeriod(start: string, end: string): ReportPeriod | null {
  const from = parseIsoDate(start);
  const to = parseIsoDate(end);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  return {
    granularity: "range",
    key: `${formatIso(from)}~${formatIso(to)}`,
    label: `${formatMonthDay(from)} ~ ${formatMonthDay(to)}`,
    start: formatIso(from),
    end: formatIso(to),
    // 含首尾：7 月 1 日到 7 月 1 日是 1 天，不是 0 天。
    days: Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1,
  };
}

export function reportFieldLabel(field: ReportFieldDefinition, granularity: PeriodGranularity): string {
  return field.labelPattern.replace(/\{期\}/g, PERIOD_FIELD_PREFIX[granularity]);
}

export function reportFieldFullLabel(field: ReportFieldDefinition, granularity: PeriodGranularity): string {
  const label = reportFieldLabel(field, granularity);
  return field.unit ? `${label}（${field.unit}）` : label;
}

/* ------------------------------------------------------------------ 填报记录 */

export type ReportStatus = "empty" | "draft" | "submitted" | "confirmed" | "returned";

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  empty: "未填报",
  draft: "填报中",
  submitted: "已提交",
  confirmed: "已确认",
  returned: "已退回",
};

export const REPORT_STATUS_TONES: Record<ReportStatus, "neutral" | "warning" | "info" | "success" | "danger"> = {
  empty: "neutral",
  draft: "warning",
  submitted: "info",
  confirmed: "success",
  returned: "danger",
};

export type DeviceReportRecord = {
  deviceId: string;
  periodKey: string;
  values: Record<string, string>;
  status: Exclude<ReportStatus, "empty">;
  updatedAt: string;
  updatedBy: string;
  returnReason?: string;
};

export function findReportRecord(
  records: readonly DeviceReportRecord[],
  deviceId: string,
  periodKey: string,
): DeviceReportRecord | undefined {
  return records.find((record) => record.deviceId === deviceId && record.periodKey === periodKey);
}

/** 没有记录就是「未填报」——empty 是推算出来的状态，不落库，避免为每台设备预生成空记录。 */
export function reportStatusOf(record?: DeviceReportRecord): ReportStatus {
  return record ? record.status : "empty";
}

/** 已确认的数据是效益分析的口径来源，改了会让已发布的报表对不上，所以只能退回后再改。 */
export function canEditReport(status: ReportStatus): boolean {
  return status !== "confirmed";
}

/* ------------------------------------------------------------------ 校验 */

const INTEGER_PATTERN = /^\d+$/;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * 单个值的录入校验。
 *
 * 一律不接受负数：成本、工作量、时长都没有负值，负号只可能是笔误或粘贴带进来的减号，
 * 放行的话总成本会被悄悄冲减，比当场报错难查得多。
 */
export function validateReportValue(field: ReportFieldDefinition, rawValue: string): string {
  // 错误提示固定用月粒度全名：粒度是页面上的临时选择，提示语跟着变会让人以为报错的是另一个字段。
  const label = reportFieldFullLabel(field, "month");
  const value = (rawValue ?? "").trim();
  if (!value) return field.required ? `${label}为必填项` : "";
  if (field.type === "integer" && !INTEGER_PATTERN.test(value)) return `${label}只能填整数`;
  if (field.type === "decimal" && !DECIMAL_PATTERN.test(value)) return `${label}只能填数字`;
  return "";
}

/** 保存前整体校验，按字段顺序返回第一条错误；没有错误返回空字符串。 */
export function validateReportValues(
  fields: readonly ReportFieldDefinition[],
  values: Record<string, string> | undefined,
): string {
  for (const field of [...fields].sort((left, right) => left.order - right.order)) {
    const message = validateReportValue(field, values?.[field.key] ?? "");
    if (message) return message;
  }
  return "";
}

/** 取数值：空、非法、负数一律当「没填」，让派生指标返回 null 而不是拿脏数算出一个数。 */
function readNumber(values: Record<string, string> | undefined, key: string): number | null {
  const value = (values?.[key] ?? "").trim();
  if (!value || !DECIMAL_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 跨字段合理性检查。
 *
 * 只返回警告、不阻断保存：这些都是「看着不对」而不是「一定错」（跨月维修、补录历史数据都可能触发），
 * 拦住保存会逼着科室改数去迎合系统，那才是真的把数据搞脏。
 */
export function reportWarnings(
  fields: readonly ReportFieldDefinition[],
  values: Record<string, string> | undefined,
  period: ReportPeriod,
): string[] {
  const present = new Set(fields.map((field) => field.key));
  const warnings: string[] = [];
  const usageDays = present.has("usageDays") ? readNumber(values, "usageDays") : null;
  const usageHours = present.has("usageHours") ? readNumber(values, "usageHours") : null;
  const faultHours = present.has("faultHours") ? readNumber(values, "faultHours") : null;
  const examVolume = present.has("examVolume") ? readNumber(values, "examVolume") : null;
  const positiveCount = present.has("positiveCount") ? readNumber(values, "positiveCount") : null;
  if (usageDays !== null && usageDays > period.days) warnings.push(`使用天数超过本期日历天数（${period.days} 天）`);
  if (usageHours !== null && usageHours > period.days * 24) warnings.push("使用时间超过本期最大可用小时数");
  if (usageHours !== null && faultHours !== null && faultHours > usageHours) warnings.push("故障时间大于使用时间，请核对");
  if (examVolume !== null && positiveCount !== null && positiveCount > examVolume) warnings.push("检阳性数大于检查人数，请核对");
  return warnings;
}

/* ------------------------------------------------------------------ 派生指标 */

export type DerivedMetric = {
  key: string;
  label: string;
  unit: string;
  value: number | null;
  formula: string;
  hint: string;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 分母为 0 或缺项一律返回 null：界面显示「—」，绝不用 0 冒充「没数据」。 */
function ratio(numerator: number | null, denominator: number | null, scale = 1): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return round2((numerator / denominator) * scale);
}

/** 合计计入成本的项；一项都没填时返回 null，避免「还没填」被显示成「成本 0 元」。 */
export function reportTotalCost(
  fields: readonly ReportFieldDefinition[],
  values: Record<string, string> | undefined,
): number | null {
  let sum = 0;
  let filled = false;
  for (const field of fields) {
    if (!field.countsToCost) continue;
    const value = readNumber(values, field.key);
    if (value === null) continue;
    sum += value;
    filled = true;
  }
  return filled ? round2(sum) : null;
}

export function derivedMetrics(
  fields: readonly ReportFieldDefinition[],
  values: Record<string, string> | undefined,
  period: ReportPeriod,
  granularity: PeriodGranularity,
): DerivedMetric[] {
  // 口径提示里用字段的当前名称：医院改过名之后，公式说明还写出厂名会让人对不上账。
  const nameOf = (key: string): string => {
    const field = fields.find((item) => item.key === key) ?? FACTORY_FIELD_BY_KEY.get(key);
    return field ? reportFieldLabel(field, granularity) : key;
  };
  const totalCost = reportTotalCost(fields, values);
  const usageDays = readNumber(values, "usageDays");
  const usageHours = readNumber(values, "usageHours");
  const faultHours = readNumber(values, "faultHours");
  const examVolume = readNumber(values, "examVolume");
  const positiveCount = readNumber(values, "positiveCount");
  const totalRevenue = readNumber(values, "totalRevenue");
  const uptimeHours = usageHours === null || faultHours === null ? null : usageHours - faultHours;
  return [
    {
      key: "totalCost",
      label: "当期总成本",
      unit: "元",
      value: totalCost,
      formula: "所有计入成本的填报项之和",
      hint: "口径以字段的「计入成本」标记为准，业务量与收入不计入",
    },
    {
      key: "utilizationRate",
      label: "设备使用率",
      unit: "%",
      value: ratio(usageDays, period.days, 100),
      formula: `${nameOf("usageDays")} ÷ 本期日历天数（${period.days} 天）× 100`,
      hint: "反映设备闲置程度，低于阈值应考虑调配",
    },
    {
      key: "integrityRate",
      label: "设备完好率",
      unit: "%",
      value: ratio(uptimeHours, usageHours, 100),
      formula: `（${nameOf("usageHours")} − ${nameOf("faultHours")}）÷ ${nameOf("usageHours")} × 100`,
      hint: "故障停机占比越低越好，可用于维保考核",
    },
    {
      key: "costPerExam",
      label: "单次检查成本",
      unit: "元",
      value: ratio(totalCost, examVolume),
      formula: `当期总成本 ÷ ${nameOf("examVolume")}`,
      hint: "与同类设备横比，判断成本是否偏高",
    },
    {
      key: "revenuePerExam",
      label: "单次检查收入",
      unit: "元",
      value: ratio(totalRevenue, examVolume),
      formula: `${nameOf("totalRevenue")} ÷ ${nameOf("examVolume")}`,
      hint: "结合项目结构看，与物价调整直接相关",
    },
    {
      key: "positiveRate",
      label: "检查阳性率",
      unit: "%",
      value: ratio(positiveCount, examVolume, 100),
      formula: `${nameOf("positiveCount")} ÷ ${nameOf("examVolume")} × 100`,
      hint: "过低提示检查适应证把关偏松",
    },
    {
      key: "grossMargin",
      label: "当期结余",
      unit: "元",
      value: totalRevenue === null || totalCost === null ? null : round2(totalRevenue - totalCost),
      formula: `${nameOf("totalRevenue")} − 当期总成本`,
      hint: "为负说明本期投入未被收入覆盖",
    },
    {
      key: "costBenefitRatio",
      label: "成本收益率",
      unit: "%",
      value: ratio(totalRevenue, totalCost, 100),
      formula: `${nameOf("totalRevenue")} ÷ 当期总成本 × 100`,
      hint: "高于 100% 表示本期收入覆盖了成本",
    },
  ];
}

export function completionStat(
  deviceIds: readonly string[],
  records: readonly DeviceReportRecord[],
  periodKey: string,
): { total: number; filled: number; confirmed: number; rate: number } {
  const total = deviceIds.length;
  let filled = 0;
  let confirmed = 0;
  for (const deviceId of deviceIds) {
    const record = findReportRecord(records, deviceId, periodKey);
    if (!record) continue;
    // 已退回的不算「已填」：科室还得重填，算进去会让完成率虚高。
    if (record.status !== "returned") filled += 1;
    if (record.status === "confirmed") confirmed += 1;
  }
  // 没有设备时返回 0 而不是 NaN：NaN 会一路渗到界面上显示「NaN%」。
  return { total, filled, confirmed, rate: total ? filled / total : 0 };
}

/* ------------------------------------------------------------------ 自定义字段 */

/**
 * 合并医院自定义字段。
 *
 * 同 key 视为「对出厂项的改写」，只接受名称/单位/必填/提示/顺序这几项：
 * 放开 source 就能把导入字段改成手工填（业务量会被人工数覆盖），
 * 放开 countsToCost 就能把使用天数算进成本合计——这两条都会静默污染全院口径。
 */
export function mergeReportFields(custom: readonly ReportFieldDefinition[]): ReportFieldDefinition[] {
  const merged = new Map<string, ReportFieldDefinition>(DEFAULT_REPORT_FIELDS.map((field) => [field.key, { ...field }]));
  for (const draft of custom) {
    const factory = FACTORY_FIELD_BY_KEY.get(draft.key);
    if (factory) {
      merged.set(draft.key, {
        ...factory,
        labelPattern: draft.labelPattern || factory.labelPattern,
        unit: draft.unit,
        required: draft.required,
        hint: draft.hint,
        order: draft.order,
      });
      continue;
    }
    // 医院自建字段一律 builtin: false，否则它会伪装成不可删的出厂项。
    merged.set(draft.key, { ...draft, builtin: false });
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.order - right.order ||
      Number(right.builtin) - Number(left.builtin) ||
      left.labelPattern.localeCompare(right.labelPattern, "zh-CN"),
  );
}

/** 空组也保留，前端自己决定是否隐藏——分组是填报页的骨架，少一块比空一块更难解释。 */
export function reportFieldsByGroup(
  fields: readonly ReportFieldDefinition[],
): { group: ReportFieldGroup; fields: ReportFieldDefinition[] }[] {
  return REPORT_FIELD_GROUPS.map((group) => ({
    group,
    fields: fields.filter((field) => field.groupId === group.id).sort((left, right) => left.order - right.order),
  }));
}

/** 出厂键和记录自身的结构字段都不能被自定义字段占用，否则会和系统项串位。 */
const RESERVED_REPORT_KEYS = new Set<string>([
  ...DEFAULT_REPORT_FIELDS.map((field) => field.key),
  "deviceId",
  "periodKey",
  "status",
]);

export type ReportFieldError = "label_required" | "key_required" | "key_reserved" | "key_duplicated";

export const REPORT_FIELD_ERROR_MESSAGES: Record<ReportFieldError, string> = {
  label_required: "请填写字段名称",
  key_required: "字段标识只能用字母、数字和下划线，请重新填写",
  key_reserved: "该标识与系统内置填报项冲突，请换一个",
  key_duplicated: "已存在同名标识的字段",
};

export function validateReportFieldDefinition(
  draft: ReportFieldDefinition,
  existing: readonly ReportFieldDefinition[],
  editingKey?: string,
): ReportFieldError | null {
  if (!draft.labelPattern.trim()) return "label_required";
  if (!draft.key.trim()) return "key_required";
  // 先判保留键：出厂键是 camelCase，先过规范化检查的话会报成「标识格式不对」，指向错误的原因。
  if (RESERVED_REPORT_KEYS.has(draft.key)) return "key_reserved";
  if (normalizeFieldKey(draft.key) !== draft.key) return "key_required";
  if (existing.some((field) => field.key === draft.key && field.key !== editingKey)) return "key_duplicated";
  return null;
}

/* ------------------------------------------------------------------ 旧成本记录迁移 */

/**
 * 旧「成本填报中心」记录的最小形态。
 *
 * 不直接引用 mock-data 的 CostEntry：数据层不该反向依赖演示数据模块，
 * 这里只声明迁移真正用到的字段，多出来的字段（detail、createdAt）结构兼容即可传入。
 */
export type CostEntryLike = { id: string; type: "人工" | "耗材"; deviceId: string; deviceName: string; item: string; period: string; amount: number; owner: string };

export type CostMigrationRow = { entryId: string; deviceId: string; deviceName: string; period: string; type: string; item: string; amountWan: number; amountYuan: number; targetField: string; action: "merged" | "skipped_confirmed" | "skipped_no_device" };

/** 旧口径只有人工、耗材两类，分别对应新口径的人员成本与直接耗材两个出厂字段。 */
const COST_MIGRATION_TARGETS: Record<CostEntryLike["type"], string> = { 人工: "laborCost", 耗材: "consumableCost" };

/**
 * 旧记录按「万元」记账、新口径按「元」填报，换算要 ×10000。
 * 先放大到「分」再取整：0.07 × 10000 × 100 在浮点里是 70000.00000000001，
 * 不取整的话对照表和填报值都会带一条小数尾巴，医院对账时会当成算错了钱。
 */
function wanToYuan(amountWan: number): number {
  return Math.round(amountWan * 10000 * 100) / 100;
}

/**
 * 把旧成本填报记录归并进新填报口径。
 *
 * 规则：
 * - 人工 → laborCost，耗材 → consumableCost；同一 deviceId+period 的多条同类记录累加成一笔；
 * - 并入已有记录时只填「原值为空」的字段——医院已手工填的数以人工口径为准，迁移绝不覆盖，
 *   这类笔在对照表里仍标 merged（它的归宿字段就是 targetField，只是金额以人工值优先）；
 * - 目标记录已确认（confirmed）的整台跳过：已确认数据是效益分析的口径来源，迁移不能绕过退回流程去改它；
 * - deviceId 不在台账全集里的跳过：没有台账主档的数并进来也无处展示，只会变成孤儿记录；
 * - 新建的记录一律 status="draft"，让科室过目后自己走提交流程，而不是替他们直接提交。
 *
 * mapping 一条不漏地记录每笔旧记录的去向，供导出对照表备查。
 */
export function migrateCostEntries(
  entries: readonly CostEntryLike[],
  existing: readonly DeviceReportRecord[],
  knownDeviceIds: ReadonlySet<string>,
  operator: string,
  nowIso: string,
): { records: DeviceReportRecord[]; mapping: CostMigrationRow[] } {
  const mapping: CostMigrationRow[] = [];
  // 累加桶：`deviceId\u0000period` → 目标字段 → 元金额合计。\u0000 不会出现在业务 id 里，拼键不会撞。
  const buckets = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const targetField = COST_MIGRATION_TARGETS[entry.type];
    const base = {
      entryId: entry.id,
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      period: entry.period,
      type: entry.type,
      item: entry.item,
      amountWan: entry.amount,
      amountYuan: wanToYuan(entry.amount),
      targetField,
    };
    if (!knownDeviceIds.has(entry.deviceId)) {
      mapping.push({ ...base, action: "skipped_no_device" });
      continue;
    }
    const record = findReportRecord(existing, entry.deviceId, entry.period);
    if (record && record.status === "confirmed") {
      mapping.push({ ...base, action: "skipped_confirmed" });
      continue;
    }
    const bucketKey = `${entry.deviceId}\u0000${entry.period}`;
    const bucket = buckets.get(bucketKey) ?? new Map<string, number>();
    bucket.set(targetField, (bucket.get(targetField) ?? 0) + base.amountYuan);
    buckets.set(bucketKey, bucket);
    mapping.push({ ...base, action: "merged" });
  }
  // 逐条浅拷贝 values：迁移是纯函数，绝不能改到调用方手里的原记录，否则 React 状态对比会失灵。
  const records: DeviceReportRecord[] = existing.map((record) => ({ ...record, values: { ...record.values } }));
  for (const [bucketKey, bucket] of buckets) {
    const [deviceId, period] = bucketKey.split("\u0000");
    let record = records.find((item) => item.deviceId === deviceId && item.periodKey === period);
    if (!record) {
      record = { deviceId, periodKey: period, values: {}, status: "draft", updatedAt: nowIso, updatedBy: operator };
      records.push(record);
    }
    let touched = false;
    for (const [field, sum] of bucket) {
      if ((record.values[field] ?? "").trim()) continue;
      // 累加后再取整一次：多笔 0.01 元级的尾差不该逐笔累积进填报值
      record.values[field] = String(Math.round(sum * 100) / 100);
      touched = true;
    }
    // 一个字都没写进去（目标字段全被手工值占着）就不动时间戳，免得看起来像被人改过
    if (touched) {
      record.updatedAt = nowIso;
      record.updatedBy = operator;
    }
  }
  return { records, mapping };
}
