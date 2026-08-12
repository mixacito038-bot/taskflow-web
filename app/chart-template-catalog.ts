/**
 * 图表模板库（驾驶舱「指标 → 图表」的数据层）。
 *
 * 这一层只管四件事：图表模板长什么样（模板目录）、指标怎么落到填报口径上（值绑定）、
 * 给定范围怎么把数算出来（computeChartSeries）、云端读回的看板配置怎么收拾（normalize）。
 * 不含任何 React——配置页预览、正式驾驶舱、导出报表都调这一个函数，
 * 口径只能有一处定义，否则「使用率」在预览和正式页会算出两个数。
 *
 * 本模块刻意不做任何运行时 import（只 import type）：它是纯计算层，
 * 服务端汇总、导出脚本和测试都直接引用，挂上依赖链只会把别人的模块问题带进来。
 *
 * 全篇最关键的两条口径：
 * 1. 汇总就是「下面所有设备相加」——科室维度也好、时间维度也好，都是把范围内的
 *    「设备 × 期间」格子摊平了加，不是先按设备算再平均。
 * 2. 比率一律「先分别求和再相除」，绝不对各设备/各期的比率取平均（见 computeChartSeries）。
 */

import type { DeviceReportRecord, PeriodGranularity, ReportFieldDefinition, ReportPeriod } from "./device-report-fields";

/* ------------------------------------------------------------------ 图型 */

export type ChartKind = "stat" | "bar" | "line" | "pie" | "table";

/**
 * 图型名称。
 *
 * 消费方拿首字当图型切换按钮的图标（CHART_KIND_LABELS[kind].charAt(0)），
 * 所以五个标签的首字必须互不相同——数/柱/折/饼/明。改名前先确认首字没撞，
 * 撞了的话按钮上会出现两个一模一样的字，谁也分不清点的是哪个。
 */
export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  stat: "数值卡",
  bar: "柱状图",
  line: "折线图",
  pie: "饼图",
  table: "明细表",
};

/* ------------------------------------------------------------------ 模板 */

export type ChartValueSource =
  | { kind: "reportField"; fieldKey: string }
  | { kind: "totalCost" }
  | { kind: "margin" }
  | { kind: "costBreakdown" };

export type ChartAggregation = "sum" | "rate";

export type RateSpec = {
  numerator: ChartValueSource;
  denominator: "calendarDays" | "usageHours" | "deviceCount" | { fieldKey: string };
  percent: boolean;
};

export type ChartTemplate = {
  id: string;
  name: string;
  description: string;
  chartKind: ChartKind;
  source: ChartValueSource;
  aggregation: ChartAggregation;
  rate?: RateSpec;
  unit: string;
  groupBy: "department" | "device" | "costField" | "period";
  builtin: boolean;
};

/* ------------------------------------------------------------------ 计算上下文 */

export type CockpitScope =
  | { level: "hospital" }
  | { level: "department"; department: string }
  | { level: "device"; deviceId: string };

export type ChartDeviceContext = { id: string; department: string; name: string };

export type ChartComputeContext = {
  devices: readonly ChartDeviceContext[];
  records: readonly DeviceReportRecord[];
  onlyConfirmed: boolean;
  periods: readonly ReportPeriod[];
  fields: readonly ReportFieldDefinition[];
  /** 业务量三项的唯一来源（数据准备中心导入）；查不到返回 undefined，绝不编 0 */
  workloadOf: (deviceId: string, periodKey: string) => { examVolume?: string; positiveCount?: string; totalRevenue?: string } | undefined;
};

export type ChartPoint = { label: string; value: number | null };

export type ChartSeries = { points: ChartPoint[]; total: number | null; unavailable: boolean; unavailableReason?: string };

/* ------------------------------------------------------------------ 取数 */

/**
 * 业务量三项由数据准备中心的表格导入，只认 workloadOf 的返回值。
 * record.values 里若混进同名的键（历史脏数据、手工改过的草稿）一律忽略：
 * 同一个数有两个来源，报表被质询时说不清以哪个为准。
 */
const IMPORTED_FIELD_KEYS = new Set(["examVolume", "positiveCount", "totalRevenue"]);

/** 只接受纯数字串；空、非数字一律 null，让缺数显示成「—」而不是 0 */
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

function parseValue(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!NUMBER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * {期} 占位符的替换值，与 device-report-fields 的 PERIOD_FIELD_PREFIX 一致。
 * 这里重写一份而不是 import：本模块要保持零运行时依赖，而粒度就固定这五种、不随医院配置变化，
 * 重复一张常量表的风险远小于把整个填报模块挂进依赖链。
 */
const PERIOD_PREFIX: Record<PeriodGranularity, string> = {
  day: "日",
  week: "周",
  month: "月",
  quarter: "季度",
  range: "当期",
};

/** 台账里没填使用科室的设备也要出现在分组里，否则它的成本会凭空消失 */
const UNASSIGNED_DEPARTMENT = "未分配科室";

function departmentOf(device: ChartDeviceContext): string {
  return (device.department ?? "").trim() || UNASSIGNED_DEPARTMENT;
}

function fieldLabelOf(ctx: ChartComputeContext, fieldKey: string): string {
  const field = ctx.fields.find((item) => item.key === fieldKey);
  if (!field) return fieldKey;
  const granularity = ctx.periods.length ? ctx.periods[0].granularity : "month";
  return field.labelPattern.replace(/\{期\}/g, PERIOD_PREFIX[granularity]);
}

function sourceLabelOf(ctx: ChartComputeContext, source: ChartValueSource): string {
  if (source.kind === "reportField") return `「${fieldLabelOf(ctx, source.fieldKey)}」`;
  if (source.kind === "totalCost") return "当期总成本";
  if (source.kind === "margin") return "结余（总收入 − 总成本）";
  return "成本构成";
}

function denominatorLabelOf(ctx: ChartComputeContext, denominator: RateSpec["denominator"]): string {
  if (denominator === "calendarDays") return "周期日历天数";
  if (denominator === "deviceCount") return "在用设备台数";
  if (denominator === "usageHours") return `「${fieldLabelOf(ctx, "usageHours")}」`;
  return `「${fieldLabelOf(ctx, denominator.fieldKey)}」`;
}

/** 一个「设备 × 期间」的格子；有记录才成格，汇总永远是格子的相加 */
type Cell = { device: ChartDeviceContext; period: ReportPeriod; record: DeviceReportRecord };

function scopeDevices(scope: CockpitScope, devices: readonly ChartDeviceContext[]): ChartDeviceContext[] {
  if (scope.level === "department") return devices.filter((device) => departmentOf(device) === scope.department.trim());
  if (scope.level === "device") return devices.filter((device) => device.id === scope.deviceId);
  return [...devices];
}

/**
 * 摊平成格子。
 *
 * 「该设备该期有没有符合口径的填报记录」是唯一的入场券，原因见 readSource：
 * 收入走导入表、成本走填报记录，如果把没填报的设备也算进来，它的收入会进合计、成本却是空的，
 * 结余就凭空多出一块——这种假结余比没有数还危险。
 * 已退回（returned）的记录任何口径下都不算：科室还得重填，算进去等于拿一份被打回的数汇报。
 */
function collectCells(devices: readonly ChartDeviceContext[], ctx: ChartComputeContext): Cell[] {
  const cells: Cell[] = [];
  for (const device of devices) {
    for (const period of ctx.periods) {
      const record = ctx.records.find((item) => item.deviceId === device.id && item.periodKey === period.key);
      if (!record || record.status === "returned") continue;
      if (ctx.onlyConfirmed && record.status !== "confirmed") continue;
      cells.push({ device, period, record });
    }
  }
  return cells;
}

function readField(ctx: ChartComputeContext, cell: Cell, fieldKey: string): number | null {
  if (IMPORTED_FIELD_KEYS.has(fieldKey)) {
    const workload = ctx.workloadOf(cell.device.id, cell.period.key);
    if (!workload) return null;
    if (fieldKey === "examVolume") return parseValue(workload.examVolume);
    if (fieldKey === "positiveCount") return parseValue(workload.positiveCount);
    return parseValue(workload.totalRevenue);
  }
  return parseValue(cell.record.values?.[fieldKey]);
}

/** 计入成本的填报项合计；一项都没填返回 null，避免「还没填」被显示成「成本 0 元」 */
function readTotalCost(ctx: ChartComputeContext, cell: Cell): number | null {
  let sum = 0;
  let filled = false;
  for (const field of ctx.fields) {
    if (!field.countsToCost) continue;
    const value = readField(ctx, cell, field.key);
    if (value === null) continue;
    sum += value;
    filled = true;
  }
  return filled ? sum : null;
}

function readSource(ctx: ChartComputeContext, cell: Cell, source: ChartValueSource): number | null {
  if (source.kind === "reportField") return readField(ctx, cell, source.fieldKey);
  if (source.kind === "margin") {
    const revenue = readField(ctx, cell, "totalRevenue");
    const cost = readTotalCost(ctx, cell);
    // 单边有数不算结余：只有收入没有成本的「结余」等于收入，会被当成真结余拿去汇报
    return revenue === null || cost === null ? null : revenue - cost;
  }
  // totalCost 和 costBreakdown 的合计是同一个口径，区别只在分组时拆不拆开
  return readTotalCost(ctx, cell);
}

/** 求和：全缺返回 null（不是 0），部分缺就把有数的加起来 */
function sumOver(ctx: ChartComputeContext, cells: readonly Cell[], source: ChartValueSource): number | null {
  let sum = 0;
  let filled = false;
  for (const cell of cells) {
    const value = readSource(ctx, cell, source);
    if (value === null) continue;
    sum += value;
    filled = true;
  }
  return filled ? sum : null;
}

/**
 * 比率的分母，口径按格子算：
 * - calendarDays：Σ(每个格子的 period.days)，一台设备跨两个月就是两个月天数之和；
 * - deviceCount：参与统计的设备台数（同一台设备跨多期只算一台）；
 * - 其余：对应填报字段在范围内的合计。
 */
function denominatorOf(ctx: ChartComputeContext, cells: readonly Cell[], denominator: RateSpec["denominator"]): number | null {
  if (denominator === "calendarDays") {
    if (!cells.length) return null;
    let sum = 0;
    for (const cell of cells) sum += cell.period.days;
    return sum;
  }
  if (denominator === "deviceCount") {
    const ids = new Set(cells.map((cell) => cell.device.id));
    return ids.size ? ids.size : null;
  }
  const fieldKey = denominator === "usageHours" ? "usageHours" : denominator.fieldKey;
  return sumOver(ctx, cells, { kind: "reportField", fieldKey });
}

/** 分母缺失或为 0 一律 null：Infinity / NaN 会一路渗到界面上，显示成「∞%」比空着难解释得多 */
function ratioOf(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 金额判定不看模板的 unit：computeChartSeries 只拿到 Pick<ChartTemplate, ...>，里面没有 unit。
 * 直接从填报字段定义里读单位（模板的 unit 本来也是照着它填的），派生口径三项天然是钱。
 */
function isMoneySource(ctx: ChartComputeContext, source: ChartValueSource): boolean {
  if (source.kind !== "reportField") return true;
  return (ctx.fields.find((field) => field.key === source.fieldKey)?.unit ?? "") === "元";
}

/** 百分比一位小数、金额取整、其余一位小数——驾驶舱是给人看的，小数尾巴只会让人以为算错了 */
function finalize(value: number, percent: boolean, money: boolean): number {
  if (percent) return roundTo(value * 100, 1);
  return money ? roundTo(value, 0) : roundTo(value, 1);
}

/* ------------------------------------------------------------------ 分组与计算 */

/** source 有值表示这一组要换个取值算（成本构成拆分时每组是一个成本字段） */
type Group = { label: string; cells: Cell[]; source?: ChartValueSource };

function buildGroups(
  groupBy: ChartTemplate["groupBy"],
  source: ChartValueSource,
  ctx: ChartComputeContext,
  devices: readonly ChartDeviceContext[],
  cells: readonly Cell[],
): Group[] {
  if (groupBy === "device") {
    // 没数的设备也留一个空点：它在图上是一条缺口，而不是从名单里消失
    return devices.map((device) => ({
      label: device.name || device.id,
      cells: cells.filter((cell) => cell.device.id === device.id),
    }));
  }
  if (groupBy === "period") {
    return ctx.periods.map((period) => ({
      label: period.label,
      cells: cells.filter((cell) => cell.period.key === period.key),
    }));
  }
  if (groupBy === "costField") {
    // 只有成本口径拆得出成本构成；收入、人次这类取值拆不出来，退回单点合计而不是硬套成本字段
    if (source.kind !== "totalCost" && source.kind !== "costBreakdown") {
      return [{ label: "合计", cells: [...cells] }];
    }
    return ctx.fields
      .filter((field) => field.countsToCost)
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((field) => ({
        label: fieldLabelOf(ctx, field.key),
        cells: [...cells],
        source: { kind: "reportField", fieldKey: field.key } as ChartValueSource,
      }));
  }
  const departments: string[] = [];
  for (const device of devices) {
    const department = departmentOf(device);
    if (!departments.includes(department)) departments.push(department);
  }
  return departments.map((department) => ({
    label: department,
    cells: cells.filter((cell) => departmentOf(cell.device) === department),
  }));
}

function unavailableReasonOf(
  template: Pick<ChartTemplate, "source" | "aggregation" | "rate">,
  scope: CockpitScope,
  ctx: ChartComputeContext,
  devices: readonly ChartDeviceContext[],
  cells: readonly Cell[],
): string {
  if (!devices.length) {
    if (scope.level === "department") return `「${scope.department}」名下没有设备`;
    if (scope.level === "device") return "设备不在统计范围内";
    return "台账里还没有设备";
  }
  if (!ctx.periods.length) return "还没有选定统计期间";
  if (!cells.length) {
    return ctx.onlyConfirmed
      ? "本期没有已确认的填报记录"
      : "本期还没有填报记录";
  }
  if (template.aggregation === "rate" && template.rate) {
    const denominator = denominatorOf(ctx, cells, template.rate.denominator);
    if (denominator === null || denominator === 0) {
      return `分母（${denominatorLabelOf(ctx, template.rate.denominator)}）合计为 0`;
    }
    return `${sourceLabelOf(ctx, template.rate.numerator)}尚未填报`;
  }
  return `${sourceLabelOf(ctx, template.source)}尚未填报`;
}

/**
 * 按模板 + 范围算出一条图表数据。
 *
 * 汇总规则（医院原话：「选某些科室或某些维度的数据，其实是下面所有设备的相加，
 * 不管是科室相加还是时间维度相加」）：
 * 1. 先按 scope 圈设备（全院 / 某科室 / 单台）；
 * 2. 圈出的设备 × 选中的期间摊平成格子，只有存在符合口径记录的格子才参与；
 * 3. sum：每组把格子里的取值相加，total 是全范围合计（与分组方式无关）；
 * 4. rate：先把范围内的分子、分母各自求和再相除——每个分组也各自重算，
 *    绝不能对各设备/各期的比率取平均，那会让 15/30 天和 30/31 天的两台设备算出 73.4% 而不是 73.8%。
 */
export function computeChartSeries(
  template: Pick<ChartTemplate, "chartKind" | "source" | "aggregation" | "rate" | "groupBy">,
  scope: CockpitScope,
  ctx: ChartComputeContext,
): ChartSeries {
  const devices = scopeDevices(scope, ctx.devices);
  const cells = collectCells(devices, ctx);
  const isRate = template.aggregation === "rate" && Boolean(template.rate);
  const rate = template.rate;
  const percent = isRate && rate ? rate.percent : false;
  const money = isMoneySource(ctx, isRate && rate ? rate.numerator : template.source);
  const groups = buildGroups(template.groupBy, template.source, ctx, devices, cells);

  const valueOf = (groupCells: readonly Cell[], override?: ChartValueSource): number | null => {
    if (isRate && rate) {
      const numerator = sumOver(ctx, groupCells, override ?? rate.numerator);
      const raw = ratioOf(numerator, denominatorOf(ctx, groupCells, rate.denominator));
      return raw === null ? null : finalize(raw, percent, money);
    }
    const raw = sumOver(ctx, groupCells, override ?? template.source);
    return raw === null ? null : finalize(raw, percent, money);
  };

  const points: ChartPoint[] = groups.map((group) => ({ label: group.label, value: valueOf(group.cells, group.source) }));
  // total 一律用全范围重算，不是把各点相加：比率各点相加没有意义，金额各点已经取过整
  const total = valueOf(cells);
  if (total === null) {
    return {
      points,
      total: null,
      unavailable: true,
      unavailableReason: unavailableReasonOf(template, scope, ctx, devices, cells),
    };
  }
  return { points, total, unavailable: false };
}

/* ------------------------------------------------------------------ 出厂模板 */

/**
 * 出厂模板库。
 *
 * 顺序有讲究：消费方按「取值 + 聚合完全一致」找模板，找不到再退到「取值一致」，
 * 命中的是数组里的第一条。所以每个取值的「主用」模板（数值卡）排在前面，
 * 同取值的柱/折/饼/表放后面，免得指标卡片默认套上一个按科室拆的模板。
 */
export const DEFAULT_CHART_TEMPLATES: readonly ChartTemplate[] = [
  {
    id: "builtin-revenue-total",
    name: "总收入·数值卡",
    description: "范围内所有设备、所有期间的导入总收入合计",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "totalRevenue" },
    aggregation: "sum",
    unit: "元",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-cost-total",
    name: "总成本·数值卡",
    description: "计入成本的填报项合计，按设备和期间相加",
    chartKind: "stat",
    source: { kind: "totalCost" },
    aggregation: "sum",
    unit: "元",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-margin-total",
    name: "总结余·数值卡",
    description: "总收入 − 总成本；单边缺数的设备期不计入",
    chartKind: "stat",
    source: { kind: "margin" },
    aggregation: "sum",
    unit: "元",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-exam-total",
    name: "总检查人次·数值卡",
    description: "数据准备中心导入的检查人次合计",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "examVolume" },
    aggregation: "sum",
    unit: "人次",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-uptime-total",
    name: "开机总时长·数值卡",
    description: "填报「使用时间」在范围内的合计",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "usageHours" },
    aggregation: "sum",
    unit: "小时",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-fault-total",
    name: "故障停机时长·数值卡",
    description: "填报「故障时间」在范围内的合计",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "faultHours" },
    aggregation: "sum",
    unit: "小时",
    groupBy: "device",
    builtin: true,
  },
  {
    id: "builtin-utilization-rate",
    name: "设备使用率·数值卡",
    description: "使用天数合计 ÷ 日历天数合计 × 100，先合计再相除",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "usageDays" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "usageDays" }, denominator: "calendarDays", percent: true },
    unit: "%",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-positive-rate",
    name: "检查阳性率·数值卡",
    description: "检阳性数合计 ÷ 检查人次合计 × 100",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "positiveCount" },
    aggregation: "rate",
    rate: {
      numerator: { kind: "reportField", fieldKey: "positiveCount" },
      denominator: { fieldKey: "examVolume" },
      percent: true,
    },
    unit: "%",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-exam-per-device",
    name: "台均服务人次·数值卡",
    description: "检查人次合计 ÷ 参与统计的设备台数",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "examVolume" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "examVolume" }, denominator: "deviceCount", percent: false },
    unit: "人次",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-daily-uptime",
    name: "日均开机时长·数值卡",
    description: "使用时间合计 ÷ 日历天数合计",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "usageHours" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "usageHours" }, denominator: "calendarDays", percent: false },
    unit: "小时",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-repair-cost-rate",
    name: "维修费用率·数值卡",
    description: "维修费合计 ÷ 总收入合计 × 100（分母取收入口径，设备原值不在填报范围内）",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "repairFee" },
    aggregation: "rate",
    rate: {
      numerator: { kind: "reportField", fieldKey: "repairFee" },
      denominator: { fieldKey: "totalRevenue" },
      percent: true,
    },
    unit: "%",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-downtime-rate",
    name: "停机率·数值卡",
    description: "故障时间合计 ÷ 使用时间合计 × 100",
    chartKind: "stat",
    source: { kind: "reportField", fieldKey: "faultHours" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "faultHours" }, denominator: "usageHours", percent: true },
    unit: "%",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-cost-by-department",
    name: "科室成本对比·柱状图",
    description: "各科室名下设备的总成本，横向比较",
    chartKind: "bar",
    source: { kind: "totalCost" },
    aggregation: "sum",
    unit: "元",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-exam-by-department",
    name: "科室工作量·柱状图",
    description: "各科室名下设备的检查人次合计",
    chartKind: "bar",
    source: { kind: "reportField", fieldKey: "examVolume" },
    aggregation: "sum",
    unit: "人次",
    groupBy: "department",
    builtin: true,
  },
  {
    id: "builtin-revenue-trend",
    name: "月度收入趋势·折线图",
    description: "逐期的总收入，缺数的期间断线不连假趋势",
    chartKind: "line",
    source: { kind: "reportField", fieldKey: "totalRevenue" },
    aggregation: "sum",
    unit: "元",
    groupBy: "period",
    builtin: true,
  },
  {
    id: "builtin-margin-trend",
    name: "结余趋势·折线图",
    description: "逐期的收入减成本，看结余是不是在变薄",
    chartKind: "line",
    source: { kind: "margin" },
    aggregation: "sum",
    unit: "元",
    groupBy: "period",
    builtin: true,
  },
  {
    id: "builtin-cost-breakdown",
    name: "成本构成·饼图",
    description: "总成本按计入成本的填报项逐项拆开",
    chartKind: "pie",
    source: { kind: "costBreakdown" },
    aggregation: "sum",
    unit: "元",
    groupBy: "costField",
    builtin: true,
  },
  {
    id: "builtin-device-cost-table",
    name: "单台成本明细·表格",
    description: "逐台设备的总成本，用来找成本异常的那一台",
    chartKind: "table",
    source: { kind: "totalCost" },
    aggregation: "sum",
    unit: "元",
    groupBy: "device",
    builtin: true,
  },
  {
    id: "builtin-device-detail-table",
    name: "设备明细·表格",
    description: "逐台设备的总收入，配合成本明细一起看",
    chartKind: "table",
    source: { kind: "reportField", fieldKey: "totalRevenue" },
    aggregation: "sum",
    unit: "元",
    groupBy: "device",
    builtin: true,
  },
];

/* ------------------------------------------------------------------ 指标值绑定 */

export type MetricBinding = {
  source: ChartValueSource;
  aggregation: ChartAggregation;
  rate?: RateSpec;
  unit: string;
  defaultChart: ChartKind;
  note: string;
};

/**
 * 17 条指标 → 填报口径的绑定。
 *
 * 逐条按现有 18 项填报字段判断能不能算，算不出来的一律绑 null 并在 note 里写清缺什么——
 * 指标字典里的口径是医院签过字的原文，凑一个近似口径顶上去，等于拿一个没人认过的数去汇报，
 * 比卡片空着危险得多。null 的卡片在驾驶舱上显示「未接入」，字段补齐后自动点亮。
 */
export const METRIC_VALUE_BINDINGS: Readonly<Record<string, MetricBinding | null>> = {
  "metric-1": {
    source: { kind: "reportField", fieldKey: "totalRevenue" },
    aggregation: "sum",
    unit: "元",
    defaultChart: "stat",
    note: "导入的「总收入」逐台逐期求和（只认数据准备中心的导入值，填报记录里的同名脏数据忽略）；只统计该设备该期有填报记录的格子，未填报的设备不计收入，否则会算收入不算成本。",
  },
  "metric-2": {
    source: { kind: "totalCost" },
    aggregation: "sum",
    unit: "元",
    defaultChart: "stat",
    note: "所有「计入成本」的填报项当期合计，再按设备和期间相加；一项都没填的设备期算缺数，不按 0 计。",
  },
  "metric-3": {
    source: { kind: "margin" },
    aggregation: "sum",
    unit: "元",
    defaultChart: "stat",
    note: "结余 = 导入总收入 − 当期总成本，逐个设备期算完再相加；收入和成本有一边没数就整格不计，不拿单边数冒充结余。",
  },
  "metric-4": {
    source: { kind: "reportField", fieldKey: "examVolume" },
    aggregation: "sum",
    unit: "人次",
    defaultChart: "bar",
    note: "导入的「检查人数/项目」逐台逐期求和；口径与导入表一致（按报告份数、剔除体检）。",
  },
  "metric-5": null,
  "metric-6": {
    source: { kind: "reportField", fieldKey: "usageHours" },
    aggregation: "sum",
    unit: "小时",
    defaultChart: "stat",
    note: "填报「使用时间」在范围内求和。填报口径里只有这一项时长字段，「上电空转」和「实际诊疗」分不开；要严格按「上电即计入」统计，需新增「开机通电时长」字段。",
  },
  "metric-7": {
    source: { kind: "reportField", fieldKey: "usageDays" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "usageDays" }, denominator: "calendarDays", percent: true },
    unit: "%",
    defaultChart: "stat",
    note: "使用天数 ÷ 周期日历天数 × 100，与填报页派生指标「设备使用率」同口径。范围内先把使用天数和日历天数各自求和再相除（一台设备跨两个月按两个月天数合计），绝不对各设备的使用率取平均。",
  },
  "metric-8": {
    source: { kind: "reportField", fieldKey: "examVolume" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "examVolume" }, denominator: "deviceCount", percent: false },
    unit: "人次",
    defaultChart: "stat",
    note: "检查人次合计 ÷ 参与统计的设备台数；同一台设备跨多期只算一台，没有填报记录的设备不进分母。",
  },
  "metric-9": {
    source: { kind: "reportField", fieldKey: "usageHours" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "usageHours" }, denominator: "calendarDays", percent: false },
    unit: "小时",
    defaultChart: "stat",
    note: "使用时间合计 ÷ 周期日历天数合计（分母按指标原文取日历天数）。原文分子是「实际诊疗时长、不含空转」，填报里只有一项「使用时间」，所以当前与 metric-10 同值；两者要分开须新增「实际诊疗时长」字段。",
  },
  "metric-10": {
    source: { kind: "reportField", fieldKey: "usageHours" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "usageHours" }, denominator: "calendarDays", percent: false },
    unit: "小时",
    defaultChart: "stat",
    note: "使用时间合计 ÷ 周期日历天数合计，即日均开机时长。同 metric-9：填报只有一项时长字段，两条指标暂时是同一个数，界面上要按两条看须先补字段。",
  },
  "metric-11": null,
  "metric-12": null,
  "metric-13": {
    source: { kind: "reportField", fieldKey: "faultHours" },
    aggregation: "sum",
    unit: "小时",
    defaultChart: "bar",
    note: "填报「故障时间」逐台逐期求和；口径含等待维修时间，不含计划性停机（以填报说明为准）。",
  },
  "metric-14": null,
  "metric-15": {
    source: { kind: "reportField", fieldKey: "repairFee" },
    aggregation: "rate",
    rate: {
      numerator: { kind: "reportField", fieldKey: "repairFee" },
      denominator: { fieldKey: "totalRevenue" },
      percent: true,
    },
    unit: "%",
    defaultChart: "stat",
    note: "维修费合计 ÷ 设备运营总收入合计 × 100，取指标原文的第二个口径：原文首选分母「设备原值」在设备台账里、不在填报口径内。分子只含「维修费」，按原文不含维保费。",
  },
  "metric-16": {
    source: { kind: "reportField", fieldKey: "faultHours" },
    aggregation: "rate",
    rate: { numerator: { kind: "reportField", fieldKey: "faultHours" }, denominator: "usageHours", percent: true },
    unit: "%",
    defaultChart: "stat",
    note: "故障时间合计 ÷ 使用时间合计 × 100，即时长口径的停机占比（= 1 − 填报页派生指标「设备完好率」，对应原文「停机率 = 1 − 开机率」那一条）。原文首选分母「在用台数 × 日历天数 × 24」需要设备状态台账支持，填报口径下先按使用时间算，读数时以此为准。",
  },
  "metric-17": {
    source: { kind: "reportField", fieldKey: "positiveCount" },
    aggregation: "rate",
    rate: {
      numerator: { kind: "reportField", fieldKey: "positiveCount" },
      denominator: { fieldKey: "examVolume" },
      percent: true,
    },
    unit: "%",
    defaultChart: "stat",
    note: "检阳性数 ÷ 检查人次 × 100，两项都取数据准备中心的导入值。范围内先各自求和再相除，不对各设备的阳性率取平均。",
  },
};

/*
 * 绑 null 的四条，缺的到底是什么（写在这里而不是 note 里会看不到，所以 note 也各写了一份）：
 * - metric-5  检查部位数：填报里只有「检查人数/项目」，一份报告含多部位仍算 1 人次，推不出部位数；
 * - metric-11 工作饱和度：分子分母是「实际诊疗时长」和「开机总时长」两项，填报只有一项「使用时间」，
 *             硬算等于自己除自己，恒等于 100%，没有任何信息量；
 * - metric-12 设备完好率：原文按台数算（完好台数 ÷ 在用台数），填报里没有设备完好状态；
 *             「故障时间」只能算时长占比，和台数口径不是一回事，不能顶替；
 * - metric-14 平均维修响应时间：需要每张维修工单的报修时刻、到场时刻和工单数，填报里一个都没有。
 */

/* ------------------------------------------------------------------ 维度预设 */

export type CockpitDimensionPreset = {
  id: "leader" | "department" | "board";
  label: string;
  description: string;
  defaultScope: CockpitScope["level"];
  entryIds: readonly string[];
};

/**
 * 三个视角的默认指标组合。
 *
 * entryIds 只放绑定非 null 的指标：预设是「开箱即用」的承诺，
 * 里面塞一张永远空着的「未接入」卡片，用户第一眼看到的就是系统坏了。
 */
export const COCKPIT_DIMENSION_PRESETS: readonly CockpitDimensionPreset[] = [
  {
    id: "leader",
    label: "领导视角",
    description: "全院口径：收入、成本、结余和整体效率，一屏看完",
    defaultScope: "hospital",
    entryIds: ["metric-1", "metric-2", "metric-3", "metric-4", "metric-7", "metric-8", "metric-17"],
  },
  {
    id: "department",
    label: "科室视角",
    description: "落到单个科室：本科室的成本、结余、工作量和设备保障",
    defaultScope: "department",
    entryIds: ["metric-2", "metric-3", "metric-4", "metric-7", "metric-15", "metric-16"],
  },
  {
    id: "board",
    label: "看板视角",
    description: "大屏轮播：只留四五条核心数，远处也看得清",
    defaultScope: "hospital",
    entryIds: ["metric-1", "metric-2", "metric-3", "metric-4", "metric-7"],
  },
];

/* ------------------------------------------------------------------ 看板配置 */

export type MetricCockpitItem = {
  entryId: string;
  templateId: string;
  chartKind: ChartKind;
  size: "small" | "medium" | "wide";
  order: number;
};

export type MetricCockpitConfigState = {
  dimension: "leader" | "department" | "board";
  department: string;
  onlyConfirmed: boolean;
  items: MetricCockpitItem[];
};

/**
 * 给指标绑定挑模板：先按「取值 + 聚合」完全一致找，找不到退到取值一致，再找不到返回 null。
 * 和配置页里的同名逻辑保持一致——两边算出不同的模板，会让「有没有改过看板」的判断一直为真，
 * 用户每次切维度都被弹一次确认框。
 */
function matchTemplate(binding: MetricBinding, templates: readonly ChartTemplate[]): ChartTemplate | null {
  const key = sourceKeyOf(binding.source);
  return (
    templates.find((template) => sourceKeyOf(template.source) === key && template.aggregation === binding.aggregation) ??
    templates.find((template) => sourceKeyOf(template.source) === key) ??
    null
  );
}

function sourceKeyOf(source: ChartValueSource): string {
  return source.kind === "reportField" ? `field:${source.fieldKey}` : source.kind;
}

/** 数值卡天生小、表格和折线要横向空间，其余中卡；用户随时能在预览里循环切 */
function defaultSizeFor(kind: ChartKind): MetricCockpitItem["size"] {
  if (kind === "stat") return "small";
  if (kind === "table" || kind === "line") return "wide";
  return "medium";
}

function isChartKind(value: unknown): value is ChartKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CHART_KIND_LABELS, value);
}

function makeItem(entryId: string, order: number, templates: readonly ChartTemplate[]): MetricCockpitItem {
  const binding = METRIC_VALUE_BINDINGS[entryId] ?? null;
  const chartKind = binding?.defaultChart ?? "stat";
  return {
    entryId,
    // 没绑定口径的指标模板 ID 留空：卡片走「未接入」空态，不随手塞一个口径不符的模板充数
    templateId: binding ? matchTemplate(binding, templates)?.id ?? "" : "",
    chartKind,
    size: defaultSizeFor(chartKind),
    order,
  };
}

function presetItemsOf(entryIds: readonly string[], templates: readonly ChartTemplate[]): MetricCockpitItem[] {
  return entryIds.map((entryId, index) => makeItem(entryId, index, templates));
}

export function defaultMetricCockpitConfig(): MetricCockpitConfigState {
  const preset = COCKPIT_DIMENSION_PRESETS.find((item) => item.id === "leader");
  return {
    dimension: "leader",
    department: "",
    // 默认只看已确认：驾驶舱的数是拿去汇报的，草稿混进去等于按没人认过的数做决策
    onlyConfirmed: true,
    items: presetItemsOf(preset?.entryIds ?? [], DEFAULT_CHART_TEMPLATES),
  };
}

/**
 * 收拾云端读回的看板配置。
 *
 * 配置是整段 JSON 存的，跨版本回读时什么都可能出现：指标被删了、模板被删了、
 * 字段是老版本没有的。这里一律「能修就修、修不了就丢」，绝不让一条脏数据把整个驾驶舱打空白，
 * 也绝不把不认识的 entryId 留在里面——渲染时会变成一张查无此指标的死卡。
 */
export function normalizeCockpitConfig(
  raw: unknown,
  validEntryIds: ReadonlySet<string>,
  templates: readonly ChartTemplate[],
): MetricCockpitConfigState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultMetricCockpitConfig();
  const source = raw as Record<string, unknown>;
  const dimension: MetricCockpitConfigState["dimension"] =
    source.dimension === "department" || source.dimension === "board" ? source.dimension : "leader";
  const department = typeof source.department === "string" ? source.department : "";
  const onlyConfirmed = typeof source.onlyConfirmed === "boolean" ? source.onlyConfirmed : true;

  if (!Array.isArray(source.items)) {
    // items 整个缺失（老版本配置）按该视角的默认组合补齐，比给一块空白看板强
    const preset = COCKPIT_DIMENSION_PRESETS.find((item) => item.id === dimension);
    const items = presetItemsOf(preset?.entryIds ?? [], templates)
      .filter((item) => validEntryIds.has(item.entryId))
      .map((item, index) => ({ ...item, order: index }));
    return { dimension, department, onlyConfirmed, items };
  }

  const seen = new Set<string>();
  const items: MetricCockpitItem[] = [];
  for (const candidate of source.items) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const entryId = typeof item.entryId === "string" ? item.entryId : "";
    // 同一条指标只留第一张卡：两张卡片同 entryId 会让拖拽换位和删除都作用到错的那张
    if (!entryId || !validEntryIds.has(entryId) || seen.has(entryId)) continue;
    const templateId = typeof item.templateId === "string" ? item.templateId : "";
    // 空串是「未接入」卡片的合法状态（指标还没绑口径），不算脏；非空却查无此模板才丢
    if (templateId && !templates.some((template) => template.id === templateId)) continue;
    const binding = METRIC_VALUE_BINDINGS[entryId] ?? null;
    const chartKind = isChartKind(item.chartKind) ? item.chartKind : binding?.defaultChart ?? "stat";
    const size = item.size === "small" || item.size === "medium" || item.size === "wide" ? item.size : defaultSizeFor(chartKind);
    const order = typeof item.order === "number" && Number.isFinite(item.order) ? item.order : items.length;
    seen.add(entryId);
    items.push({ entryId, templateId, chartKind, size, order });
  }
  // order 重排成 0..n-1：剔掉几张卡之后留着空档，后面按 order 交换位置的拖拽会算错落点
  items.sort((left, right) => left.order - right.order);
  return { dimension, department, onlyConfirmed, items: items.map((item, index) => ({ ...item, order: index })) };
}
