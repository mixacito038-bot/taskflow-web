import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REPORT_FIELDS,
  PERIOD_FIELD_PREFIX,
  PERIOD_GRANULARITY_LABELS,
  REPORT_FIELD_GROUPS,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_TONES,
  canEditReport,
  completionStat,
  customRangePeriod,
  derivedMetrics,
  findReportRecord,
  listPeriods,
  mergeReportFields,
  reportFieldFullLabel,
  reportFieldLabel,
  reportFieldsByGroup,
  reportStatusOf,
  reportTotalCost,
  reportWarnings,
  validateReportFieldDefinition,
  validateReportValue,
  validateReportValues,
} from "../app/device-report-fields.ts";

const fieldOf = (key) => DEFAULT_REPORT_FIELDS.find((item) => item.key === key);
const monthPeriod = listPeriods("month", 2026)[6];
const metricOf = (list, key) => list.find((item) => item.key === key);

const custom = (overrides = {}) => ({
  key: "field_1", labelPattern: "科室分摊", unit: "元", groupId: "other", type: "decimal",
  required: false, source: "manual", countsToCost: false, hint: "", order: 19, builtin: false, ...overrides,
});

test("出厂 18 项齐备：key 唯一、顺序连续、分组归属正确", () => {
  assert.equal(DEFAULT_REPORT_FIELDS.length, 18);
  assert.equal(new Set(DEFAULT_REPORT_FIELDS.map((field) => field.key)).size, 18);
  // order 就是填报页的排列顺序，缺号或重号会让字段在界面上跳位
  assert.deepEqual(DEFAULT_REPORT_FIELDS.map((field) => field.order), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(DEFAULT_REPORT_FIELDS.every((field) => field.builtin));
  assert.ok(DEFAULT_REPORT_FIELDS.every((field) => !field.required), "出厂项一律非必填：医院不一定每项都有数");
  const groupIds = new Set(REPORT_FIELD_GROUPS.map((group) => group.id));
  assert.deepEqual([...groupIds], ["usage", "workload", "direct", "space", "maintenance", "other"]);
  assert.ok(DEFAULT_REPORT_FIELDS.every((field) => groupIds.has(field.groupId)), "字段的分组必须存在，否则在页面上无处可放");
  assert.deepEqual(
    DEFAULT_REPORT_FIELDS.filter((field) => field.groupId === "usage").map((field) => field.key),
    ["usageDays", "usageHours", "faultHours"],
  );
  assert.deepEqual(
    DEFAULT_REPORT_FIELDS.filter((field) => field.groupId === "space").map((field) => field.key),
    ["waterFee", "powerFee", "buildingDepreciation", "propertyFee"],
  );
  assert.deepEqual(
    DEFAULT_REPORT_FIELDS.filter((field) => field.groupId === "maintenance").map((field) => field.key),
    ["repairFee", "maintenanceFee", "upkeepFee", "meteringFee"],
  );
});

test("只有成本类字段计入总成本合计", () => {
  // 把使用天数、检查人次这类非货币字段算进成本，总成本会凭空多出几十——口径一错，全院分析全错
  assert.deepEqual(
    DEFAULT_REPORT_FIELDS.filter((field) => field.countsToCost).map((field) => field.key),
    [
      "consumableCost", "deviceDepreciation", "laborCost", "waterFee", "powerFee",
      "buildingDepreciation", "propertyFee", "repairFee", "maintenanceFee", "upkeepFee",
      "meteringFee", "otherFee",
    ],
  );
  assert.ok(DEFAULT_REPORT_FIELDS.filter((field) => field.countsToCost).every((field) => field.unit === "元"));
  assert.ok(["usageDays", "usageHours", "faultHours", "examVolume", "positiveCount", "totalRevenue"]
    .every((key) => !fieldOf(key).countsToCost), "收入和工作量不是成本");
});

test("业务量三项走导入，不在本页手工填", () => {
  // 检查人次/阳性数/收入来自 HIS 导出，由数据准备中心表格上传；改成 manual 就会被人工数覆盖
  for (const key of ["examVolume", "positiveCount", "totalRevenue"]) {
    assert.equal(fieldOf(key).source, "import", `${key} 必须是导入项`);
  }
  const manualKeys = DEFAULT_REPORT_FIELDS.filter((field) => field.source === "manual").map((field) => field.key);
  assert.equal(manualKeys.length, 15);
  assert.ok(REPORT_FIELD_GROUPS.find((group) => group.id === "workload").hint.includes("导入"));
});

test("字段名按周期粒度替换 {期}", () => {
  const usageDays = fieldOf("usageDays");
  assert.equal(reportFieldLabel(usageDays, "month"), "月使用天数");
  assert.equal(reportFieldLabel(usageDays, "week"), "周使用天数");
  assert.equal(reportFieldLabel(usageDays, "day"), "日使用天数");
  assert.equal(reportFieldLabel(usageDays, "quarter"), "季度使用天数");
  // 自定义区间没有现成的量词，统一说"当期"
  assert.equal(reportFieldLabel(usageDays, "range"), "当期使用天数");
  assert.equal(reportFieldLabel(fieldOf("deviceDepreciation"), "month"), "设备月折旧费");
  assert.equal(reportFieldLabel(fieldOf("deviceDepreciation"), "quarter"), "设备季度折旧费");
  // 没有占位符的字段名不受粒度影响
  assert.equal(reportFieldLabel(fieldOf("waterFee"), "day"), "水费");
  assert.equal(reportFieldFullLabel(fieldOf("usageHours"), "month"), "月使用时间（小时）");
  assert.equal(reportFieldFullLabel(fieldOf("examVolume"), "range"), "当期检查人数/项目（人次）");
  assert.deepEqual(Object.keys(PERIOD_FIELD_PREFIX), Object.keys(PERIOD_GRANULARITY_LABELS));
  assert.equal(PERIOD_GRANULARITY_LABELS.range, "自定义区间");
});

test("周期清单：月、季度的键与条数", () => {
  const months = listPeriods("month", 2026);
  assert.equal(months.length, 12);
  assert.deepEqual(months.map((period) => period.key).slice(0, 2), ["2026-01", "2026-02"]);
  assert.equal(months[6].key, "2026-07");
  assert.equal(months[6].label, "7月");
  assert.equal(months[6].start, "2026-07-01");
  assert.equal(months[6].end, "2026-07-31");
  assert.equal(months[6].days, 31);
  // 2 月天数要跟着闰年走，否则使用率的分母会错
  assert.equal(months[1].days, 28);
  assert.equal(listPeriods("month", 2028)[1].days, 29);

  const quarters = listPeriods("quarter", 2026);
  assert.equal(quarters.length, 4);
  assert.deepEqual(quarters.map((period) => period.key), ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  assert.equal(quarters[2].label, "第三季度");
  assert.equal(quarters[2].start, "2026-07-01");
  assert.equal(quarters[2].end, "2026-09-30");
  assert.equal(quarters[2].days, 92);
});

test("日粒度必须给月份，且日期不因时区偏移", () => {
  const days = listPeriods("day", 2026, 7);
  assert.equal(days.length, 31);
  // UTC 计算的关键断言：本地时区解析会让首尾各偏一天，7 月 1 日掉成 6 月 30 日
  assert.equal(days[0].key, "2026-07-01");
  assert.equal(days[0].label, "7月1日");
  assert.equal(days[30].key, "2026-07-31");
  assert.equal(days[30].label, "7月31日");
  assert.ok(days.every((period) => period.days === 1 && period.start === period.end));
  // 不给月份就没法枚举（一年 365 个选项没法用），返回空数组而不是抛错
  assert.deepEqual(listPeriods("day", 2026), []);
  assert.deepEqual(listPeriods("day", 2026, 13), []);
  // 区间由用户自己选起止，没有可枚举的清单
  assert.deepEqual(listPeriods("range", 2026), []);
});

test("ISO 周：2026-01-01 属于 2026-W01，且该周从上一年 12-29 开始", () => {
  const weeks = listPeriods("week", 2026);
  // 2026-01-01 是周四，含当年第一个周四的那周即第 1 周，所以第 1 周跨年从 2025-12-29 起算
  assert.equal(weeks[0].key, "2026-W01");
  assert.equal(weeks[0].start, "2025-12-29");
  assert.equal(weeks[0].end, "2026-01-04");
  // 2026 年 1 月 1 日是周四 → 全年 53 周，按 52 周截断会把年底一周整周丢掉
  assert.equal(weeks.length, 53);
  assert.equal(weeks[52].key, "2026-W53");
  assert.equal(weeks[52].start, "2026-12-28");
  assert.equal(weeks[52].end, "2027-01-03");
  assert.equal(weeks[27].key, "2026-W28");
  assert.equal(weeks[27].label, "第28周（07-06 ~ 07-12）");
  assert.ok(weeks.every((period) => period.days === 7));
  // 2025 年 1 月 1 日是周三 → 只有 52 周，周数不能写死
  assert.equal(listPeriods("week", 2025).length, 52);
  assert.equal(listPeriods("week", 2025)[0].start, "2024-12-30");
});

test("自定义区间：非法输入返回 null，天数含首尾", () => {
  const period = customRangePeriod("2026-07-01", "2026-07-31");
  assert.equal(period.key, "2026-07-01~2026-07-31");
  assert.equal(period.label, "07-01 ~ 07-31");
  assert.equal(period.days, 31);
  // 同一天算 1 天，不是 0 天，否则使用率的分母会变成 0
  assert.equal(customRangePeriod("2026-07-15", "2026-07-15").days, 1);
  // 倒挂的区间返回 null，交给界面提示，绝不悄悄互换起止
  assert.equal(customRangePeriod("2026-07-31", "2026-07-01"), null);
  assert.equal(customRangePeriod("2026/07/01", "2026-07-31"), null);
  assert.equal(customRangePeriod("2026-02-30", "2026-03-01"), null, "格式对但日子不存在也要拦下");
  assert.equal(customRangePeriod("", ""), null);
});

test("值校验：必填拦空、整数拦小数、负数一律拦下", () => {
  const usageDays = { ...fieldOf("usageDays"), required: true };
  // 提示语固定用月粒度全名，带单位，让人一眼知道该填什么口径
  assert.equal(validateReportValue(usageDays, ""), "月使用天数（天）为必填项");
  assert.equal(validateReportValue(fieldOf("usageDays"), ""), "", "选填留空放行");
  assert.equal(validateReportValue(fieldOf("usageDays"), "20"), "");
  assert.equal(validateReportValue(fieldOf("usageDays"), "20.5"), "月使用天数（天）只能填整数");
  assert.equal(validateReportValue(fieldOf("usageHours"), "160.5"), "");
  assert.equal(validateReportValue(fieldOf("usageHours"), "160小时"), "月使用时间（小时）只能填数字");
  // 成本和工作量没有负值，负号只可能是笔误；放行会让总成本被悄悄冲减
  assert.equal(validateReportValue(fieldOf("usageDays"), "-1"), "月使用天数（天）只能填整数");
  assert.equal(validateReportValue(fieldOf("waterFee"), "-100"), "水费（元）只能填数字");
  assert.equal(validateReportValue(fieldOf("waterFee"), "-0.01"), "水费（元）只能填数字");
});

test("整体校验按字段顺序返回第一条错误", () => {
  const fields = [
    { ...fieldOf("waterFee"), required: true },
    { ...fieldOf("usageDays"), required: true },
  ];
  assert.equal(validateReportValues(fields, {}), "月使用天数（天）为必填项");
  assert.equal(validateReportValues(fields, { usageDays: "20" }), "水费（元）为必填项");
  assert.equal(validateReportValues(fields, { usageDays: "20", waterFee: "100" }), "");
  assert.equal(validateReportValues(DEFAULT_REPORT_FIELDS, undefined), "", "出厂项都非必填，空表也能存草稿");
});

test("跨字段警告只提醒不阻断保存", () => {
  const warn = (values) => reportWarnings(DEFAULT_REPORT_FIELDS, values, monthPeriod);
  assert.deepEqual(warn({ usageDays: "20", usageHours: "160", faultHours: "10", examVolume: "400", positiveCount: "80" }), []);
  // 返回的是数组，调用方拿它做提示，保存路径完全不看它
  assert.ok(Array.isArray(warn({ usageDays: "40" })));
  assert.deepEqual(warn({ usageDays: "40" }), ["使用天数超过本期日历天数（31 天）"]);
  assert.deepEqual(warn({ usageHours: "800" }), ["使用时间超过本期最大可用小时数"]);
  assert.deepEqual(warn({ usageHours: "100", faultHours: "120" }), ["故障时间大于使用时间，请核对"]);
  assert.deepEqual(warn({ examVolume: "100", positiveCount: "120" }), ["检阳性数大于检查人数，请核对"]);
  // 边界上不报：正好用满一整月、故障时间等于使用时间都属于合理情况
  assert.deepEqual(warn({ usageDays: "31", usageHours: "744", faultHours: "744" }), []);
  // 几条一起触发时全部列出，不能只报第一条
  assert.equal(warn({ usageDays: "40", usageHours: "800", faultHours: "900", examVolume: "10", positiveCount: "20" }).length, 4);
});

test("派生指标：常规口径按公式算，公式说明跟着粒度走", () => {
  const values = {
    usageDays: "20", usageHours: "160", faultHours: "10", examVolume: "400",
    positiveCount: "80", totalRevenue: "200000", consumableCost: "10000", deviceDepreciation: "20000",
  };
  const metrics = derivedMetrics(DEFAULT_REPORT_FIELDS, values, monthPeriod, "month");
  assert.equal(metricOf(metrics, "totalCost").value, 30000);
  assert.equal(metricOf(metrics, "utilizationRate").value, 64.52);
  assert.equal(metricOf(metrics, "integrityRate").value, 93.75);
  assert.equal(metricOf(metrics, "costPerExam").value, 75);
  assert.equal(metricOf(metrics, "revenuePerExam").value, 500);
  assert.equal(metricOf(metrics, "positiveRate").value, 20);
  assert.equal(metricOf(metrics, "grossMargin").value, 170000);
  assert.equal(metricOf(metrics, "costBenefitRatio").value, 666.67);
  // 每条都要有口径说明，界面上鼠标一放就能对账，否则科室只会质疑数字
  assert.ok(metrics.every((metric) => metric.formula && metric.hint && metric.label && metric.key));
  assert.match(metricOf(metrics, "utilizationRate").formula, /月使用天数/);
  assert.match(metricOf(metrics, "utilizationRate").formula, /31 天/);
  const quarterly = derivedMetrics(DEFAULT_REPORT_FIELDS, values, listPeriods("quarter", 2026)[2], "quarter");
  assert.match(metricOf(quarterly, "utilizationRate").formula, /季度使用天数/);
});

test("派生指标：分母为 0 或缺项返回 null，不返回 0 或 Infinity", () => {
  const zeroExam = derivedMetrics(
    DEFAULT_REPORT_FIELDS,
    { examVolume: "0", totalRevenue: "200000", consumableCost: "10000", positiveCount: "0" },
    monthPeriod,
    "month",
  );
  // 除零在 JS 里是 Infinity，直接渲染就是"∞ 元/人次"；显示"—"才是诚实的
  for (const key of ["costPerExam", "revenuePerExam", "positiveRate"]) {
    assert.equal(metricOf(zeroExam, key).value, null, `${key} 分母为 0 必须是 null`);
  }
  const empty = derivedMetrics(DEFAULT_REPORT_FIELDS, {}, monthPeriod, "month");
  // 一项没填时总成本是 null 而不是 0：0 会被当成"这台设备不花钱"
  assert.ok(empty.every((metric) => metric.value === null), "什么都没填就不该有任何指标值");
  const noRevenue = derivedMetrics(DEFAULT_REPORT_FIELDS, { consumableCost: "10000" }, monthPeriod, "month");
  assert.equal(metricOf(noRevenue, "totalCost").value, 10000);
  assert.equal(metricOf(noRevenue, "grossMargin").value, null, "收入还没导入就不能算结余");
  assert.equal(metricOf(noRevenue, "costBenefitRatio").value, null);
  // 使用时间为 0 时完好率的分母为 0
  assert.equal(metricOf(derivedMetrics(DEFAULT_REPORT_FIELDS, { usageHours: "0", faultHours: "0" }, monthPeriod, "month"), "integrityRate").value, null);
  // 只填了使用时间、没填故障时间也算缺项，不能默认按 0 故障算出 100% 完好
  assert.equal(metricOf(derivedMetrics(DEFAULT_REPORT_FIELDS, { usageHours: "160" }, monthPeriod, "month"), "integrityRate").value, null);
});

test("总成本只累加计入成本的字段", () => {
  const values = { usageDays: "20", usageHours: "160", examVolume: "400", totalRevenue: "200000", waterFee: "100.1", powerFee: "200.2" };
  assert.equal(reportTotalCost(DEFAULT_REPORT_FIELDS, values), 300.3, "使用天数、收入、人次都不能进合计");
  assert.equal(reportTotalCost(DEFAULT_REPORT_FIELDS, {}), null);
  // 非法值当没填处理，不能让 "一万" 这种输入把合计变成 NaN
  assert.equal(reportTotalCost(DEFAULT_REPORT_FIELDS, { waterFee: "一万", powerFee: "200" }), 200);
});

test("已确认的填报不可再改", () => {
  // 已确认的数据是效益分析的口径来源，改了会让已发布的报表对不上，只能退回后再改
  assert.equal(canEditReport("confirmed"), false);
  for (const status of ["empty", "draft", "submitted", "returned"]) {
    assert.equal(canEditReport(status), true, `${status} 应当可编辑`);
  }
  assert.deepEqual(Object.keys(REPORT_STATUS_LABELS), ["empty", "draft", "submitted", "confirmed", "returned"]);
  assert.equal(REPORT_STATUS_LABELS.returned, "已退回");
  assert.equal(REPORT_STATUS_TONES.confirmed, "success");
  assert.equal(REPORT_STATUS_TONES.returned, "danger");
  assert.deepEqual(Object.keys(REPORT_STATUS_TONES), Object.keys(REPORT_STATUS_LABELS));
});

test("记录查找：没有记录就是未填报", () => {
  const records = [
    { deviceId: "d1", periodKey: "2026-07", values: {}, status: "draft", updatedAt: "2026-08-01", updatedBy: "张三" },
    { deviceId: "d1", periodKey: "2026-06", values: {}, status: "confirmed", updatedAt: "2026-07-01", updatedBy: "张三" },
  ];
  assert.equal(findReportRecord(records, "d1", "2026-07").status, "draft");
  // 设备和周期两个下标都要匹配，只对上一个就返回别的周期的数据
  assert.equal(findReportRecord(records, "d1", "2026-05"), undefined);
  assert.equal(findReportRecord(records, "d2", "2026-07"), undefined);
  // empty 是推算出来的，不落库，避免为每台设备预生成空记录
  assert.equal(reportStatusOf(undefined), "empty");
  assert.equal(reportStatusOf(findReportRecord(records, "d1", "2026-06")), "confirmed");
});

test("完成率统计：退回的不算已填，没有设备时是 0 不是 NaN", () => {
  const records = [
    { deviceId: "d1", periodKey: "2026-07", values: {}, status: "draft", updatedAt: "", updatedBy: "" },
    { deviceId: "d2", periodKey: "2026-07", values: {}, status: "confirmed", updatedAt: "", updatedBy: "" },
    { deviceId: "d3", periodKey: "2026-07", values: {}, status: "returned", updatedAt: "", updatedBy: "" },
    { deviceId: "d4", periodKey: "2026-06", values: {}, status: "confirmed", updatedAt: "", updatedBy: "" },
  ];
  const stat = completionStat(["d1", "d2", "d3", "d4"], records, "2026-07");
  // d3 被退回还得重填，算进去完成率会虚高；d4 是上个月的记录，不该算到本期
  assert.deepEqual(stat, { total: 4, filled: 2, confirmed: 1, rate: 0.5 });
  const emptyStat = completionStat([], records, "2026-07");
  // 0/0 是 NaN，会一路渗到界面上显示成"NaN%"
  assert.equal(emptyStat.rate, 0);
  assert.ok(!Number.isNaN(emptyStat.rate));
  assert.deepEqual(emptyStat, { total: 0, filled: 0, confirmed: 0, rate: 0 });
});

test("自定义字段合并：可以改名，但改不动来源和成本口径", () => {
  const merged = mergeReportFields([
    custom({ key: "examVolume", labelPattern: "{期}检查量", unit: "例", required: true, hint: "自定义提示", order: 4, source: "manual", countsToCost: true, type: "decimal", builtin: true }),
    custom({ key: "usageDays", labelPattern: "{期}开机天数", unit: "天", order: 1, countsToCost: true, source: "import" }),
    custom({ key: "field_1", labelPattern: "科室分摊", order: 19, countsToCost: true, builtin: true }),
  ]);
  const examVolume = merged.find((field) => field.key === "examVolume");
  // 放开 source 就等于允许人工数覆盖 HIS 导入的业务量，两边对不上时谁也说不清哪个对
  assert.equal(examVolume.source, "import");
  assert.equal(examVolume.countsToCost, false, "检查人次不是钱，不能进成本合计");
  assert.equal(examVolume.type, "integer");
  assert.equal(examVolume.builtin, true, "出厂项不会因为被改写就变成可删的自定义项");
  // 名称、单位、必填、提示、顺序是允许医院自己定的
  assert.equal(examVolume.labelPattern, "{期}检查量");
  assert.equal(examVolume.unit, "例");
  assert.equal(examVolume.required, true);
  assert.equal(examVolume.hint, "自定义提示");

  const usageDays = merged.find((field) => field.key === "usageDays");
  assert.equal(usageDays.countsToCost, false, "使用天数被算进成本会让总成本凭空多出几十元");
  assert.equal(usageDays.source, "manual");
  assert.equal(reportFieldLabel(usageDays, "month"), "月开机天数");

  // 自定义项接在出厂 18 项后面，并且不能自称出厂项
  assert.equal(merged.length, 19);
  assert.equal(merged[18].key, "field_1");
  assert.equal(merged[18].builtin, false);
  // 自定义的成本项则可以真的进合计
  assert.equal(reportTotalCost(merged, { field_1: "500", waterFee: "100" }), 600);
  // 不传自定义字段时就是出厂 18 项原样
  assert.deepEqual(mergeReportFields([]).map((field) => field.key), DEFAULT_REPORT_FIELDS.map((field) => field.key));
});

test("按分组归拢字段时保留空组", () => {
  const groups = reportFieldsByGroup(DEFAULT_REPORT_FIELDS);
  assert.deepEqual(groups.map((item) => item.group.id), ["usage", "workload", "direct", "space", "maintenance", "other"]);
  assert.deepEqual(groups[1].fields.map((field) => field.key), ["examVolume", "positiveCount", "totalRevenue"]);
  // 空组也返回：分组是填报页的骨架，少一块比空一块更难解释，是否隐藏交给前端
  const sparse = reportFieldsByGroup(DEFAULT_REPORT_FIELDS.filter((field) => field.groupId === "usage"));
  assert.equal(sparse.length, 6);
  assert.deepEqual(sparse[5], { group: REPORT_FIELD_GROUPS[5], fields: [] });
});

test("自定义字段定义校验：拦下空名、保留键、重名和非法标识", () => {
  const existing = [custom()];
  assert.equal(validateReportFieldDefinition(custom({ key: "field_2" }), existing), null);
  assert.equal(validateReportFieldDefinition(custom({ labelPattern: "  " }), []), "label_required");
  assert.equal(validateReportFieldDefinition(custom({ key: "" }), []), "key_required");
  // 出厂键被占用会和系统项串位，历史数据会被写进错的下标
  assert.equal(validateReportFieldDefinition(custom({ key: "usageDays" }), []), "key_reserved");
  assert.equal(validateReportFieldDefinition(custom({ key: "otherFee" }), []), "key_reserved");
  // 记录自身的结构字段同样不能被占用
  assert.equal(validateReportFieldDefinition(custom({ key: "deviceId" }), []), "key_reserved");
  assert.equal(validateReportFieldDefinition(custom({ key: "periodKey" }), []), "key_reserved");
  assert.equal(validateReportFieldDefinition(custom({ key: "status" }), []), "key_reserved");
  // 标识必须是规范化后的形态，否则和 normalizeFieldKey 生成的键对不上
  assert.equal(validateReportFieldDefinition(custom({ key: "Field 2" }), []), "key_required");
  assert.equal(validateReportFieldDefinition(custom(), existing), "key_duplicated");
  // 编辑自己时不算重名
  assert.equal(validateReportFieldDefinition(custom(), existing, "field_1"), null);
});
