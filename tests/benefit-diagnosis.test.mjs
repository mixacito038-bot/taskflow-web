import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DIAGNOSIS_THRESHOLDS,
  SCENARIO_MODES,
  buildDiagnoses,
  departmentRollup,
  diagnosisSummary,
  scenarioFor,
} from "../app/benefit-diagnosis.ts";

/*
 * 夹具就地声明，不 import 填报模块和演示数据：这份测试只验诊断内核的算法。
 * 字段目录是外部输入（真实调用方传的是 mergeReportFields 的结果，各院可能改过），
 * 就地造夹具能让「医院改过字段」的情形也被这套断言覆盖到。
 */
const field = (key, unit, extra = {}) => ({
  key,
  labelPattern: key,
  unit,
  groupId: extra.groupId ?? "other",
  type: "decimal",
  required: false,
  source: extra.source ?? "manual",
  countsToCost: extra.countsToCost ?? false,
  hint: "",
  order: extra.order ?? 1,
  builtin: true,
});

const FIELDS = [
  field("usageDays", "天", { order: 1 }),
  field("usageHours", "小时", { order: 2 }),
  field("faultHours", "小时", { order: 3 }),
  field("examVolume", "人次", { order: 4, source: "import" }),
  field("positiveCount", "例", { order: 5, source: "import" }),
  field("totalRevenue", "元", { order: 6, source: "import" }),
  field("consumableCost", "元", { order: 7, countsToCost: true }),
  field("repairFee", "元", { order: 8, countsToCost: true }),
  field("maintenanceFee", "元", { order: 9, countsToCost: true }),
];

/** 6 月 30 天、7 月 31 天：跨月比率的分母口径全靠这两个不同的天数才验得出来 */
const JUNE = { granularity: "month", key: "2026-06", label: "6月", start: "2026-06-01", end: "2026-06-30", days: 30 };
const JULY = { granularity: "month", key: "2026-07", label: "7月", start: "2026-07-01", end: "2026-07-31", days: 31 };

/** 统计期间落在 2026 年：设备年龄按期末年份算，与 CapitalPlanningCenter.classify() 里写死的 2026 对齐 */
const PERIODS = [JUNE, JULY];

const emptyCost = { labor: 0, consumables: 0, depreciation: 0, maintenance: 0, energy: 0, space: 0, indirect: 0 };

/** 台账金额一律「万元」，诊断内核换算成「元」；这里保持台账原单位，换算错了才验得出来 */
const device = (id, extra = {}) => ({
  id,
  assetCode: `YLSB-${id}`,
  name: extra.name ?? `设备${id}`,
  shortName: extra.name ?? `设备${id}`,
  model: "M-100",
  department: extra.department ?? "放射科",
  enabledDate: extra.enabledDate ?? "2023-01-01",
  usefulLifeYears: extra.usefulLifeYears ?? 10,
  investment: extra.investment ?? 100,
  quantity: 1,
  serviceVolume: extra.serviceVolume ?? 1000,
  serviceUnit: "人次",
  revenue: extra.revenue ?? 500,
  utilization: extra.utilization ?? 80,
  planPayback: extra.planPayback ?? 5,
  forecastPayback: extra.forecastPayback ?? 6,
  status: "在用",
  cost: { ...emptyCost, ...(extra.cost ?? {}) },
});

const record = (deviceId, periodKey, values, status = "confirmed") => ({
  deviceId,
  periodKey,
  values,
  status,
  updatedAt: "2026-08-01T00:00:00.000Z",
  updatedBy: "测试",
});

/** 业务量三项只能从这里出，模拟数据准备中心的导入表 */
const workloadTable = (table) => (deviceId, periodKey) => table[`${deviceId}|${periodKey}`];

const makeInput = (overrides = {}) => ({
  devices: [device("dev-1")],
  records: [],
  periods: PERIODS,
  fields: FIELDS,
  workloadOf: () => undefined,
  onlyConfirmed: true,
  ...overrides,
});

const factsOf = (input, index = 0) => buildDiagnoses(input)[index].facts;

const codesOf = (diagnosis) => diagnosis.findings.map((finding) => finding.code);

/* ------------------------------------------------------------------ 取数口径 */

test("业务量三项只认 workloadOf，填报记录里的同名脏数据一律忽略", () => {
  // 收入有两个来源就说不清以哪个为准：草稿里手抄的 999999 必须一点都不能渗进结余。
  const input = makeInput({
    records: [record("dev-1", JUNE.key, { totalRevenue: "999999", consumableCost: "1000" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "5000", examVolume: "100" } }),
  });
  const facts = factsOf(input);
  assert.equal(facts.revenue, 5000);
  assert.equal(facts.cost, 1000);
  assert.equal(facts.margin, 4000);
});

test("已退回的记录在两种口径下都不计入", () => {
  // 被退回的数科室还得重填，算进去等于拿一份被打回的账去汇报。
  for (const onlyConfirmed of [true, false]) {
    const input = makeInput({
      onlyConfirmed,
      records: [record("dev-1", JUNE.key, { consumableCost: "800" }, "returned")],
      workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "9000" } }),
    });
    const facts = factsOf(input);
    assert.equal(facts.hasReport, false, `onlyConfirmed=${onlyConfirmed} 时不该有可用记录`);
    assert.equal(facts.revenue, null);
    assert.equal(facts.cost, null);
  }
});

test("onlyConfirmed=true 时填报中与已提交都不计入，false 时才计入", () => {
  // 正式口径的数是拿去汇报的，没人认过的草稿混进去等于按未确认的数做决策。
  const records = [
    record("dev-1", JUNE.key, { consumableCost: "1000" }, "draft"),
    record("dev-1", JULY.key, { consumableCost: "2000" }, "submitted"),
  ];
  const workloadOf = workloadTable({
    "dev-1|2026-06": { totalRevenue: "4000" },
    "dev-1|2026-07": { totalRevenue: "6000" },
  });
  assert.equal(factsOf(makeInput({ records, workloadOf, onlyConfirmed: true })).hasReport, false);
  const loose = factsOf(makeInput({ records, workloadOf, onlyConfirmed: false }));
  assert.equal(loose.hasReport, true);
  assert.equal(loose.revenue, 10000);
  assert.equal(loose.cost, 3000);
});

test("未填报设备的导入收入不进合计，否则会算收入不算成本", () => {
  // 这是整份文件最要命的一条：假结余比没有数更危险，它会让一台没人填成本的设备看起来最赚钱。
  const input = makeInput({
    devices: [device("dev-1"), device("dev-2")],
    records: [record("dev-1", JUNE.key, { consumableCost: "1000" })],
    workloadOf: workloadTable({
      "dev-1|2026-06": { totalRevenue: "5000" },
      "dev-2|2026-06": { totalRevenue: "999999" },
    }),
  });
  const summary = diagnosisSummary(buildDiagnoses(input));
  assert.equal(summary.revenue, 5000);
  assert.equal(summary.cost, 1000);
  assert.equal(summary.margin, 4000);
  assert.equal(summary.reported, 1);
});

test("使用率按分子和÷分母和重算，不是各期百分比的平均", () => {
  // 30/30 与 15/31：正确口径是 45 ÷ 61 = 73.8%；先算每期再平均会得到 74.2%。
  // 两个数都「像对的」，上报出去差 0.4 个百分点没人看得出来。
  const input = makeInput({
    records: [record("dev-1", JUNE.key, { usageDays: "30" }), record("dev-1", JULY.key, { usageDays: "15" })],
  });
  const facts = factsOf(input);
  assert.equal(facts.utilization, 73.8);
  assert.notEqual(facts.utilization, 74.2);
});

test("分母为 0 时返回 null，绝不出现 Infinity 或 NaN", () => {
  // Infinity 会一路渗到界面上显示成「∞ 元/人次」，比空着难解释得多。
  const input = makeInput({
    records: [record("dev-1", JUNE.key, { consumableCost: "500", repairFee: "100" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "0", examVolume: "0" } }),
  });
  const facts = factsOf(input);
  assert.equal(facts.costPerExam, null);
  assert.equal(facts.maintenanceRatio, null);
  for (const value of [facts.costPerExam, facts.maintenanceRatio, facts.utilization, facts.integrity]) {
    assert.notEqual(value, Infinity);
    assert.notEqual(value, -Infinity);
    assert.equal(Number.isNaN(value), false);
  }
});

test("成本只累计 countsToCost 的字段，使用天数这类非成本项不进合计", () => {
  // 把使用天数算进成本合计是最典型的静默污染：数字看起来只多了 30，谁也不会去查。
  const input = makeInput({
    records: [record("dev-1", JUNE.key, { usageDays: "30", consumableCost: "1000", repairFee: "200", maintenanceFee: "300" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "10000" } }),
  });
  const facts = factsOf(input);
  assert.equal(facts.cost, 1500);
  assert.equal(facts.maintenanceRatio, 5);
});

test("完好率按（Σ使用时间 − Σ故障时间）÷ Σ使用时间 算，故障时间全缺时为 null", () => {
  // 故障时间没人填就按 0 算，会让完好率变成 100%——一台没人管的设备反而成了全院最健康的。
  const filled = makeInput({
    records: [
      record("dev-1", JUNE.key, { usageHours: "100", faultHours: "10" }),
      record("dev-1", JULY.key, { usageHours: "100", faultHours: "0" }),
    ],
  });
  assert.equal(factsOf(filled).integrity, 95);
  const missing = makeInput({ records: [record("dev-1", JUNE.key, { usageHours: "100" })] });
  assert.equal(factsOf(missing).integrity, null);
});

/* ------------------------------------------------------------------ 问题判定 */

test("缺数不产生问题，只报一条 no_data", () => {
  // 没填报不等于设备有毛病，硬判会把处置资源引到填报缺口以外的地方。
  const diagnoses = buildDiagnoses(makeInput());
  assert.deepEqual(codesOf(diagnoses[0]), ["no_data"]);
  assert.equal(diagnoses[0].findings[0].route, "data");
  assert.equal(diagnoses[0].findings[0].severity, "medium");
  assert.equal(diagnoses[0].quadrant, "待补数");
});

test("每条问题的证据都带实际值和阈值", () => {
  // 证据要能被科室当场核对；只写「使用率偏低」的结论没人认，写清数字才吵得清。
  const input = makeInput({
    devices: [device("dev-1", { enabledDate: "2018-01-01", planPayback: 3 }), device("dev-2")],
    records: [
      record("dev-1", JUNE.key, { usageDays: "6", usageHours: "100", faultHours: "20", consumableCost: "9000", repairFee: "3000" }),
    ],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "10000", examVolume: "50" } }),
  });
  const findings = buildDiagnoses(input).flatMap((item) => item.findings);
  assert.ok(findings.length >= 4);
  for (const finding of findings) {
    const numbers = finding.evidence.match(/\d+(\.\d+)?/g) ?? [];
    assert.ok(numbers.length >= 2, `证据缺少实际值或阈值：${finding.evidence}`);
    assert.ok(finding.suggestion.trim().length > 0);
    assert.ok(["improvement", "capital", "data"].includes(finding.route));
  }
});

test("亏损设备没有回收期，paybackYears 为 null", () => {
  // 硬算出来是个负数年份，摆在页面上会被误读成「已经回本」。
  const input = makeInput({
    records: [record("dev-1", JUNE.key, { consumableCost: "20000" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "10000" } }),
  });
  const diagnosis = buildDiagnoses(input)[0];
  assert.equal(diagnosis.facts.margin, -10000);
  assert.equal(diagnosis.facts.paybackYears, null);
  assert.ok(codesOf(diagnosis).includes("loss"));
  assert.equal(codesOf(diagnosis).includes("payback_delay"), false);
});

test("回收期按期数年化推算，延后达到阈值才报 payback_delay", () => {
  // 一个月的结余当成一年会把回收期算短 12 倍，年化口径错了整条资本计划都跟着错。
  const input = makeInput({
    devices: [device("dev-1", { investment: 100, planPayback: 3 })],
    records: [record("dev-1", JUNE.key, { consumableCost: "90000" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "100000" } }),
  });
  const diagnosis = buildDiagnoses(input)[0];
  // 月结余 1 万 → 年结余 12 万；投资 100 万元 = 1,000,000 元 → 8.3 年
  assert.equal(diagnosis.facts.paybackYears, 8.3);
  assert.ok(codesOf(diagnosis).includes("payback_delay"));
});

test("阈值可以覆盖：使用率线调到 5% 后不再报 low_utilization", () => {
  // 各院的管理线不同，覆盖阈值是内核的正当用法；但覆盖只能有一个入口，不能各页面各改各的。
  const base = {
    records: [record("dev-1", JUNE.key, { usageDays: "6", consumableCost: "100" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "10000" } }),
  };
  assert.ok(codesOf(buildDiagnoses(makeInput(base))[0]).includes("low_utilization"));
  const relaxed = buildDiagnoses(makeInput({ ...base, thresholds: { utilizationFloor: 5 } }))[0];
  assert.equal(codesOf(relaxed).includes("low_utilization"), false);
  assert.equal(DEFAULT_DIAGNOSIS_THRESHOLDS.utilizationFloor, 55, "出厂阈值不该被覆盖调用改掉");
});

/* ------------------------------------------------------------------ 分档与象限 */

/** CapitalPlanningCenter.classify() 的 if 链原样抄过来，用于验证内核没有偷偷改分档口径 */
const classifyBand = (facts, riskScore, floor = DEFAULT_DIAGNOSIS_THRESHOLDS.utilizationFloor) => {
  const lowUtilization = facts.utilization !== null && facts.utilization < floor;
  const highMaintenance = facts.maintenanceRatio !== null && facts.maintenanceRatio >= 12;
  if (facts.remainingLife <= 0 && riskScore >= 65) return "必须替换";
  if (facts.remainingLife <= 2 || riskScore >= 60) return "计划替换";
  if (lowUtilization && facts.age < facts.usefulLifeYears * 0.7) return "共享调拨";
  if (facts.remainingLife <= 4 || highMaintenance) return "可延寿";
  return "持续观察";
};

test("处置分档与 CapitalPlanningCenter.classify() 同口径", () => {
  // 分档口径分叉的代价：院长在分析页看到「该换」，在资本计划看到「可延寿」。
  const input = makeInput({
    devices: [
      // 已到寿命 + 低使用率 + 高维护比 → 风险分过 65
      device("old", { enabledDate: "2016-01-01", usefulLifeYears: 10 }),
      // 剩余寿命 2 年，边界值
      device("plan", { enabledDate: "2018-01-01", usefulLifeYears: 10 }),
      // 年轻但闲置
      device("idle", { enabledDate: "2023-01-01", usefulLifeYears: 10 }),
      // 各项都在可接受区间
      device("fine", { enabledDate: "2023-01-01", usefulLifeYears: 10 }),
    ],
    records: [
      record("old", JUNE.key, { usageDays: "6", consumableCost: "20000", repairFee: "2000" }),
      record("plan", JUNE.key, { usageDays: "24", consumableCost: "5000", repairFee: "200" }),
      record("idle", JUNE.key, { usageDays: "15", consumableCost: "5000", repairFee: "500" }),
      record("fine", JUNE.key, { usageDays: "24", consumableCost: "5000", repairFee: "200" }),
    ],
    workloadOf: workloadTable({
      "old|2026-06": { totalRevenue: "10000" },
      "plan|2026-06": { totalRevenue: "100000" },
      "idle|2026-06": { totalRevenue: "100000" },
      "fine|2026-06": { totalRevenue: "100000" },
    }),
  });
  const byId = new Map(buildDiagnoses(input).map((item) => [item.facts.deviceId, item]));
  for (const [id, item] of byId) {
    assert.equal(item.band, classifyBand(item.facts, item.riskScore), `${id} 的分档与 classify 口径不一致`);
  }
  assert.equal(byId.get("old").facts.remainingLife, 0);
  assert.ok(byId.get("old").riskScore >= 65);
  assert.equal(byId.get("old").band, "必须替换");
  assert.equal(byId.get("plan").facts.remainingLife, 2);
  assert.equal(byId.get("plan").band, "计划替换");
  assert.equal(byId.get("idle").band, "共享调拨");
  assert.equal(byId.get("fine").band, "持续观察");
});

test("效益四象限五种都能落到", () => {
  // 「待补数」必须和「问题」分得开：没填报的设备被画进问题象限，等于拿缺数当亏损上报。
  const input = makeInput({
    devices: [device("star"), device("potential"), device("weak"), device("bad"), device("blank")],
    records: [
      record("star", JUNE.key, { usageDays: "24", consumableCost: "1000" }),
      record("potential", JUNE.key, { usageDays: "9", consumableCost: "1000" }),
      record("weak", JUNE.key, { usageDays: "24", consumableCost: "50000" }),
      record("bad", JUNE.key, { usageDays: "9", consumableCost: "50000" }),
    ],
    workloadOf: workloadTable({
      "star|2026-06": { totalRevenue: "10000" },
      "potential|2026-06": { totalRevenue: "10000" },
      "weak|2026-06": { totalRevenue: "10000" },
      "bad|2026-06": { totalRevenue: "10000" },
    }),
  });
  const byId = new Map(buildDiagnoses(input).map((item) => [item.facts.deviceId, item.quadrant]));
  assert.equal(byId.get("star"), "明星");
  assert.equal(byId.get("potential"), "潜力");
  assert.equal(byId.get("weak"), "低效");
  assert.equal(byId.get("bad"), "问题");
  assert.equal(byId.get("blank"), "待补数");
});

/* ------------------------------------------------------------------ 汇总 */

test("科室汇总按结余从低到高排，使用率也是重算不是平均", () => {
  // 最该管的科室排最前；缺数的科室排最后，它不是「亏得最狠」。
  const input = makeInput({
    devices: [
      device("a1", { department: "放射科" }),
      device("a2", { department: "放射科" }),
      device("b1", { department: "超声科" }),
      device("c1", { department: "检验科" }),
    ],
    records: [
      record("a1", JUNE.key, { usageDays: "30", consumableCost: "30000" }),
      record("a2", JULY.key, { usageDays: "15", consumableCost: "30000" }),
      record("b1", JUNE.key, { usageDays: "30", consumableCost: "1000" }),
    ],
    workloadOf: workloadTable({
      "a1|2026-06": { totalRevenue: "10000" },
      "a2|2026-07": { totalRevenue: "10000" },
      "b1|2026-06": { totalRevenue: "50000" },
    }),
  });
  const rows = departmentRollup(buildDiagnoses(input));
  assert.deepEqual(rows.map((row) => row.department), ["放射科", "超声科", "检验科"]);
  assert.equal(rows[0].margin, -40000);
  assert.equal(rows[1].margin, 49000);
  assert.equal(rows[2].margin, null);
  // 30/30 与 15/31 → 45 ÷ 61 = 73.8%，各台平均则是 74.2%
  assert.equal(rows[0].utilization, 73.8);
  assert.notEqual(rows[0].utilization, 74.2);
  assert.equal(rows[0].deviceCount, 2);
  assert.equal(rows[0].reported, 2);
  assert.equal(rows[2].reported, 0);
});

test("全院汇总的象限与分档计数加总等于设备总数", () => {
  // 计数对不上台数，说明有设备既没落进象限也没落进分档，页面上会凭空少一台。
  const input = makeInput({
    devices: [device("d1"), device("d2"), device("d3", { enabledDate: "2016-01-01" }), device("d4")],
    records: [
      record("d1", JUNE.key, { usageDays: "24", consumableCost: "1000" }),
      record("d2", JUNE.key, { usageDays: "9", consumableCost: "90000" }),
      record("d3", JUNE.key, { usageDays: "9", consumableCost: "1000" }),
    ],
    workloadOf: workloadTable({
      "d1|2026-06": { totalRevenue: "10000" },
      "d2|2026-06": { totalRevenue: "10000" },
      "d3|2026-06": { totalRevenue: "10000" },
    }),
  });
  const summary = diagnosisSummary(buildDiagnoses(input));
  const sum = (counts) => Object.values(counts).reduce((total, value) => total + value, 0);
  assert.equal(summary.total, 4);
  assert.equal(sum(summary.quadrantCounts), 4);
  assert.equal(sum(summary.bandCounts), 4);
  assert.equal(summary.reported, 3);
  assert.equal(summary.margin, summary.revenue - summary.cost);
});

/* ------------------------------------------------------------------ 情景测算 */

test("四种处置情景齐备，缺数时 annualImpact 为 null 而不是硬算一个数", () => {
  // 没有填报就没有可年化的结余；编一个数出来，立项材料里就多了一条查无出处的收益。
  const blank = buildDiagnoses(makeInput())[0];
  assert.deepEqual([...SCENARIO_MODES], ["不行动", "维修延寿", "更新替换", "共享调拨"]);
  for (const mode of SCENARIO_MODES) {
    const outcome = scenarioFor(blank, mode);
    assert.equal(outcome.mode, mode);
    assert.equal(outcome.annualImpact, null, `${mode} 缺数时不该算出年度影响`);
    assert.ok(Number.isFinite(outcome.investment));
    assert.ok(Number.isFinite(outcome.riskChange));
  }
});

test("每个情景都带管理测算的边界声明", () => {
  // 情景数会被截图、被复制进立项材料，边界不跟着走，离开页面就没人记得它只是估算。
  const input = makeInput({
    records: [record("dev-1", JUNE.key, { usageDays: "9", consumableCost: "5000", repairFee: "1000" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "20000" } }),
  });
  const diagnosis = buildDiagnoses(input)[0];
  for (const mode of SCENARIO_MODES) {
    const outcome = scenarioFor(diagnosis, mode);
    assert.ok(outcome.caveat.trim().length > 0, `${mode} 缺少边界声明`);
    assert.ok(outcome.note.trim().length > 0);
    assert.ok(Number.isFinite(outcome.annualImpact), `${mode} 有数时应算得出年度影响`);
  }
  // 不行动就是维持现状：投入 0、风险分不变
  const stay = scenarioFor(diagnosis, "不行动");
  assert.equal(stay.investment, 0);
  assert.equal(stay.riskChange, 0);
  // 共享调拨不新增投入，且风险分小幅下降
  const share = scenarioFor(diagnosis, "共享调拨");
  assert.equal(share.investment, 0);
  assert.ok(share.riskChange < 0 && share.riskChange >= -12);
  assert.ok(scenarioFor(diagnosis, "更新替换").investment > 0);
});

/* ------------------------------------------------------------------ 兜底与稳定性 */

test("fallbackToLedger 默认 false：没填报就是没填报，不拿台账年度数冒充本期", () => {
  // 拿去年的年度汇总冒充本期，页面上看不出任何异常，等到对账时才发现整页数都是错的。
  const ledger = device("dev-1", { revenue: 500, utilization: 80, cost: { ...emptyCost, maintenance: 50 } });
  const strict = buildDiagnoses(makeInput({ devices: [ledger] }))[0];
  assert.equal(strict.facts.hasReport, false);
  assert.equal(strict.facts.revenue, null);
  assert.equal(strict.facts.utilization, null);
  assert.deepEqual(codesOf(strict), ["no_data"]);

  const relaxed = buildDiagnoses(makeInput({ devices: [ledger], fallbackToLedger: true }))[0];
  assert.equal(relaxed.facts.hasReport, false, "兜底取数不能把「没填报」说成「已填报」");
  assert.equal(relaxed.facts.revenue, 500 * 10000);
  assert.equal(relaxed.facts.cost, 50 * 10000);
  assert.equal(relaxed.facts.utilization, 80);
  assert.ok(codesOf(relaxed).includes("no_data"), "兜底取数不免除填报缺口的提示");
});

test("同一份输入调两次结果完全相同", () => {
  // 内核不读系统时钟、不带随机：跨年重跑同一份数据必须得出同一个结论，否则复盘无从谈起。
  const input = makeInput({
    devices: [device("dev-1", { enabledDate: "2016-01-01" }), device("dev-2")],
    records: [record("dev-1", JUNE.key, { usageDays: "9", usageHours: "100", faultHours: "30", consumableCost: "50000" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "10000", examVolume: "40" } }),
  });
  const first = buildDiagnoses(input);
  const second = buildDiagnoses(input);
  assert.deepEqual(second, first);
  assert.deepEqual(diagnosisSummary(second), diagnosisSummary(first));
  assert.deepEqual(departmentRollup(second), departmentRollup(first));
  assert.deepEqual(scenarioFor(second[0], "更新替换"), scenarioFor(first[0], "更新替换"));
});

test("期间口径写成人话，实报期数与应填期数不一致时如实写出来", () => {
  // 只报了 1 个月的设备，其年化结余是拿 1 个月推的；页面不写清楚，看的人会以为这是两个月的账。
  const input = makeInput({
    devices: [device("dev-1"), device("dev-2")],
    records: [
      record("dev-1", JUNE.key, { consumableCost: "100" }),
      record("dev-1", JULY.key, { consumableCost: "100" }),
      record("dev-2", JUNE.key, { consumableCost: "100" }),
    ],
  });
  const [full, partial] = buildDiagnoses(input);
  assert.equal(full.facts.periodLabel, "2026年6—7月（2 期）");
  assert.equal(full.facts.periodCount, 2);
  assert.equal(partial.facts.periodLabel, "2026年6—7月（2 期中实报 1 期）");
  assert.equal(partial.facts.periodCount, 1);
});
