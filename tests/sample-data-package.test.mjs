import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FILE_BUSINESS_TEMPLATES,
  parseCsv,
  templateFields,
} from "../app/data-workbench-model.ts";
import {
  SAMPLE_DATA_PACKAGE_VERSION,
  SAMPLE_DATA_ROW_COUNTS,
  buildSampleDataCsv,
} from "../app/sample-data-package.ts";

const TEMPLATE_CODES = FILE_BUSINESS_TEMPLATES.map((template) => template.code);

function sampleRows(templateCode) {
  return parseCsv(buildSampleDataCsv(templateCode).csv).rows;
}

test("generates deterministic sample CSVs with a versioned manifest", () => {
  assert.match(SAMPLE_DATA_PACKAGE_VERSION, /^\d{4}\.\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(SAMPLE_DATA_ROW_COUNTS).sort(), [...TEMPLATE_CODES].sort());
  for (const code of TEMPLATE_CODES) {
    const first = buildSampleDataCsv(code);
    const second = buildSampleDataCsv(code);
    assert.equal(first.csv, second.csv, `${code} must be deterministic`);
    assert.equal(first.rowCount, SAMPLE_DATA_ROW_COUNTS[code]);
    assert.equal(parseCsv(first.csv).rows.length, first.rowCount);
    assert.ok(first.csv.startsWith("\ufeff"), `${code} csv must carry a BOM`);
    assert.ok(first.fileName.endsWith("-示范数据-2026.csv"));
  }
  assert.throws(() => buildSampleDataCsv("no_such_template"), /UNKNOWN_SAMPLE_TEMPLATE/);
});

test("emits every template with its own Chinese headers and populated required fields", () => {
  for (const code of TEMPLATE_CODES) {
    const parsed = parseCsv(buildSampleDataCsv(code).csv);
    const fields = templateFields(code);
    assert.deepEqual(
      parsed.headers,
      fields.map((field) => field.name),
      `${code} headers must match the template field contract`,
    );
    const required = fields.filter((field) => field.required);
    for (const row of parsed.rows) {
      for (const field of required) {
        assert.ok(
          String(row[field.name] ?? "").trim().length > 0,
          `${code} requires ${field.name}`,
        );
      }
    }
  }
});

test("keeps realistic volumes in the documented ranges", () => {
  assert.equal(SAMPLE_DATA_ROW_COUNTS.device_master, 20);
  assert.ok(
    SAMPLE_DATA_ROW_COUNTS.exam_activity >= 400 &&
      SAMPLE_DATA_ROW_COUNTS.exam_activity <= 600,
  );
  assert.ok(
    SAMPLE_DATA_ROW_COUNTS.billing_revenue >= 400 &&
      SAMPLE_DATA_ROW_COUNTS.billing_revenue <= 600,
  );
  assert.equal(SAMPLE_DATA_ROW_COUNTS.cost_detail, 20 * 12 * 5);
  assert.ok(
    SAMPLE_DATA_ROW_COUNTS.maintenance >= 60 &&
      SAMPLE_DATA_ROW_COUNTS.maintenance <= 90,
  );
  assert.equal(SAMPLE_DATA_ROW_COUNTS.utilization, 20 * 12);
  assert.ok(
    SAMPLE_DATA_ROW_COUNTS.quality_safety >= 80 &&
      SAMPLE_DATA_ROW_COUNTS.quality_safety <= 120,
  );
  assert.equal(SAMPLE_DATA_ROW_COUNTS.target_budget, 24);
});

test("keeps one consistent device fleet across all business files", () => {
  const deviceIds = new Set(sampleRows("device_master").map((row) => row["设备编号"]));
  assert.equal(deviceIds.size, 20);

  for (const [code, column] of [
    ["exam_activity", "设备编号"],
    ["billing_revenue", "设备编号"],
    ["cost_detail", "设备编号"],
    ["maintenance", "设备编号"],
    ["utilization", "设备编号"],
  ]) {
    for (const row of sampleRows(code)) {
      assert.ok(
        deviceIds.has(row[column]),
        `${code} references unknown device ${row[column]}`,
      );
    }
  }
  for (const row of sampleRows("quality_safety")) {
    if (row["设备编号"]) assert.ok(deviceIds.has(row["设备编号"]));
  }

  const utilizationDeviceMonths = new Set(
    sampleRows("utilization").map((row) => `${row["设备编号"]}|${row["统计日期"]}`),
  );
  assert.equal(utilizationDeviceMonths.size, 240, "utilization covers every device-month once");
  const costDeviceIds = new Set(sampleRows("cost_detail").map((row) => row["设备编号"]));
  assert.equal(costDeviceIds.size, 20, "cost detail covers the whole fleet");
});

test("keeps exam ids unique and billing tied to real exams with few refunds", () => {
  const examRows = sampleRows("exam_activity");
  const examIds = new Set(examRows.map((row) => row["检查号"]));
  assert.equal(examIds.size, examRows.length, "exam ids must be unique");

  const billingRows = sampleRows("billing_revenue");
  const refunds = billingRows.filter((row) => Number(row["退费金额（万元）"]) > 0);
  for (const row of billingRows) {
    assert.ok(examIds.has(row["检查号"]), `billing ${row["来源记录号"]} must reference an exam`);
    assert.ok(String(row["来源记录号"]).length > 0);
  }
  for (const refund of refunds) {
    // 退费行冲减由“退费金额”承担，金额列必须为 0，避免消费端 金额−退费金额 双重扣减。
    assert.equal(Number(refund["金额（万元）"]), 0, "refund rows must zero the gross amount");
  }
  assert.ok(refunds.length > 0, "sample must include refund rows");

  // 被退费的检查净额必须归零。
  const netByExam = new Map();
  for (const row of billingRows) {
    const net = Number(row["金额（万元）"]) - Number(row["退费金额（万元）"] || 0);
    netByExam.set(row["检查号"], (netByExam.get(row["检查号"]) ?? 0) + net);
  }
  for (const refund of refunds) {
    assert.ok(Math.abs(netByExam.get(refund["检查号"]) ?? 0) < 1e-9, `退费检查 ${refund["检查号"]} 净额必须为 0`);
  }
  assert.ok(
    refunds.length / billingRows.length <= 0.03,
    `refund share ${refunds.length}/${billingRows.length} must stay <= 3%`,
  );
});

test("confines all periods to 2026 with a Spring Festival dip and summer peak", () => {
  const monthOf = (value) => String(value).slice(0, 7);
  const assert2026 = (value, context) =>
    assert.match(String(value), /^2026-\d{2}/, `${context} must stay in 2026`);

  const examMonths = {};
  for (const row of sampleRows("exam_activity")) {
    assert2026(row["完成时间"], "exam 完成时间");
    const month = monthOf(row["完成时间"]);
    examMonths[month] = (examMonths[month] ?? 0) + 1;
  }
  assert.equal(Object.keys(examMonths).length, 12, "exam sample spans all 12 months");
  assert.ok(
    examMonths["2026-02"] < examMonths["2026-08"],
    "春节月检查量必须低于暑期高峰",
  );
  assert.ok(
    examMonths["2026-02"] < examMonths["2026-03"],
    "春节月检查量必须低于常规月份",
  );

  for (const row of sampleRows("billing_revenue")) assert2026(row["收费时间"], "billing 收费时间");
  for (const row of sampleRows("maintenance")) assert2026(row["事件时间"], "maintenance 事件时间");
  for (const row of sampleRows("cost_detail")) assert2026(row["期间"], "cost 期间");
  for (const row of sampleRows("utilization")) assert2026(row["统计日期"], "utilization 统计日期");
  for (const row of sampleRows("quality_safety")) assert2026(row["事件日期"], "quality 事件日期");
  for (const row of sampleRows("target_budget"))
    assert.match(String(row["期间"]), /^2026(-\d{2})?$/, "target 期间 must stay in 2026");
});

test("keeps utilization minutes coherent and aligned with exam seasonality", () => {
  const utilizationRows = sampleRows("utilization");
  const totals = {};
  for (const row of utilizationRows) {
    const scheduled = Number(row["计划服务分钟"]);
    const powered = Number(row["开机分钟"]);
    const active = Number(row["有效作业分钟"]);
    assert.ok(scheduled > 0);
    assert.ok(active <= powered, "active minutes cannot exceed powered minutes");
    assert.ok(powered <= scheduled, "powered minutes cannot exceed scheduled minutes");
    const month = String(row["统计日期"]).slice(0, 7);
    totals[month] = (totals[month] ?? 0) + Number(row["检查人次"]);
  }
  assert.ok(totals["2026-02"] < totals["2026-08"], "利用率工作量与检查量方向一致");

  const costRows = sampleRows("cost_detail");
  const costTypes = new Set(costRows.map((row) => row["成本类型"]));
  assert.deepEqual(
    [...costTypes].sort(),
    ["人工", "折旧", "维保", "耗材", "能耗"].sort(),
  );
  for (const row of costRows) assert.ok(Number(row["金额（万元）"]) > 0);
});

test("contains no patient identifiers in any sample file", () => {
  const pii = /患者姓名|身份证|手机号|住院号|病历号/;
  for (const code of TEMPLATE_CODES) {
    const { csv } = buildSampleDataCsv(code);
    assert.doesNotMatch(csv, pii, `${code} must stay de-identified`);
  }
  for (const row of sampleRows("exam_activity")) {
    assert.match(row["检查号"], /^EX-2026-\d{5}$/, "exam ids must stay opaque");
  }
});

test("wires the sample package into the Data Workbench import surface", async () => {
  const component = await readFile(
    new URL("../app/DataWorkbench.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /from "\.\/sample-data-package"/);
  assert.match(component, /SAMPLE_DATA_PACKAGE_VERSION/);
  assert.match(component, /buildSampleDataCsv\(/);
  assert.match(component, /function downloadSampleData\(/);
  assert.match(component, /function downloadAllSampleData\(/);
  assert.match(component, /downloadText\(sample\.fileName, sample\.csv\)/);
  assert.match(component, /下载示范数据/);
  assert.match(component, /下载全部示范数据/);
  assert.match(component, /脱敏示范数据/);
  assert.match(component, /导入→映射→清洗→发布 全流程/);
});
