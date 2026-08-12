import assert from "node:assert/strict";
import test from "node:test";

import {
  FILE_BUSINESS_TEMPLATES,
  buildBusinessTemplateCsv,
  suggestTemplateField,
  templateFields,
} from "../app/data-workbench-model.ts";

const TEMPLATE_CODE = "device_workload";

const findTemplate = (code) =>
  FILE_BUSINESS_TEMPLATES.find((template) => template.code === code);

test("设备业务量与收入模板存在，且必填字段是设备编号、期间与检查人数", () => {
  // 用户要求月检查人数/阳性数/收入统一走数据准备中心上传，而不是在设备填报页手工敲。
  // 这三项都必须能落到「某台设备的某个期间」上，否则回填时无法定位到填报页的那一行，
  // 所以设备编号 + 期间是这个模板不可省略的业务主键。
  const template = findTemplate(TEMPLATE_CODE);
  assert.ok(template, "FILE_BUSINESS_TEMPLATES 里必须有 device_workload 模板");
  assert.equal(template.dataDomain, "exam");
  assert.equal(template.name, "设备业务量与收入");
  assert.equal(template.domain, "服务与效率");
  assert.deepEqual(template.requiredFields, ["设备编号", "期间", "检查人数/项目"]);

  // 声明的必填列名要真的能落到字段清单上的字段，否则校验会去要一列不存在的数据。
  assert.equal(suggestTemplateField(TEMPLATE_CODE, "设备编号"), "deviceId");
  assert.equal(suggestTemplateField(TEMPLATE_CODE, "期间"), "period");
  assert.equal(suggestTemplateField(TEMPLATE_CODE, "检查人数/项目"), "examVolume");

  // requiredFields 是给服务端校验用的必填列名，字段清单里的 required 是给前端映射用的，
  // 两边对不上就会出现「前端说必填、后端放行」这类只在生产才暴露的口径分裂。
  const requiredCodes = templateFields(TEMPLATE_CODE)
    .filter((field) => field.required)
    .map((field) => field.code)
    .filter((code) => code !== "recordType");
  assert.deepEqual(requiredCodes.sort(), ["deviceId", "examVolume", "period"]);
});

test("模板排在检查工作量之后、收费与收入之前，服务与效率的模板保持相邻", () => {
  // 「文件与模板」页面按数组顺序渲染模板列表，同一业务域的模板分散开会让用户
  // 在挑模板时来回找，所以顺序本身是产品要求，不只是代码风格。
  const codes = FILE_BUSINESS_TEMPLATES.map((template) => template.code);
  assert.equal(codes.indexOf(TEMPLATE_CODE), codes.indexOf("exam_activity") + 1);
  assert.equal(codes.indexOf("billing_revenue"), codes.indexOf(TEMPLATE_CODE) + 1);
});

test("三项业务量字段的 code 与设备填报页逐字一致", () => {
  // 设备数据填报页是按 code 回填的：上传的表格解析成 { examVolume, positiveCount,
  // totalRevenue } 之后直接按 key 匹配填报页字段。这里任何一个 code 改名（哪怕只是
  // 大小写或改成 exam_volume）都会让回填静默失效——页面不报错，只是永远填不上值。
  // 所以这条断言锁死字面量，不允许「等价重命名」。
  const byCode = new Map(
    templateFields(TEMPLATE_CODE).map((field) => [field.code, field]),
  );

  const examVolume = byCode.get("examVolume");
  assert.ok(examVolume, "缺少 examVolume 字段");
  assert.equal(examVolume.name, "检查人数/项目");
  assert.equal(examVolume.type, "integer");
  assert.equal(examVolume.required, true);

  const positiveCount = byCode.get("positiveCount");
  assert.ok(positiveCount, "缺少 positiveCount 字段");
  assert.equal(positiveCount.name, "检阳性数");
  assert.equal(positiveCount.type, "integer");
  assert.equal(positiveCount.required, false);

  const totalRevenue = byCode.get("totalRevenue");
  assert.ok(totalRevenue, "缺少 totalRevenue 字段");
  assert.equal(totalRevenue.name, "总收入（元）");
  assert.equal(totalRevenue.type, "decimal");
  assert.equal(totalRevenue.required, false);
});

test("期间字段是字符串，以便同时接受月、周、季、日等多种粒度的期间键", () => {
  // 医院各科室报表的粒度不统一：影像科按月、手术室按周、财务按季度对账。
  // 若把 period 定成 date，2026-W28 / 2026-Q3 这类期间键会在类型推断阶段被判为脏数据
  // 而进隔离区，所以这里必须保持 string。
  const period = templateFields(TEMPLATE_CODE).find(
    (field) => field.code === "period",
  );
  assert.ok(period, "缺少 period 字段");
  assert.equal(period.type, "string");
  assert.equal(period.required, true);
});

test("buildBusinessTemplateCsv 能为该模板生成带中文列名的表头", () => {
  // 用户下载的是空白模板表，直接照着列名填。表头必须是中文业务名而不是英文 code，
  // 否则科室干事看不懂该往哪一列填数。
  const csv = buildBusinessTemplateCsv(TEMPLATE_CODE);
  assert.ok(csv.startsWith("﻿"), "需要 BOM，否则 Excel 打开中文表头会乱码");

  const header = csv.replace(/^﻿/, "").replace(/\r\n$/, "");
  for (const columnName of [
    "设备编号",
    "期间",
    "检查人数/项目",
    "检阳性数",
    "总收入（元）",
  ]) {
    assert.ok(
      header.includes(columnName),
      `模板表头缺少中文列名：${columnName}`,
    );
  }
});

test("常见的中文别名都能被认到 examVolume 上", () => {
  // 各家医院导出的表头写法不一：HIS 导出叫「检查人次」，科室自制台账叫「月检查人数」。
  // 别名映射存在的意义就是让这些写法不用人工改表头也能直接上传，
  // 所以这里逐个验证 suggestTemplateField 的归一化匹配确实覆盖到了。
  for (const alias of [
    "月检查人数",
    "检查人次",
    "检查例数",
    "工作量",
    "检查人数/项目",
    "examVolume",
  ]) {
    assert.equal(
      suggestTemplateField(TEMPLATE_CODE, alias),
      "examVolume",
      `别名「${alias}」没有匹配到 examVolume`,
    );
  }

  assert.equal(suggestTemplateField(TEMPLATE_CODE, "阳性例数"), "positiveCount");
  assert.equal(suggestTemplateField(TEMPLATE_CODE, "设备收入"), "totalRevenue");
  assert.equal(suggestTemplateField(TEMPLATE_CODE, "统计期间"), "period");
});

test("每个业务模板都配有非空的字段清单", () => {
  // templateFields 对未知 code 返回空数组而不是抛错，所以漏配一份字段清单不会崩，
  // 只会让「下载模板」导出一个没有表头的空 CSV、映射页显示不出任何字段——
  // 是静默故障。这条兜底断言保证以后再加模板时不会漏掉 FILE_TEMPLATE_FIELDS。
  for (const template of FILE_BUSINESS_TEMPLATES) {
    const fields = templateFields(template.code);
    assert.ok(
      fields.length > 0,
      `模板 ${template.code} 没有配置 FILE_TEMPLATE_FIELDS`,
    );
    for (const field of fields) {
      assert.ok(field.code, `模板 ${template.code} 有字段缺少 code`);
      assert.ok(field.name, `模板 ${template.code} 的 ${field.code} 缺少中文名`);
      assert.ok(
        Array.isArray(field.aliases),
        `模板 ${template.code} 的 ${field.code} 缺少 aliases 数组`,
      );
    }
  }
});
