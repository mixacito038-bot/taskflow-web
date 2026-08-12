import assert from "node:assert/strict";
import test from "node:test";

import {
  CHART_KIND_LABELS,
  COCKPIT_DIMENSION_PRESETS,
  DEFAULT_CHART_TEMPLATES,
  METRIC_VALUE_BINDINGS,
  computeChartSeries,
  defaultMetricCockpitConfig,
  normalizeCockpitConfig,
} from "../app/chart-template-catalog.ts";

/*
 * 夹具就地声明，不 import 填报模块：这份测试只验图表数据层的算法，
 * 字段目录当成外部输入（真实调用方传的是 mergeReportFields 的结果，各院可能不一样），
 * 就地造夹具能让「医院改过字段」的情形也被这套断言覆盖到。
 */
const field = (key, labelPattern, unit, extra = {}) => ({
  key,
  labelPattern,
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
  field("usageDays", "{期}使用天数", "天", { order: 1 }),
  field("usageHours", "{期}使用时间", "小时", { order: 2 }),
  field("faultHours", "故障时间", "小时", { order: 3 }),
  field("examVolume", "{期}检查人数/项目", "人次", { order: 4, source: "import" }),
  field("positiveCount", "检阳性数", "例", { order: 5, source: "import" }),
  field("totalRevenue", "总收入", "元", { order: 6, source: "import" }),
  field("consumableCost", "直接耗材支出", "元", { order: 7, countsToCost: true }),
  field("repairFee", "{期}维修费", "元", { order: 8, countsToCost: true }),
  field("laborCost", "人员成本支出", "元", { order: 9, countsToCost: true }),
];

/** 6 月 30 天、7 月 31 天：跨月比率的分母口径全靠这两个不同的天数才验得出来 */
const JUNE = { granularity: "month", key: "2026-06", label: "6月", start: "2026-06-01", end: "2026-06-30", days: 30 };
const JULY = { granularity: "month", key: "2026-07", label: "7月", start: "2026-07-01", end: "2026-07-31", days: 31 };

const DEVICES = [
  { id: "dev-1", department: "放射科", name: "CT-64排" },
  { id: "dev-2", department: "超声科", name: "彩超-A" },
];

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

const makeCtx = (overrides = {}) => ({
  devices: DEVICES,
  records: [],
  onlyConfirmed: true,
  periods: [JUNE, JULY],
  fields: FIELDS,
  workloadOf: () => undefined,
  ...overrides,
});

const HOSPITAL = { level: "hospital" };

const sumTemplate = (source, groupBy = "device", chartKind = "stat") => ({ chartKind, source, aggregation: "sum", groupBy });

const rateTemplate = (numerator, denominator, percent, groupBy = "department") => ({
  chartKind: "stat",
  source: numerator,
  aggregation: "rate",
  rate: { numerator, denominator, percent },
  groupBy,
});

const reportField = (fieldKey) => ({ kind: "reportField", fieldKey });

/** 消费方 matchTemplate 的同款逻辑：先「取值 + 聚合」全等，再退到取值一致 */
const sourceKey = (source) => (source.kind === "reportField" ? `field:${source.fieldKey}` : source.kind);

const matchTemplate = (binding, templates) =>
  templates.find((item) => sourceKey(item.source) === sourceKey(binding.source) && item.aggregation === binding.aggregation) ??
  templates.find((item) => sourceKey(item.source) === sourceKey(binding.source)) ??
  null;

/* ------------------------------------------------------------------ 计算规则 */

test("比率先合计再相除，绝不对各设备的比率取平均", () => {
  // 15/30 天 与 30/31 天：正确口径是 45 ÷ 61 = 73.8%；
  // 若先算每台再平均会得到 (50 + 96.8) / 2 = 73.4%，两个数都「像对的」，
  // 上报出去差 0.4 个百分点没人看得出来，所以这条是整份文件最要命的一条。
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { usageDays: "15" }), record("dev-2", JULY.key, { usageDays: "30" })],
  });
  const series = computeChartSeries(rateTemplate(reportField("usageDays"), "calendarDays", true), HOSPITAL, ctx);
  assert.equal(series.total, 73.8);
  assert.notEqual(series.total, 73.4);
  assert.equal(series.unavailable, false);
});

test("按科室分组时每组各自重算比率，不是拿总比率分摊", () => {
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { usageDays: "15" }), record("dev-2", JULY.key, { usageDays: "30" })],
  });
  const series = computeChartSeries(rateTemplate(reportField("usageDays"), "calendarDays", true), HOSPITAL, ctx);
  assert.deepEqual(series.points, [
    { label: "放射科", value: 50 },
    { label: "超声科", value: 96.8 },
  ]);
  // 总数不等于两组的平均，也不等于任何一组：说明各组是各自的分子和 ÷ 分母和
  assert.equal(series.total, 73.8);
});

test("分母为 0 时返回 null，绝不出现 Infinity 或 NaN", () => {
  // 检查人次为 0 的设备期（导入表里确实会有：设备当月没开机）
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { usageDays: "10" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { examVolume: "0", positiveCount: "3" } }),
  });
  const series = computeChartSeries(
    rateTemplate(reportField("positiveCount"), { fieldKey: "examVolume" }, true),
    HOSPITAL,
    ctx,
  );
  assert.equal(series.total, null);
  assert.equal(series.unavailable, true);
  assert.match(series.unavailableReason, /分母/);
  for (const point of series.points) {
    assert.equal(point.value, null);
    assert.ok(point.value !== Infinity && !Number.isNaN(point.value), "分母为 0 不允许漏出 Infinity/NaN");
  }
});

test("全部缺数时 total 为 null 且标记不可用，理由是人话", () => {
  // 有填报记录但这个字段一项没填：不能显示成 0 元，那会被当成「真的没花钱」
  const ctx = makeCtx({ records: [record("dev-1", JUNE.key, { usageDays: "10" })] });
  const series = computeChartSeries(sumTemplate(reportField("consumableCost")), HOSPITAL, ctx);
  assert.equal(series.total, null);
  assert.equal(series.unavailable, true);
  assert.match(series.unavailableReason, /直接耗材支出/);
});

test("部分缺数时有数的照样求和，缺的那个点是 null 而不是 0", () => {
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { consumableCost: "100" }), record("dev-2", JULY.key, { usageDays: "20" })],
  });
  const series = computeChartSeries(sumTemplate(reportField("consumableCost"), "device"), HOSPITAL, ctx);
  assert.equal(series.total, 100);
  assert.equal(series.unavailable, false);
  assert.deepEqual(series.points, [
    { label: "CT-64排", value: 100 },
    { label: "彩超-A", value: null },
  ]);
});

test("导入三项一律走 workloadOf，填报记录里的同名脏数据被忽略", () => {
  // 老版本或人工改过的草稿里可能残留 totalRevenue，两个来源各算一个数就说不清以哪个为准
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { totalRevenue: "999999", consumableCost: "100" })],
    workloadOf: workloadTable({ "dev-1|2026-06": { totalRevenue: "80000" } }),
  });
  const revenue = computeChartSeries(sumTemplate(reportField("totalRevenue")), HOSPITAL, ctx);
  assert.equal(revenue.total, 80000);
  // 结余同样以导入值为准：80000 − 100
  const margin = computeChartSeries(sumTemplate({ kind: "margin" }), HOSPITAL, ctx);
  assert.equal(margin.total, 79900);
});

test("设备当期没有填报记录时，导入的收入不计入合计", () => {
  // 否则「未填报的设备」会把收入算进来却不算成本，结余凭空变厚，这种假结余比没有数更危险
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { consumableCost: "100" })],
    workloadOf: workloadTable({
      "dev-1|2026-06": { totalRevenue: "80000" },
      "dev-2|2026-06": { totalRevenue: "50000" },
      "dev-2|2026-07": { totalRevenue: "60000" },
    }),
  });
  const series = computeChartSeries(sumTemplate(reportField("totalRevenue")), HOSPITAL, ctx);
  assert.equal(series.total, 80000);
  assert.deepEqual(series.points, [
    { label: "CT-64排", value: 80000 },
    { label: "彩超-A", value: null },
  ]);
});

test("科室口径只加本科室名下的设备", () => {
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { consumableCost: "100" }), record("dev-2", JUNE.key, { consumableCost: "40" })],
  });
  const radiology = computeChartSeries(sumTemplate({ kind: "totalCost" }), { level: "department", department: "放射科" }, ctx);
  assert.equal(radiology.total, 100);
  const hospital = computeChartSeries(sumTemplate({ kind: "totalCost" }), HOSPITAL, ctx);
  assert.equal(hospital.total, 140);
  const single = computeChartSeries(sumTemplate({ kind: "totalCost" }), { level: "device", deviceId: "dev-2" }, ctx);
  assert.equal(single.total, 40);
});

test("按期间分组逐期出点，跨两期的 total 是两期之和", () => {
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { usageDays: "10" }), record("dev-1", JULY.key, { usageDays: "10" })],
    workloadOf: workloadTable({
      "dev-1|2026-06": { totalRevenue: "100" },
      "dev-1|2026-07": { totalRevenue: "200" },
    }),
  });
  const series = computeChartSeries(sumTemplate(reportField("totalRevenue"), "period", "line"), HOSPITAL, ctx);
  assert.deepEqual(series.points, [
    { label: "6月", value: 100 },
    { label: "7月", value: 200 },
  ]);
  assert.equal(series.total, 300);
});

test("正式口径下填报中、已提交的记录都不计入", () => {
  // 已确认的数才是对外口径；草稿混进汇报数字里，等于拿没人签字的数做决策
  const records = [
    record("dev-1", JUNE.key, { consumableCost: "100" }, "draft"),
    record("dev-1", JULY.key, { consumableCost: "70" }, "submitted"),
    record("dev-2", JULY.key, { consumableCost: "50" }, "confirmed"),
    record("dev-2", JUNE.key, { consumableCost: "1000" }, "returned"),
  ];
  const strict = computeChartSeries(sumTemplate({ kind: "totalCost" }), HOSPITAL, makeCtx({ records, onlyConfirmed: true }));
  assert.equal(strict.total, 50);
  // 关掉正式口径连草稿一起算，但被退回的那条任何口径下都不算：科室还得重填
  const loose = computeChartSeries(sumTemplate({ kind: "totalCost" }), HOSPITAL, makeCtx({ records, onlyConfirmed: false }));
  assert.equal(loose.total, 220);
});

test("金额取整、百分比一位小数、其余保留一位小数", () => {
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { usageDays: "1", usageHours: "10" }), record("dev-1", JULY.key, {})],
    workloadOf: workloadTable({
      "dev-1|2026-06": { totalRevenue: "100.44" },
      "dev-1|2026-07": { totalRevenue: "100.44" },
    }),
  });
  // 元：驾驶舱上不显示分，200.88 → 201
  assert.equal(computeChartSeries(sumTemplate(reportField("totalRevenue")), HOSPITAL, ctx).total, 201);
  // 百分比：1 ÷ 61 天 × 100 = 1.639… → 1.6
  assert.equal(computeChartSeries(rateTemplate(reportField("usageDays"), "calendarDays", true), HOSPITAL, ctx).total, 1.6);
  // 非金额非百分比：10 小时 ÷ 61 天 = 0.163… → 0.2
  assert.equal(computeChartSeries(rateTemplate(reportField("usageHours"), "calendarDays", false), HOSPITAL, ctx).total, 0.2);
});

test("成本构成按计入成本的字段逐项拆开，各点之和就是总成本", () => {
  const ctx = makeCtx({
    records: [record("dev-1", JUNE.key, { consumableCost: "100", repairFee: "20" })],
  });
  const series = computeChartSeries(
    { chartKind: "pie", source: { kind: "costBreakdown" }, aggregation: "sum", groupBy: "costField" },
    HOSPITAL,
    ctx,
  );
  assert.equal(series.total, 120);
  assert.deepEqual(
    series.points.filter((point) => point.value !== null),
    [
      { label: "直接耗材支出", value: 100 },
      { label: "月维修费", value: 20 },
    ],
  );
});

/* ------------------------------------------------------------------ 模板与绑定 */

test("出厂模板五种图型都有，且全部标记为内置", () => {
  const kinds = new Set(DEFAULT_CHART_TEMPLATES.map((template) => template.chartKind));
  for (const kind of Object.keys(CHART_KIND_LABELS)) {
    assert.ok(kinds.has(kind), `出厂模板缺少 ${CHART_KIND_LABELS[kind]}`);
  }
  assert.ok(DEFAULT_CHART_TEMPLATES.length >= 10);
  assert.ok(DEFAULT_CHART_TEMPLATES.every((template) => template.builtin));
  assert.equal(new Set(DEFAULT_CHART_TEMPLATES.map((template) => template.id)).size, DEFAULT_CHART_TEMPLATES.length);
  // 图型标签的首字被消费方拿去当按钮图标，撞字就没法区分点的是哪个图型
  const initials = Object.values(CHART_KIND_LABELS).map((label) => label.charAt(0));
  assert.equal(new Set(initials).size, initials.length);
});

test("绑定表恰好覆盖 metric-1 … metric-17 全 17 条，一条不落", () => {
  // 少一条就是指标字典里那条指标在配置页上连「未接入」徽标都判断不出来
  const expected = Array.from({ length: 17 }, (_, index) => `metric-${index + 1}`);
  assert.deepEqual(Object.keys(METRIC_VALUE_BINDINGS).sort(), [...expected].sort());
  for (const id of expected) {
    const binding = METRIC_VALUE_BINDINGS[id];
    if (binding === null) continue;
    assert.ok(binding.note.trim(), `${id} 的算法说明不能为空`);
    assert.ok(binding.unit !== undefined, `${id} 缺单位`);
    if (binding.aggregation === "rate") assert.ok(binding.rate, `${id} 是比率却没有分子分母`);
  }
});

test("算不出来的指标一律绑 null，并写清缺哪个字段", () => {
  // 宁可空着也不能凑口径：这四条在填报里根本没有对应的数
  for (const id of ["metric-5", "metric-11", "metric-12", "metric-14"]) {
    assert.equal(METRIC_VALUE_BINDINGS[id], null, `${id} 不该被凑一个口径`);
  }
});

test("每个非 null 绑定都能在出厂模板里匹配到模板", () => {
  // 匹配不上的绑定 = 驾驶舱上一张永远空着的卡片，用户只会以为系统坏了
  for (const [id, binding] of Object.entries(METRIC_VALUE_BINDINGS)) {
    if (!binding) continue;
    const template = matchTemplate(binding, DEFAULT_CHART_TEMPLATES);
    assert.ok(template, `${id} 的绑定在模板库里没有对应模板`);
    assert.equal(sourceKey(template.source), sourceKey(binding.source));
  }
});

test("预设视角只引用绑定非 null 的指标", () => {
  assert.deepEqual(COCKPIT_DIMENSION_PRESETS.map((preset) => preset.id), ["leader", "department", "board"]);
  for (const preset of COCKPIT_DIMENSION_PRESETS) {
    assert.ok(preset.entryIds.length >= 4, `${preset.label} 的默认指标太少`);
    for (const entryId of preset.entryIds) {
      assert.ok(METRIC_VALUE_BINDINGS[entryId], `${preset.label} 引用了未接入的 ${entryId}`);
    }
  }
  assert.equal(COCKPIT_DIMENSION_PRESETS.find((preset) => preset.id === "department").defaultScope, "department");
});

/* ------------------------------------------------------------------ 配置收拾 */

test("默认配置取领导视角，每张卡片都配好了模板", () => {
  const config = defaultMetricCockpitConfig();
  const leader = COCKPIT_DIMENSION_PRESETS.find((preset) => preset.id === "leader");
  assert.equal(config.dimension, "leader");
  assert.equal(config.onlyConfirmed, true);
  assert.deepEqual(config.items.map((item) => item.entryId), [...leader.entryIds]);
  assert.deepEqual(config.items.map((item) => item.order), leader.entryIds.map((_, index) => index));
  assert.ok(config.items.every((item) => item.templateId), "默认卡片不该出现空模板");
});

test("云端读回的脏配置：剔除未知条目、非法维度回退、order 重排", () => {
  const validEntryIds = new Set(["metric-1", "metric-2", "metric-3"]);
  const config = normalizeCockpitConfig(
    {
      dimension: "总院视角",
      department: "放射科",
      onlyConfirmed: "yes",
      items: [
        { entryId: "metric-3", templateId: "builtin-margin-total", chartKind: "stat", size: "small", order: 9 },
        { entryId: "metric-99", templateId: "builtin-cost-total", chartKind: "stat", size: "small", order: 0 },
        { entryId: "metric-2", templateId: "已被删掉的模板", chartKind: "stat", size: "small", order: 1 },
        { entryId: "metric-1", templateId: "builtin-revenue-total", chartKind: "三维图", size: "巨大", order: 4 },
        { entryId: "metric-1", templateId: "builtin-revenue-total", chartKind: "stat", size: "small", order: 5 },
        "这不是一个对象",
      ],
    },
    validEntryIds,
    DEFAULT_CHART_TEMPLATES,
  );
  assert.equal(config.dimension, "leader");
  assert.equal(config.department, "放射科");
  // onlyConfirmed 不是布尔就当没设置，回到「只看已确认」的安全默认
  assert.equal(config.onlyConfirmed, true);
  assert.deepEqual(config.items.map((item) => item.entryId), ["metric-1", "metric-3"]);
  assert.deepEqual(config.items.map((item) => item.order), [0, 1]);
  // 非法图型和尺寸各自回退到该指标的默认值，而不是把整张卡丢掉
  assert.equal(config.items[0].chartKind, METRIC_VALUE_BINDINGS["metric-1"].defaultChart);
  assert.equal(config.items[0].size, "small");
});

test("配置不是对象时整段回退到默认配置", () => {
  const validEntryIds = new Set(Object.keys(METRIC_VALUE_BINDINGS));
  for (const raw of [null, undefined, "{}", 42, []]) {
    const config = normalizeCockpitConfig(raw, validEntryIds, DEFAULT_CHART_TEMPLATES);
    assert.equal(config.dimension, "leader");
    assert.ok(config.items.length > 0, "回退后的看板不能是空的");
  }
});

test("items 缺失时按该视角的默认组合补齐，并过滤掉已删除的指标", () => {
  const config = normalizeCockpitConfig(
    { dimension: "board", department: "", onlyConfirmed: false },
    new Set(["metric-1", "metric-2"]),
    DEFAULT_CHART_TEMPLATES,
  );
  assert.equal(config.dimension, "board");
  assert.equal(config.onlyConfirmed, false);
  assert.deepEqual(config.items.map((item) => item.entryId), ["metric-1", "metric-2"]);
  assert.deepEqual(config.items.map((item) => item.order), [0, 1]);
});
