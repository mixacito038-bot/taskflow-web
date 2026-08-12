import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REPORT_FIELDS,
  listPeriods,
  reportWarnings,
  validateReportValues,
} from "../app/device-report-fields.ts";
import {
  cloneDeviceReportsForHospital,
  cloneDevicesForHospital,
  deviceReportValuesByMonth,
} from "../app/mock-data.ts";

const HOSPITAL = "hosp-central";
const devices = cloneDevicesForHospital(HOSPITAL);
const records = cloneDeviceReportsForHospital(HOSPITAL);
const periods = listPeriods("month", 2026);
const periodByKey = new Map(periods.map((period) => [period.key, period]));

const recordsOf = (deviceId) => records.filter((record) => record.deviceId === deviceId);
const monthOf = (record) => Number(record.periodKey.slice(5));

/**
 * 台账七项年度成本 → 填报口径 12 项的归属关系。
 * 测试里重述一遍是故意的：这是对外的成本口径契约，实现改了拆分比例可以，
 * 但把某一项挪出「能加回台账」的范围就必须让测试失败。
 */
const COST_GROUPS = [
  { source: "consumables", fields: ["consumableCost"] },
  { source: "depreciation", fields: ["deviceDepreciation"] },
  { source: "labor", fields: ["laborCost"] },
  { source: "energy", fields: ["waterFee", "powerFee"] },
  { source: "space", fields: ["buildingDepreciation", "propertyFee"] },
  { source: "maintenance", fields: ["repairFee", "maintenanceFee", "upkeepFee", "meteringFee"] },
  { source: "indirect", fields: ["otherFee"] },
];

/** 数据准备中心表格导入的三项，填报记录一个都不能写。 */
const IMPORT_ONLY_KEYS = ["examVolume", "positiveCount", "totalRevenue"];

test("演示数据非空：23 台设备 × 1–8 月，共 184 条记录", () => {
  // 空的演示数据正是这次要修的问题——先钉住「确实生成了数」，后面的断言才有意义。
  assert.equal(devices.length, 23);
  assert.equal(records.length, 23 * 8);
});

test("每台设备只生成 1–8 月记录，9–12 月留空", () => {
  // 9–12 月是未来月份，凭空造数会让演示环境看起来像在预测未来，也和「本期没有填报」的真实状态冲突。
  for (const device of devices) {
    const months = recordsOf(device.id).map(monthOf).sort((left, right) => left - right);
    assert.deepEqual(months, [1, 2, 3, 4, 5, 6, 7, 8], `设备 ${device.id} 的月份分布不对`);
  }
  assert.equal(records.some((record) => monthOf(record) > 8), false);
});

test("绝不写入 examVolume / positiveCount / totalRevenue", () => {
  // 这三项的口径是「数据准备中心表格导入」。填报记录里也写一份，就会出现两份互相打架的业务量口径，
  // 驾驶舱到底取哪一份没人说得清——这是本次演示数据最硬的一条边界。
  for (const record of records) {
    for (const key of IMPORT_ONLY_KEYS) {
      assert.equal(key in record.values, false, `${record.deviceId} ${record.periodKey} 不该有 ${key}`);
    }
  }
});

test("只写手工填报的 15 项，键全部来自出厂字段目录", () => {
  // 写进未定义的键 = 填报页看不见、驾驶舱也算不到，等于白填。
  const manualKeys = DEFAULT_REPORT_FIELDS.filter((field) => field.source === "manual").map((field) => field.key);
  assert.equal(manualKeys.length, 15);
  for (const record of records) {
    assert.deepEqual([...Object.keys(record.values)].sort(), [...manualKeys].sort());
  }
});

test("成本口径覆盖完整：12 项计入成本的字段都在拆分表里，且互不重复", () => {
  const grouped = COST_GROUPS.flatMap((group) => group.fields);
  const countsToCost = DEFAULT_REPORT_FIELDS.filter((field) => field.countsToCost).map((field) => field.key);
  assert.equal(grouped.length, 12);
  assert.equal(new Set(grouped).size, 12);
  assert.deepEqual([...grouped].sort(), [...countsToCost].sort());
});

test("12 个月加总 === 台账年度成本 ×10000，分毫不差", () => {
  // 演示数据要和台账对得上账：驾驶舱按填报记录重算出来的年度成本，必须等于设备台账里的成本。
  // 差几块钱医院就会怀疑系统算错，所以舍入余数必须被末月吸收，而不是任其累积。
  for (const device of devices) {
    const monthly = deviceReportValuesByMonth(device);
    assert.equal(monthly.length, 12);
    for (const group of COST_GROUPS) {
      const expected = device.cost[group.source] * 10000;
      const actual = monthly.reduce(
        (sum, values) => sum + group.fields.reduce((part, key) => part + Number(values[key]), 0),
        0,
      );
      assert.equal(actual, expected, `${device.id} 的 ${group.source} 全年合计对不上`);
    }
  }
});

test("落库记录的值就是全年分摊表的 1–8 月，没有二次加工", () => {
  // 上一条测的是 12 个月的分摊表；这条把记录钉到同一张表上，
  // 否则「表里对得上、记录里对不上」也能同时通过。
  for (const device of devices) {
    const monthly = deviceReportValuesByMonth(device);
    for (const record of recordsOf(device.id)) {
      assert.deepEqual(record.values, monthly[monthOf(record) - 1]);
    }
  }
});

test("设备折旧与房屋折旧逐月等额：直线法不跟月度波动", () => {
  // 平均年限法下折旧是会计口径，不随用量起伏。让它跟着 costFactors 波动，财务对账时第一个会被挑出来。
  for (const device of devices) {
    const monthly = deviceReportValuesByMonth(device);
    for (const key of ["deviceDepreciation", "buildingDepreciation"]) {
      // 末月吸收舍入余数，所以只比前 11 个月。
      const head = monthly.slice(0, 11).map((values) => Number(values[key]));
      assert.equal(new Set(head).size, 1, `${device.id} 的 ${key} 逐月不等额`);
    }
  }
});

test("使用天数不超过当月天数、故障时长不超过使用时长", () => {
  // 这两条一旦破了，填报页和驾驶舱会一开就是满屏橙色告警，演示当场翻车。
  for (const record of records) {
    const period = periodByKey.get(record.periodKey);
    assert.ok(period, `找不到期间 ${record.periodKey}`);
    const usageDays = Number(record.values.usageDays);
    const usageHours = Number(record.values.usageHours);
    const faultHours = Number(record.values.faultHours);
    assert.ok(usageDays > 0 && usageDays <= period.days, `${record.deviceId} ${record.periodKey} 使用天数越界`);
    assert.ok(usageHours <= period.days * 24, `${record.deviceId} ${record.periodKey} 使用时长越界`);
    assert.ok(faultHours <= usageHours, `${record.deviceId} ${record.periodKey} 故障时长超过使用时长`);
  }
});

test("状态分布：1–6 月已确认、7 月已提交、8 月填报中", () => {
  // 全绿的演示数据看不出填报流程；这条锁住「确认 / 提交 / 填报中」三段都摆在台面上。
  for (const record of records) {
    const month = monthOf(record);
    if (record.status === "returned") continue;
    const expected = month <= 6 ? "confirmed" : month === 7 ? "submitted" : "draft";
    assert.equal(record.status, expected, `${record.deviceId} ${record.periodKey} 状态不对`);
  }
});

test("已退回的记录必须带非空退回原因，且集中在 6 月", () => {
  // 退回而不说明理由，科室不知道要改什么；演示里这一条也正是要展示的闭环。
  const returned = records.filter((record) => record.status === "returned");
  assert.ok(returned.length >= 1 && returned.length <= 2, "退回记录应为 1–2 条");
  for (const record of returned) {
    assert.equal(monthOf(record), 6);
    assert.equal(typeof record.returnReason, "string");
    assert.ok(record.returnReason.trim().length > 0, `${record.deviceId} 的退回原因为空`);
  }
  // 未退回的记录不该残留 returnReason，否则界面会展示一条早已解决的旧理由。
  for (const record of records) {
    if (record.status !== "returned") assert.equal(record.returnReason, undefined);
  }
});

test("periodKey 一律 2026-MM，月份补零", () => {
  // 期间键是填报记录的下标，"2026-1" 和 "2026-01" 会被当成两个期间，驾驶舱按月取数会直接取空。
  for (const record of records) {
    assert.match(record.periodKey, /^2026-(0[1-9]|1[0-2])$/);
  }
});

test("所有值都是可解析成有限数的字符串", () => {
  // values 是 Record<string,string>；一旦混进 "NaN" / "Infinity" / 空串，
  // 派生指标会静默算出 NaN 并一路渗到界面上。
  for (const record of records) {
    for (const [key, value] of Object.entries(record.values)) {
      assert.equal(typeof value, "string", `${record.deviceId} ${key} 不是字符串`);
      assert.notEqual(value.trim(), "", `${record.deviceId} ${key} 是空串`);
      const parsed = Number(value);
      assert.ok(Number.isFinite(parsed), `${record.deviceId} ${key} 解析成 ${value}`);
      assert.ok(parsed >= 0, `${record.deviceId} ${key} 是负数`);
    }
  }
});

test("金额取整到元、时长保留 1 位小数", () => {
  // 填报页按元和小时展示，带一长串浮点尾巴的演示数据一眼就是机器造的。
  const moneyKeys = COST_GROUPS.flatMap((group) => group.fields);
  for (const record of records) {
    for (const key of moneyKeys) assert.match(record.values[key], /^\d+$/, `${key} 不是整数元`);
    assert.match(record.values.usageDays, /^\d+$/);
    assert.match(record.values.usageHours, /^\d+\.\d$/);
    assert.match(record.values.faultHours, /^\d+\.\d$/);
  }
});

test("演示数据自己能通过平台的录入校验", () => {
  // 造出连自家校验都过不了的演示数据，一点开填报页就是红字，比没有数据更难解释。
  for (const record of records) {
    assert.equal(validateReportValues(DEFAULT_REPORT_FIELDS, record.values), "", `${record.deviceId} ${record.periodKey} 校验不通过`);
  }
});

test("演示数据不触发任何跨字段告警", () => {
  // reportWarnings 是「看着不对」的提示。演示环境一片橙色，观众会先怀疑数据再怀疑系统。
  for (const record of records) {
    const period = periodByKey.get(record.periodKey);
    assert.deepEqual(reportWarnings(DEFAULT_REPORT_FIELDS, record.values, period), []);
  }
});

test("时间戳固定可预测，不含运行时当前时间", () => {
  // 用 new Date() 生成的话，服务端渲染和客户端水合会拿到不同的值，React 直接报水合告警。
  const stamps = new Set(records.map((record) => record.updatedAt));
  for (const stamp of stamps) assert.match(stamp, /^2026-0[2-9]-05T(09:00|15:30):00\.000Z$/);
  const again = cloneDeviceReportsForHospital(HOSPITAL);
  assert.deepEqual(again.map((record) => record.updatedAt), records.map((record) => record.updatedAt));
  for (const record of records) assert.equal(record.updatedBy, "设备科 · 演示数据");
});

test("同院两次调用完全一致，不同院数据互不相同", () => {
  // 确定性：演示数据每次不一样就没法排查问题，也会让水合和快照全部失效。
  assert.deepEqual(cloneDeviceReportsForHospital(HOSPITAL), cloneDeviceReportsForHospital(HOSPITAL));
  // 按医院隔离：分院的成本和使用率本就打了折，填报值再一样，集团对比页就成了一排相同的数。
  const east = cloneDeviceReportsForHospital("hosp-east");
  const specialty = cloneDeviceReportsForHospital("hosp-specialty");
  assert.equal(east.length, records.length);
  assert.notDeepEqual(east.map((record) => record.values), records.map((record) => record.values));
  assert.notDeepEqual(specialty.map((record) => record.values), east.map((record) => record.values));
  // 返回的是新对象，调用方改自己那份不会污染别家医院。
  assert.notEqual(east[0].values, cloneDeviceReportsForHospital("hosp-east")[0].values);
});
