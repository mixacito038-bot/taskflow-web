/**
 * 设备效益诊断内核。
 *
 * 平台里原本有三处各自判断「这台设备有问题」：预警规则（alert-rules）、资本计划的 classify()、
 * 改进中心的情景测算。同一批底层事实各算一套，结果同一台设备在三个页面上能给出互相矛盾的结论——
 * 院长在分析页看到「该换」、在资本计划看到「可延寿」，这种事在医院里是要出事的。
 * 这个模块把「事实 → 问题 → 风险分 → 处置分档 → 情景测算」收敛成唯一一条链路，四个页面只读它。
 *
 * 另一半理由是取数口径：四个分析页至今读的是台账上的年度汇总（Device.revenue/cost/utilization），
 * 而医院真正在填的是「设备 × 期间」的月度填报。填报的数流不到分析页，等于分析页在看去年的账。
 * 这里以填报口径为准，台账只在显式要求兜底时才用。
 *
 * 本模块刻意只做 import type（零运行时依赖）：它是纯计算层，服务端汇总、导出和测试都直接引用，
 * 挂上 React 页面或演示数据的依赖链只会把别人的问题带进来。同理，台账年度合计在这里就地相加，
 * 不 import mock-data 的 totalCost/netBenefit。
 *
 * 取数规矩与 chart-template-catalog.computeChartSeries 完全一致，一个字都不能松：
 * 1. 业务量三项只认 workloadOf，绝不读 record.values；
 * 2. 已退回（returned）的记录任何口径下都不计入；
 * 3. 只有该设备该期存在符合口径的记录，这一格才参与统计（否则未填报设备的导入收入会进合计、成本却是空的）；
 * 4. 比率一律「分子和 ÷ 分母和」，绝不对各期比率取平均；
 * 5. 缺数返回 null，不是 0；分母为 0 或缺失一律 null，绝不让 Infinity / NaN 渗到界面上。
 */

import type { DeviceReportRecord, ReportFieldDefinition, ReportPeriod } from "./device-report-fields";
import type { Device } from "./mock-data";

/* ------------------------------------------------------------------ 契约 */

export type FindingCode = "loss" | "low_utilization" | "payback_delay" | "high_fault" | "high_maintenance" | "no_data";
export type FindingSeverity = "high" | "medium" | "low";
/** 这条问题该去哪个页面处置 */
export type FindingRoute = "improvement" | "capital" | "data";

export type Finding = {
  code: FindingCode;
  severity: FindingSeverity;
  title: string;
  /** 一句可核对的证据，必须带实际值和阈值，例如「使用率 48.2%，低于阈值 55%」 */
  evidence: string;
  route: FindingRoute;
  /** 建议动作，写成能直接当改进任务标题用的一句话 */
  suggestion: string;
};

export type DiagnosisThresholds = {
  utilizationFloor: number;
  paybackDelayYears: number;
  maintenanceRatioCeil: number;
  integrityFloor: number;
};

/**
 * 阈值全部照抄现有口径，不新发明数：
 * - 55% 来自 alert-rules 的「使用率过低」规则；
 * - 1.5 年来自 CapitalPlanningCenter.classify() 的「回收期明显延后」；
 * - 15% 来自同一函数的「维护收入比偏高」；
 * - 95% 是设备完好率的常用管理线（填报页派生指标同口径）。
 * 医院要调线，走 thresholds 覆盖，而不是在页面里各改各的。
 */
export const DEFAULT_DIAGNOSIS_THRESHOLDS: DiagnosisThresholds = {
  utilizationFloor: 55,
  paybackDelayYears: 1.5,
  maintenanceRatioCeil: 15,
  integrityFloor: 95,
};

export type DeviceFacts = {
  deviceId: string;
  name: string;
  model: string;
  department: string;
  assetCode: string;
  /** 期间口径的人话，直接显示在页面上 */
  periodLabel: string;
  periodCount: number;
  revenue: number | null;
  cost: number | null;
  margin: number | null;
  examVolume: number | null;
  utilization: number | null;
  integrity: number | null;
  maintenanceRatio: number | null;
  costPerExam: number | null;
  investment: number;
  age: number;
  usefulLifeYears: number;
  remainingLife: number;
  /** 按当期结余年化推算的回收年数；结余 ≤ 0 或缺数时为 null——亏钱的设备没有「回收期」 */
  paybackYears: number | null;
  planPayback: number;
  /** 本期是否有可用的填报记录；false 时大部分字段为 null */
  hasReport: boolean;
};

export type CapitalBand = "必须替换" | "计划替换" | "可延寿" | "共享调拨" | "持续观察";
/** 效益四象限：结余高低 × 使用率高低 */
export type BenefitQuadrant = "明星" | "潜力" | "低效" | "问题" | "待补数";

/**
 * 汇总层重算比率要用的原始分子/分母。
 *
 * 页面不读这一项，但它必须跟着诊断走：使用率是比率，全院和科室口径只能拿各台的分子和 ÷ 分母和重算，
 * 丢了权重就只剩「各台百分比再平均」这一条路，那算出来的是个假数（15/30 天和 30/31 天平均出 73.4%
 * 而不是 73.8%）。
 */
export type DiagnosisWeights = {
  usageDays: number | null;
  calendarDays: number | null;
};

export type DeviceDiagnosis = {
  facts: DeviceFacts;
  findings: Finding[];
  riskScore: number;
  band: CapitalBand;
  quadrant: BenefitQuadrant;
  weights: DiagnosisWeights;
};

export type DiagnosisInput = {
  devices: readonly Device[];
  records: readonly DeviceReportRecord[];
  periods: readonly ReportPeriod[];
  fields: readonly ReportFieldDefinition[];
  workloadOf: (deviceId: string, periodKey: string) => { examVolume?: string; positiveCount?: string; totalRevenue?: string } | undefined;
  /** true 时只认 status === "confirmed" 的记录（正式口径） */
  onlyConfirmed: boolean;
  thresholds?: Partial<DiagnosisThresholds>;
  /** 台账年度口径兜底：本期没有任何填报记录时是否退回用 Device 上的年度汇总。
   *  默认 false —— 没填报就如实说没填报，不拿别处的数冒充本期。 */
  fallbackToLedger?: boolean;
};

/* ------------------------------------------------------------------ 取数 */

/**
 * 业务量三项由数据准备中心的表格导入，只认 workloadOf 的返回值。
 * record.values 里若混进同名的键（历史脏数据、手工改过的草稿）一律忽略：
 * 同一个数有两个来源，报表被质询时说不清以哪个为准。
 */
const IMPORTED_FIELD_KEYS = new Set(["examVolume", "positiveCount", "totalRevenue"]);

/** 只接受纯数字串；空、非数字一律 null，让缺数显示成「—」而不是 0 */
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** 台账里没填使用科室的设备也要出现在科室汇总里，否则它的成本会凭空消失 */
const UNASSIGNED_DEPARTMENT = "未分配科室";

/** 台账没填折旧年限时的兜底，与 CapitalPlanningCenter.classify() 一致 */
const DEFAULT_USEFUL_LIFE_YEARS = 10;

/** 台账金额记「万元」，诊断内核一律用「元」——两个单位在页面上混着走，迟早有人把 1580 当成 1580 元 */
const WAN = 10000;

/** 期间粒度是月，年化就是「÷ 期数 × 12」 */
const MONTHS_PER_YEAR = 12;

/** 台账年度口径兜底时的等效期数：年度汇总本身就是 12 个月，年化后应当等于它自己 */
const LEDGER_PERIOD_COUNT = 12;

/** 台账年度使用率换算成权重时的等效天数；只用于让科室/全院口径能按分子和÷分母和重算 */
const LEDGER_CALENDAR_DAYS = 365;

/**
 * 统计期间一期都没有时的参考年份。
 *
 * 设备年龄按「统计期末年份 − 启用年份」算，不读系统时钟：诊断是纯函数，读 Date.now() 会让同一份数据
 * 跨年自己变结论，也让测试不可复现。真的一期都没选时才回落到这个常量（与 classify() 里写死的 2026 一致）。
 */
const FALLBACK_REFERENCE_YEAR = 2026;

function parseValue(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!NUMBER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 金额取整到元：小数尾巴只会让人以为算错了钱 */
function money(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

/** 百分比一位小数 */
function percent(value: number | null): number | null {
  return value === null ? null : roundTo(value, 1);
}

/** 分母缺失或为 0 一律 null：Infinity / NaN 会一路渗到界面上，显示成「∞%」比空着难解释得多 */
function ratio(numerator: number | null, denominator: number | null, scale = 1): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = (numerator / denominator) * scale;
  return Number.isFinite(value) ? value : null;
}

/** 一个「设备 × 期间」的格子；有符合口径的记录才成格 */
type Cell = { period: ReportPeriod; record: DeviceReportRecord };

/**
 * 摊平成格子。
 *
 * 「该设备该期有没有符合口径的填报记录」是唯一的入场券：收入走导入表、成本走填报记录，
 * 把没填报的设备也算进来，它的收入会进合计、成本却是空的，结余就凭空多出一块——假结余比没有数更危险。
 * 已退回（returned）的记录任何口径下都不算：科室还得重填，算进去等于拿一份被打回的数汇报。
 */
function collectCells(deviceId: string, input: DiagnosisInput): Cell[] {
  const cells: Cell[] = [];
  for (const period of input.periods) {
    const record = input.records.find((item) => item.deviceId === deviceId && item.periodKey === period.key);
    if (!record || record.status === "returned") continue;
    if (input.onlyConfirmed && record.status !== "confirmed") continue;
    cells.push({ period, record });
  }
  return cells;
}

function readField(input: DiagnosisInput, deviceId: string, cell: Cell, fieldKey: string): number | null {
  if (IMPORTED_FIELD_KEYS.has(fieldKey)) {
    const workload = input.workloadOf(deviceId, cell.period.key);
    if (!workload) return null;
    if (fieldKey === "examVolume") return parseValue(workload.examVolume);
    if (fieldKey === "positiveCount") return parseValue(workload.positiveCount);
    return parseValue(workload.totalRevenue);
  }
  return parseValue(cell.record.values?.[fieldKey]);
}

/** 求和：全缺返回 null（不是 0），部分缺就把有数的加起来 */
function sumField(input: DiagnosisInput, deviceId: string, cells: readonly Cell[], fieldKey: string): number | null {
  let sum = 0;
  let filled = false;
  for (const cell of cells) {
    const value = readField(input, deviceId, cell, fieldKey);
    if (value === null) continue;
    sum += value;
    filled = true;
  }
  return filled ? sum : null;
}

/** 计入成本的填报项合计；一项都没填返回 null，避免「还没填」被显示成「成本 0 元」 */
function sumCost(input: DiagnosisInput, deviceId: string, cells: readonly Cell[]): number | null {
  let sum = 0;
  let filled = false;
  for (const field of input.fields) {
    if (!field.countsToCost) continue;
    for (const cell of cells) {
      const value = readField(input, deviceId, cell, field.key);
      if (value === null) continue;
      sum += value;
      filled = true;
    }
  }
  return filled ? sum : null;
}

/** 两项之和，两项都缺才算缺——维修费和维保费只填了一项也是真花出去的钱 */
function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function sumNullable(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let filled = false;
  for (const value of values) {
    if (value === null) continue;
    sum += value;
    filled = true;
  }
  return filled ? sum : null;
}

/* ------------------------------------------------------------------ 期间口径 */

function periodRangeLabel(periods: readonly ReportPeriod[]): string {
  if (!periods.length) return "未选定统计期间";
  let start = periods[0].start;
  let end = periods[0].end;
  // ISO 日期按字符串比大小就是按时间比，调用方传进来的期间未必是排好序的
  for (const period of periods) {
    if (period.start < start) start = period.start;
    if (period.end > end) end = period.end;
  }
  const startYear = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  const startMonth = Number(start.slice(5, 7));
  const endMonth = Number(end.slice(5, 7));
  if (startYear === endYear && startMonth === endMonth) return `${startYear}年${startMonth}月`;
  if (startYear === endYear) return `${startYear}年${startMonth}—${endMonth}月`;
  return `${startYear}年${startMonth}月—${endYear}年${endMonth}月`;
}

/**
 * 期间口径写成人话。
 *
 * 实报期数和应填期数不一致时必须写出来：只报了 1 个月的设备，其年化结余是拿 1 个月推的，
 * 页面上不写清楚，看的人会以为这是半年的账。
 */
function periodLabelOf(range: string, expected: number, actual: number): string {
  if (expected === actual) return `${range}（${expected} 期）`;
  return `${range}（${expected} 期中实报 ${actual} 期）`;
}

function referenceYearOf(periods: readonly ReportPeriod[]): number {
  let year = 0;
  for (const period of periods) {
    const value = Number(period.end.slice(0, 4));
    if (Number.isFinite(value) && value > year) year = value;
  }
  return year || FALLBACK_REFERENCE_YEAR;
}

function enabledYearOf(device: Device): number | null {
  const text = (device.enabledDate ?? "").trim();
  // 严格按四位年份取：Number("") 是 0 而不是 NaN，不校验的话空启用日期会被算成 2026 岁
  if (!/^\d{4}/.test(text)) return null;
  return Number(text.slice(0, 4));
}

function departmentOf(device: Device): string {
  return (device.department ?? "").trim() || UNASSIGNED_DEPARTMENT;
}

/** 台账年度合计；就地相加而不 import mock-data.totalCost，纯计算层不挂演示数据模块的依赖链 */
function ledgerCost(device: Device): number {
  return Object.values(device.cost).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

/* ------------------------------------------------------------------ 事实 */

function buildFacts(device: Device, input: DiagnosisInput): { facts: DeviceFacts; weights: DiagnosisWeights } {
  const cells = collectCells(device.id, input);
  const hasReport = cells.length > 0;
  const range = periodRangeLabel(input.periods);
  const usefulLifeYears = device.usefulLifeYears ?? DEFAULT_USEFUL_LIFE_YEARS;
  const enabledYear = enabledYearOf(device);
  const age = enabledYear === null ? 0 : Math.max(0, referenceYearOf(input.periods) - enabledYear);
  const investment = device.investment * WAN;
  const base = {
    deviceId: device.id,
    name: device.name,
    model: device.model,
    department: departmentOf(device),
    assetCode: device.assetCode,
    investment,
    age,
    usefulLifeYears,
    remainingLife: usefulLifeYears - age,
    planPayback: device.planPayback,
  };

  if (!hasReport) {
    if (!input.fallbackToLedger) {
      return {
        facts: {
          ...base,
          periodLabel: periodLabelOf(range, input.periods.length, 0),
          periodCount: 0,
          revenue: null,
          cost: null,
          margin: null,
          examVolume: null,
          utilization: null,
          integrity: null,
          maintenanceRatio: null,
          costPerExam: null,
          paybackYears: null,
          hasReport: false,
        },
        weights: { usageDays: null, calendarDays: null },
      };
    }
    // 兜底口径：台账是年度汇总，年化时按 12 期算才等于它自己。完好率台账里没有，保持 null 而不是编一个。
    const revenue = money(device.revenue * WAN);
    const cost = money(ledgerCost(device) * WAN);
    const margin = revenue === null || cost === null ? null : revenue - cost;
    const utilization = percent(device.utilization);
    const maintenanceRatio = percent(ratio(device.cost?.maintenance ?? null, device.revenue, 100));
    return {
      facts: {
        ...base,
        periodLabel: `台账年度口径（${range}无填报记录）`,
        periodCount: LEDGER_PERIOD_COUNT,
        revenue,
        cost,
        margin,
        examVolume: device.serviceVolume,
        utilization,
        integrity: null,
        maintenanceRatio,
        costPerExam: money(ratio(cost, device.serviceVolume)),
        paybackYears: paybackYearsOf(investment, margin, LEDGER_PERIOD_COUNT),
        hasReport: false,
      },
      weights: {
        usageDays: utilization === null ? null : (utilization / 100) * LEDGER_CALENDAR_DAYS,
        calendarDays: LEDGER_CALENDAR_DAYS,
      },
    };
  }

  const revenue = money(sumField(input, device.id, cells, "totalRevenue"));
  const cost = money(sumCost(input, device.id, cells));
  // 结余按「收入合计 − 成本合计」算，而不是逐格算完再加：页面上三个数是并排显示的，
  // 结余对不上收入减成本，医院第一反应是系统算错了账。
  const margin = revenue === null || cost === null ? null : revenue - cost;
  const examVolume = sumField(input, device.id, cells, "examVolume");
  const usageDays = sumField(input, device.id, cells, "usageDays");
  const calendarDays = cells.reduce((sum, cell) => sum + cell.period.days, 0);
  const usageHours = sumField(input, device.id, cells, "usageHours");
  const faultHours = sumField(input, device.id, cells, "faultHours");
  // 故障时间一格都没填时返回 null 而不是按 0 计：按 0 计会得出「完好率 100%」，
  // 一台没人填故障的设备反而成了全院最健康的，高故障问题永远报不出来。
  const uptimeHours = usageHours === null || faultHours === null ? null : usageHours - faultHours;
  const maintenanceSpend = addNullable(
    sumField(input, device.id, cells, "repairFee"),
    sumField(input, device.id, cells, "maintenanceFee"),
  );
  const periodCount = cells.length;

  return {
    facts: {
      ...base,
      periodLabel: periodLabelOf(range, input.periods.length, periodCount),
      periodCount,
      revenue,
      cost,
      margin,
      examVolume,
      utilization: percent(ratio(usageDays, calendarDays, 100)),
      integrity: percent(ratio(uptimeHours, usageHours, 100)),
      maintenanceRatio: percent(ratio(maintenanceSpend, revenue, 100)),
      costPerExam: money(ratio(cost, examVolume)),
      paybackYears: paybackYearsOf(investment, margin, periodCount),
      hasReport: true,
    },
    // 分母照 computeChartSeries 的口径按「有记录的格子」算，哪怕这台没填使用天数：
    // 两边口径必须一致，否则驾驶舱的使用率和诊断页的使用率会差一截，谁也说不清哪个是对的。
    weights: { usageDays, calendarDays: calendarDays || null },
  };
}

/**
 * 回收年数。
 *
 * 结余按期数年化（期间粒度是月），再拿投资额去除。年结余 ≤ 0 一律 null：
 * 亏钱的设备没有「回收期」，硬算出来的是个负数年份，摆在页面上比空着更容易被误读成「已回本」。
 */
function paybackYearsOf(investment: number, margin: number | null, periodCount: number): number | null {
  if (margin === null || periodCount <= 0) return null;
  const annual = (margin / periodCount) * MONTHS_PER_YEAR;
  if (annual <= 0) return null;
  const years = investment / annual;
  return Number.isFinite(years) ? roundTo(years, 1) : null;
}

function annualize(value: number | null, periodCount: number): number | null {
  if (value === null || periodCount <= 0) return null;
  return (value / periodCount) * MONTHS_PER_YEAR;
}

/* ------------------------------------------------------------------ 问题判定 */

const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };

function buildFindings(facts: DeviceFacts, thresholds: DiagnosisThresholds, expectedPeriods: number): Finding[] {
  const findings: Finding[] = [];
  const device = facts.name;

  if (!facts.hasReport) {
    findings.push({
      code: "no_data",
      severity: "medium",
      title: "本期无填报数据",
      evidence: `${facts.periodLabel}应填 ${expectedPeriods} 期，可用填报记录 0 期`,
      route: "data",
      suggestion: `补填${device}（${facts.assetCode}）${facts.periodLabel}的填报数据并提交确认`,
    });
  }

  // 缺数的项一律不产生问题：没填报不等于设备有毛病，硬判会把处置资源引到填报缺口而不是真问题上，
  // 而填报缺口本身已经由 no_data 单独报出来了，责任分得清清楚楚。
  if (facts.margin !== null && facts.margin < 0) {
    findings.push({
      code: "loss",
      severity: "high",
      title: "当期结余为负",
      evidence: `当期结余 ${facts.margin} 元，低于阈值 0 元（收入 ${facts.revenue} 元 − 成本 ${facts.cost} 元）`,
      route: "improvement",
      suggestion: `对${device}启动亏损设备治理：核对收入结构与成本构成，形成提量或降本方案`,
    });
  }

  if (facts.utilization !== null && facts.utilization < thresholds.utilizationFloor) {
    findings.push({
      code: "low_utilization",
      severity: "high",
      title: "使用率低于阈值",
      evidence: `使用率 ${facts.utilization}%，低于阈值 ${thresholds.utilizationFloor}%`,
      route: "improvement",
      suggestion: `对${device}开展低使用率专项：梳理适应证池、合并或共享排班并复核预约模板`,
    });
  }

  if (facts.paybackYears !== null) {
    const delay = roundTo(facts.paybackYears - facts.planPayback, 1);
    if (delay >= thresholds.paybackDelayYears) {
      findings.push({
        code: "payback_delay",
        severity: "medium",
        title: "回收期明显延后",
        evidence: `按当期结余年化的回收期 ${facts.paybackYears} 年，较计划 ${facts.planPayback} 年延后 ${delay} 年，达到阈值 ${thresholds.paybackDelayYears} 年`,
        route: "capital",
        suggestion: `对${device}组织回本偏差分析：核对收入结构与现金成本，形成提量或降本方案`,
      });
    }
  }

  if (facts.maintenanceRatio !== null && facts.maintenanceRatio >= thresholds.maintenanceRatioCeil) {
    findings.push({
      code: "high_maintenance",
      severity: "medium",
      title: "维护收入比偏高",
      evidence: `维护收入比 ${facts.maintenanceRatio}%，达到阈值 ${thresholds.maintenanceRatioCeil}%`,
      route: "capital",
      suggestion: `对${device}比价维保方案并评估延寿改造或纳入更新论证`,
    });
  }

  if (facts.integrity !== null && facts.integrity < thresholds.integrityFloor) {
    findings.push({
      code: "high_fault",
      severity: "medium",
      title: "设备完好率偏低",
      evidence: `设备完好率 ${facts.integrity}%，低于阈值 ${thresholds.integrityFloor}%`,
      route: "improvement",
      suggestion: `对${device}制定保障提升计划：复盘故障史、前置关键备件并比价维保方案`,
    });
  }

  return findings.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
}

/* ------------------------------------------------------------------ 风险分与分档 */

/**
 * 风险分（0—100），口径搬自 CapitalPlanningCenter.classify()，只是把使用率线换成本内核的统一阈值——
 * 原函数用 70、预警规则用 55，两条使用率线并存本身就是要收敛掉的那种口径分叉。
 *
 * 缺数的项按 0 计（原函数在收入为 0 时把维护收入比按 100 计，即「按最坏算」）：
 * 按最坏算会让「还没填报」看起来像「设备快报废」，风险榜顶上全是没填数的设备，
 * 真正该处置的那台反而被挤下去；缺数的处置动作是去填报，由 no_data 单独承担。
 */
function riskScoreOf(facts: DeviceFacts, thresholds: DiagnosisThresholds): number {
  const usefulLife = facts.usefulLifeYears;
  // 寿命年限填 0 或负数是台账脏数据，按「已到寿命」算：此时 remainingLife = -age 本来也已进入替换档
  const ageRatio = usefulLife > 0 ? facts.age / usefulLife : 1;
  const utilizationGap = facts.utilization === null ? 0 : Math.max(0, thresholds.utilizationFloor - facts.utilization);
  const maintenanceRatio = facts.maintenanceRatio === null ? 0 : facts.maintenanceRatio;
  const paybackDelay = facts.paybackYears === null ? 0 : Math.max(0, facts.paybackYears - facts.planPayback);
  return Math.min(
    100,
    Math.round(
      Math.max(0, ageRatio) * 35 + utilizationGap * 0.75 + Math.min(25, maintenanceRatio) + Math.min(20, paybackDelay * 6),
    ),
  );
}

/**
 * 处置分档，if 链照抄 CapitalPlanningCenter.classify()（0 / 65 / 2 / 60 / 0.7 / 4 / 12 一个都没动）。
 * 唯一的替换是「使用率低」取本内核的统一阈值而不是原来写死的 60，理由同 riskScoreOf。
 * 缺数的设备走不进使用率和维护比这两条：没数不构成调拨或延寿的理由。
 */
function bandOf(facts: DeviceFacts, riskScore: number, thresholds: DiagnosisThresholds): CapitalBand {
  const lowUtilization = facts.utilization !== null && facts.utilization < thresholds.utilizationFloor;
  const highMaintenance = facts.maintenanceRatio !== null && facts.maintenanceRatio >= 12;
  if (facts.remainingLife <= 0 && riskScore >= 65) return "必须替换";
  if (facts.remainingLife <= 2 || riskScore >= 60) return "计划替换";
  if (lowUtilization && facts.age < facts.usefulLifeYears * 0.7) return "共享调拨";
  if (facts.remainingLife <= 4 || highMaintenance) return "可延寿";
  return "持续观察";
}

/**
 * 效益四象限。
 *
 * 结余或使用率任缺一项都归「待补数」，不只是「本期没填报」：只填了使用天数、没填收入的设备，
 * 若按 margin > 0 为假处理会被摆进「问题」象限，等于拿缺数当亏损上报。
 */
function quadrantOf(facts: DeviceFacts, thresholds: DiagnosisThresholds): BenefitQuadrant {
  if (facts.margin === null || facts.utilization === null) return "待补数";
  const highUtilization = facts.utilization >= thresholds.utilizationFloor;
  if (facts.margin > 0) return highUtilization ? "明星" : "潜力";
  return highUtilization ? "低效" : "问题";
}

/* ------------------------------------------------------------------ 诊断 */

export function buildDiagnoses(input: DiagnosisInput): DeviceDiagnosis[] {
  const thresholds: DiagnosisThresholds = { ...DEFAULT_DIAGNOSIS_THRESHOLDS, ...input.thresholds };
  return input.devices.map((device) => {
    const { facts, weights } = buildFacts(device, input);
    const riskScore = riskScoreOf(facts, thresholds);
    return {
      facts,
      findings: buildFindings(facts, thresholds, input.periods.length),
      riskScore,
      band: bandOf(facts, riskScore, thresholds),
      quadrant: quadrantOf(facts, thresholds),
      weights,
    };
  });
}

/* ------------------------------------------------------------------ 汇总 */

export type DiagnosisSummary = {
  total: number;
  reported: number;
  revenue: number | null;
  cost: number | null;
  margin: number | null;
  /** 按分子和÷分母和重算，不是各台平均 */
  utilization: number | null;
  highFindings: number;
  mediumFindings: number;
  quadrantCounts: Record<BenefitQuadrant, number>;
  bandCounts: Record<CapitalBand, number>;
};

/** 五个象限、五个分档都预置成 0：少一个键，页面上那一格会显示 undefined，加总也对不上台数 */
function emptyQuadrantCounts(): Record<BenefitQuadrant, number> {
  return { 明星: 0, 潜力: 0, 低效: 0, 问题: 0, 待补数: 0 };
}

function emptyBandCounts(): Record<CapitalBand, number> {
  return { 必须替换: 0, 计划替换: 0, 可延寿: 0, 共享调拨: 0, 持续观察: 0 };
}

function utilizationOf(list: readonly DeviceDiagnosis[]): number | null {
  const usageDays = sumNullable(list.map((item) => item.weights.usageDays));
  const calendarDays = sumNullable(list.map((item) => item.weights.calendarDays));
  return percent(ratio(usageDays, calendarDays, 100));
}

export function diagnosisSummary(list: readonly DeviceDiagnosis[]): DiagnosisSummary {
  const quadrantCounts = emptyQuadrantCounts();
  const bandCounts = emptyBandCounts();
  let highFindings = 0;
  let mediumFindings = 0;
  for (const item of list) {
    quadrantCounts[item.quadrant] += 1;
    bandCounts[item.band] += 1;
    for (const finding of item.findings) {
      if (finding.severity === "high") highFindings += 1;
      else if (finding.severity === "medium") mediumFindings += 1;
    }
  }
  const revenue = money(sumNullable(list.map((item) => item.facts.revenue)));
  const cost = money(sumNullable(list.map((item) => item.facts.cost)));
  return {
    total: list.length,
    reported: list.filter((item) => item.facts.hasReport).length,
    revenue,
    cost,
    margin: revenue === null || cost === null ? null : revenue - cost,
    utilization: utilizationOf(list),
    highFindings,
    mediumFindings,
    quadrantCounts,
    bandCounts,
  };
}

export type DepartmentRollup = {
  department: string;
  deviceCount: number;
  reported: number;
  revenue: number | null;
  cost: number | null;
  margin: number | null;
  utilization: number | null;
  highFindings: number;
};

/**
 * 科室汇总，按结余从低到高排——最该管的排最前。
 * 缺数的科室排在最后：没数不是「亏得最狠」，把它顶到榜首只会让人先去追一份不存在的账。
 */
export function departmentRollup(list: readonly DeviceDiagnosis[]): DepartmentRollup[] {
  const groups = new Map<string, DeviceDiagnosis[]>();
  for (const item of list) {
    const department = item.facts.department;
    const bucket = groups.get(department) ?? [];
    bucket.push(item);
    groups.set(department, bucket);
  }
  const rows: DepartmentRollup[] = [];
  for (const [department, items] of groups) {
    const revenue = money(sumNullable(items.map((item) => item.facts.revenue)));
    const cost = money(sumNullable(items.map((item) => item.facts.cost)));
    rows.push({
      department,
      deviceCount: items.length,
      reported: items.filter((item) => item.facts.hasReport).length,
      revenue,
      cost,
      margin: revenue === null || cost === null ? null : revenue - cost,
      utilization: utilizationOf(items),
      highFindings: items.reduce(
        (sum, item) => sum + item.findings.filter((finding) => finding.severity === "high").length,
        0,
      ),
    });
  }
  return rows.sort((left, right) => {
    if (left.margin === null && right.margin === null) return left.department.localeCompare(right.department, "zh-CN");
    if (left.margin === null) return 1;
    if (right.margin === null) return -1;
    if (left.margin !== right.margin) return left.margin - right.margin;
    return left.department.localeCompare(right.department, "zh-CN");
  });
}

/* ------------------------------------------------------------------ 情景测算 */

export type ScenarioMode = "不行动" | "维修延寿" | "更新替换" | "共享调拨";

export type ScenarioOutcome = {
  mode: ScenarioMode;
  investment: number;
  annualImpact: number | null;
  riskChange: number;
  note: string;
  /** 这是管理测算，不是财务预算 —— 每个情景都要带这句边界 */
  caveat: string;
};

export const SCENARIO_MODES: readonly ScenarioMode[] = ["不行动", "维修延寿", "更新替换", "共享调拨"];

/**
 * 边界声明跟着每个情景走，而不是只写在页面标题上。
 *
 * 情景数会被截图、被复制进立项材料，一旦离开页面就没人记得它是管理口径的估算。
 */
const SCENARIO_CAVEAT = "管理测算口径：由当期填报年化推算，不含物价与政策变动，正式立项时须替换为财务确认值。";

/** 维修延寿的投入下限，搬自 CapitalPlanningCenter.scenario() 的 20 万元 */
const REPAIR_INVESTMENT_FLOOR = 20 * WAN;

export function scenarioFor(diagnosis: DeviceDiagnosis, mode: ScenarioMode): ScenarioOutcome {
  const facts = diagnosis.facts;
  const annualMargin = annualize(facts.margin, facts.periodCount);
  const annualRevenue = annualize(facts.revenue, facts.periodCount);
  const usefulLife = facts.usefulLifeYears > 0 ? facts.usefulLifeYears : DEFAULT_USEFUL_LIFE_YEARS;

  if (mode === "不行动") {
    return {
      mode,
      investment: 0,
      annualImpact: money(annualMargin),
      riskChange: 0,
      note: "维持当前运行与维护策略，年度结余按当期结余年化推算",
      caveat: SCENARIO_CAVEAT,
    };
  }

  if (mode === "维修延寿") {
    // 年维护支出由「维护收入比 × 年收入」还原，口径与 classify 的 cost.maintenance 一致，只是改从填报推
    const annualMaintenance =
      annualRevenue === null || facts.maintenanceRatio === null ? null : (annualRevenue * facts.maintenanceRatio) / 100;
    const investment = Math.max(REPAIR_INVESTMENT_FLOOR, (annualMaintenance ?? 0) * 0.45);
    return {
      mode,
      investment: Math.round(investment),
      annualImpact:
        annualMargin === null || annualRevenue === null
          ? null
          : money(annualMargin + annualRevenue * 0.03 - investment / 3),
      riskChange: -Math.min(22, Math.round(diagnosis.riskScore * 0.3)),
      note: "按三年摊销改造投入，并估算可用率改善带来的贡献",
      caveat: SCENARIO_CAVEAT,
    };
  }

  if (mode === "更新替换") {
    // 原口径用台账的年折旧额估净值；填报里没有累计折旧，改用直线法（原值 ÷ 折旧年限 × 已用年数）近似
    const straightLineDepreciation = (facts.investment / usefulLife) * facts.age;
    const investment = Math.max(facts.investment * 0.82, facts.investment - straightLineDepreciation);
    return {
      mode,
      investment: Math.round(investment),
      annualImpact:
        annualMargin === null || annualRevenue === null
          ? null
          : money(Math.max(annualMargin, annualRevenue * 0.16) - investment / usefulLife),
      riskChange: -Math.min(55, diagnosis.riskScore),
      note: "以替换估算价和预计寿命进行管理情景测算",
      caveat: SCENARIO_CAVEAT,
    };
  }

  /*
   * 共享调拨：设备不动、排班并到需求更大的科室，所以新增投入为 0。
   * 收益按「使用率补到阈值」等比例推收入增量，再打对折留给随量增长的耗材与人力——
   * 调拨只是把闲置时段填满，不会凭空提高单次收费，估高了就成了拍脑袋的立项理由。
   * 使用率已达标或缺数时增量为 0：这台设备本来就不该走调拨。
   * 阈值取出厂值而非医院覆盖值——签名里只有诊断结果，没有 thresholds；调拨的目标线是「补到常规水平」，
   * 跟着各院自定义的预警线走反而会让同一台设备在两个院区算出两种调拨收益。
   */
  const gap =
    facts.utilization === null || facts.utilization <= 0
      ? 0
      : Math.max(0, DEFAULT_DIAGNOSIS_THRESHOLDS.utilizationFloor - facts.utilization) / facts.utilization;
  return {
    mode,
    investment: 0,
    annualImpact:
      annualMargin === null || annualRevenue === null ? null : money(annualMargin + annualRevenue * gap * 0.5),
    riskChange: -Math.min(12, Math.round(diagnosis.riskScore * 0.15)),
    note: "不新增投入，按使用率补到阈值等比例估算收入增量，并预留一半作为随量增长的成本",
    caveat: SCENARIO_CAVEAT,
  };
}
