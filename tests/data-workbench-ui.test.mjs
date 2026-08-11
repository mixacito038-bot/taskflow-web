import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DATA_WORKBENCH_ENTRY_CLICKS,
  DATA_WORKBENCH_SECTIONS,
  FILE_BUSINESS_TEMPLATES,
  FILE_WORKBENCH_RESOURCE_LABELS,
  FILE_WORKBENCH_STATE_LABELS,
  calculateQualitySummary,
  buildCsvDatasetProfile,
  buildBusinessTemplateCsv,
  classifyImportFile,
  parseJsonRecords,
  reconcileFileRows,
  normalizeServerCleaningImpact,
  runCleaningPreview,
  suggestTemplateField,
  templateFields,
  parseCsv,
} from "../app/data-workbench-model.ts";

test("declares the complete ten-section data preparation workflow", () => {
  assert.deepEqual(
    DATA_WORKBENCH_SECTIONS.map((section) => section.label),
    [
      "工作台",
      "文件与模板",
      "文件导入",
      "原始批次",
      "字段/主数据映射",
      "清洗规则",
      "数据质量与隔离",
      "文件对账",
      "审核与发布",
      "血缘与回滚",
    ],
  );
  assert.equal(DATA_WORKBENCH_ENTRY_CLICKS, 3);
  assert.equal(FILE_BUSINESS_TEMPLATES.length, 8);
});

test("keeps internal resource keys while presenting fixed Chinese resource states", () => {
  assert.equal(FILE_WORKBENCH_RESOURCE_LABELS.templates, "业务模板");
  assert.equal(FILE_WORKBENCH_RESOURCE_LABELS.publishedRecords, "已发布数据行");
  assert.deepEqual(FILE_WORKBENCH_STATE_LABELS, {
    loading: "加载中",
    ready: "已就绪",
    empty: "暂无数据",
    error: "加载失败",
  });
});

test("collapses the sidebar and keeps workflow cards readable at tablet width", async () => {
  const styles = await readFile(
    new URL("../app/DataWorkbench.module.css", import.meta.url),
    "utf8",
  );
  const tabletStart = styles.indexOf("@media (max-width: 920px)");
  const phoneStart = styles.indexOf("@media (max-width: 760px)");
  assert.ok(tabletStart >= 0 && phoneStart > tabletStart);
  const tablet = styles.slice(tabletStart, phoneStart);
  assert.match(tablet, /\.sidebar\s*\{[^}]*translateX\(-105%\)/s);
  assert.match(tablet, /\.sidebar\.mobileOpen\s*\{[^}]*translateX\(0\)/s);
  assert.match(tablet, /\.main\s*\{[^}]*margin-left:\s*0/s);
  assert.match(tablet, /\.menuButton\s*\{[^}]*display:\s*inline-grid/s);
  assert.match(
    tablet,
    /\.workflowStrip\s*\{[^}]*repeat\(2,\s*minmax\(240px,\s*1fr\)\)/s,
  );
});

test("parses real CSV content including BOM, commas and escaped quotes", () => {
  const parsed = parseCsv(
    '\ufeff资产编号,设备名称,收入\r\nYH-001,"CT, 128排",125.6\r\nYH-002,"核磁""A""",88',
  );
  assert.deepEqual(parsed.headers, ["资产编号", "设备名称", "收入"]);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], {
    资产编号: "YH-001",
    设备名称: "CT, 128排",
    收入: "125.6",
  });
  assert.deepEqual(parsed.rows[1], {
    资产编号: "YH-002",
    设备名称: '核磁"A"',
    收入: "88",
  });
});

test("honors the selected CSV delimiter instead of previewing fabricated columns", () => {
  const parsed = parseCsv("设备编号;金额;日期\nCT-01;12,5;2026-08-11", ";");
  assert.deepEqual(parsed.headers, ["设备编号", "金额", "日期"]);
  assert.deepEqual(parsed.rows[0], {
    设备编号: "CT-01",
    金额: "12,5",
    日期: "2026-08-11",
  });
});

test("keeps all eight frontend business template codes seeded by the backend", async () => {
  const migration = await readFile(
    new URL("../drizzle/0009_file_pipeline.sql", import.meta.url),
    "utf8",
  );
  for (const template of FILE_BUSINESS_TEMPLATES) {
    assert.match(
      migration,
      new RegExp(`'${template.code}'`),
      `missing backend seed for ${template.code}`,
    );
  }
});

test("uses one template field contract for alias mapping and CSV downloads", () => {
  for (const template of FILE_BUSINESS_TEMPLATES) {
    const fields = templateFields(template.code);
    assert.ok(
      fields.length >= 6,
      `${template.code} needs a useful field contract`,
    );
    assert.ok(fields.some((field) => field.required));
    assert.ok(buildBusinessTemplateCsv(template.code).startsWith("\ufeff"));
  }
  assert.equal(suggestTemplateField("device_master", "资产编号"), "deviceId");
  assert.equal(suggestTemplateField("exam_activity", "多部位"), "bodyParts");
});

test("does not claim that Excel has been parsed without a workbook parser", () => {
  assert.equal(
    classifyImportFile({ name: "收入台账.csv", size: 1200 }).parseMode,
    "client_csv",
  );
  assert.equal(
    classifyImportFile({ name: "质控记录.json", size: 800 }).parseMode,
    "client_json",
  );
  assert.equal(
    classifyImportFile({ name: "设备台账.xlsx", size: 2400 }).parseMode,
    "server_excel",
  );
  assert.equal(
    classifyImportFile({ name: "说明.pdf", size: 100 }).parseMode,
    "unsupported",
  );
});

test("parses JSON arrays and data envelopes into a tabular preview", () => {
  assert.deepEqual(
    parseJsonRecords('[{"设备":"CT-01","收入":12},{"设备":"CT-02","收入":8}]')
      .headers,
    ["设备", "收入"],
  );
  assert.equal(parseJsonRecords('{"data":[{"设备":"CT-01"}]}').rows.length, 1);
  assert.throws(
    () => parseJsonRecords('{"设备":"CT-01"}'),
    /JSON_ARRAY_REQUIRED/,
  );
});

test("reports step-by-step cleaning impact and keeps row-level quarantine", () => {
  const result = runCleaningPreview(
    [
      { id: "1", code: " CT-01 ", amount: "12" },
      { id: "2", code: "", amount: "bad" },
    ],
    [
      { id: "trim", type: "trim", field: "code", label: "去空格" },
      {
        id: "required",
        type: "required",
        field: "code",
        label: "设备编码必填",
      },
      {
        id: "number",
        type: "number",
        field: "amount",
        label: "金额必须是数字",
      },
    ],
  );
  assert.deepEqual(
    result.steps.map((step) => [step.before, step.after, step.affected]),
    [
      [2, 2, 1],
      [2, 1, 1],
      [1, 1, 0],
    ],
  );
  assert.equal(result.quarantine.length, 1);
  assert.equal(result.rows[0].code, "CT-01");
});

test("normalizes the persisted server cleaning impact without substituting local preview values", () => {
  assert.deepEqual(
    normalizeServerCleaningImpact("import-1", {
      inputRows: 12,
      validRows: 9,
      quarantinedRows: 3,
      issueCount: 4,
      steps: [
        {
          ruleId: "trim-1",
          ruleType: "trim",
          fieldName: "deviceId",
          changedRows: 5,
          issueRows: 0,
          samples: [{ row: 2, before: " CT-1 ", after: "CT-1" }],
        },
      ],
    }),
    {
      importId: "import-1",
      inputRows: 12,
      validRows: 9,
      quarantinedRows: 3,
      issueCount: 4,
      steps: [
        {
          ruleId: "trim-1",
          ruleType: "trim",
          fieldName: "deviceId",
          changedRows: 5,
          issueRows: 0,
          samples: [{ row: 2, before: " CT-1 ", after: "CT-1" }],
        },
      ],
    },
  );
});

test("reconciles two real file row sets by configured keys", () => {
  const result = reconcileFileRows(
    [
      { id: "A", amount: "10" },
      { id: "B", amount: "20" },
    ],
    [
      { id: "A", amount: "10" },
      { id: "C", amount: "30" },
    ],
    { keyFields: ["id"], compareFields: ["amount"] },
  );
  assert.deepEqual(
    {
      matched: result.matched,
      leftOnly: result.leftOnly,
      rightOnly: result.rightOnly,
      changed: result.changed,
    },
    { matched: 1, leftOnly: 1, rightOnly: 1, changed: 0 },
  );
});

test("derives quality totals without hiding quarantined records", () => {
  assert.deepEqual(
    calculateQualitySummary({
      total: 200,
      valid: 174,
      warning: 12,
      rejected: 9,
    }),
    {
      total: 200,
      valid: 174,
      warning: 12,
      rejected: 9,
      unclassified: 5,
      passRate: 87,
    },
  );
});

test("builds a real CSV schema and column profile for raw dataset registration", () => {
  const parsed = parseCsv("设备编号,金额,备注\nCT-01,12.5,\nCT-02,0,复查");
  assert.deepEqual(buildCsvDatasetProfile(parsed), {
    schema: {
      columns: [
        { name: "设备编号", inferredType: "string", nullable: false },
        { name: "金额", inferredType: "decimal", nullable: false },
        { name: "备注", inferredType: "string", nullable: true },
      ],
    },
    profile: {
      rowCount: 2,
      columns: {
        设备编号: { nonEmpty: 2, empty: 0, distinct: 2 },
        金额: { nonEmpty: 2, empty: 0, distinct: 2 },
        备注: { nonEmpty: 1, empty: 1, distinct: 1 },
      },
    },
  });
});

test("exposes an integration-ready accessible React surface", async () => {
  const [component, styles, model] = await Promise.all([
    readFile(new URL("../app/DataWorkbench.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/DataWorkbench.module.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/data-workbench-model.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(component, /export type DataWorkbenchProps/);
  assert.match(component, /hospitalId: string/);
  assert.match(component, /onExit: \(\) => void/);
  assert.match(component, /permissions: readonly string\[\]/);
  assert.match(component, /demoMode\?: boolean/);
  assert.match(component, /demoMode = false/);
  assert.match(component, /isPlatformAdmin\?: boolean/);
  assert.match(component, /isPlatformAdmin = false/);
  assert.doesNotMatch(component, /permissionSet\.has\("source\.manage"\)/);
  for (const resource of [
    "templates",
    "imports",
    "datasets",
    "quarantine",
    "reconciliations",
    "publishedRecords",
  ]) {
    assert.match(model, new RegExp(`"${resource}"`));
  }
  assert.match(component, /crypto\.subtle\.digest\(\s*"SHA-256"/s);
  for (const action of [
    "apply_mapping",
    "advance_import",
    "create_recipe",
    "run_cleaning",
    "repair_quarantine",
    "create_reconciliation_config",
    "run_reconciliation",
    "create_publish",
    "advance_publish",
    "rollback_publish",
  ]) {
    assert.match(component, new RegExp(`"${action}"`));
  }
  assert.doesNotMatch(component, /collections\.mappings\[0\]\?\.id/);
  for (const fieldName of [
    "fieldType",
    "fieldUnit",
    "fieldDictionary",
    "fieldValidation",
    "metricFormula",
    "metricAggregation",
    "metricNumerator",
    "metricDenominator",
    "metricDimensions",
    "visualDimension",
    "visualSeries",
    "visualSort",
  ]) {
    assert.match(component, new RegExp(`name="${fieldName}"`));
  }
  assert.match(model, /\/import-file/);
  assert.match(model, /new FormData\(\)/);
  assert.match(model, /inspectOnly\?: boolean/);
  assert.match(
    model,
    /sheets: Array<\{ name: string; rowCount: number; columnCount: number \}>/,
  );
  assert.match(component, /Excel、CSV、JSON/);
  assert.doesNotMatch(component, /apiBaseUrl}\/publish/);
  assert.match(component, /draft.*pending_review.*approved.*published/s);
  assert.match(component, /加载真实数据/);
  assert.match(component, /FILE_WORKBENCH_RESOURCE_LABELS\[resource\]/);
  assert.match(
    component,
    /FILE_WORKBENCH_STATE_LABELS\[resourceStatus\[resource\]\.state\]/,
  );
  assert.match(component, /暂无真实数据/);
  assert.match(component, /重试/);
  assert.match(component, /accept="\.csv,\.xlsx,\.json"/);
  assert.match(component, /aria-label="数据准备中心导航"/);
  assert.match(component, /收到真实表头、行数和哈希前不会标记为已解析/);
  assert.match(component, /businessTemplateCode/);
  assert.match(component, /sheetName/);
  assert.match(component, /headerRow/);
  assert.match(component, /日期格式/);
  assert.match(component, /数字格式/);
  assert.match(component, /逐步影响/);
  assert.match(component, /serverCleaningImpact/);
  assert.match(component, /setServerCleaningImpact/);
  assert.match(component, /正式服务端执行结果/);
  assert.match(component, /在线修复/);
  assert.match(component, /下载错误/);
  assert.match(component, /发布影响预览/);
  assert.match(component, /reconciliationEnvelope\.differences/);
  assert.match(component, /对账差异明细/);
  assert.match(component, /reconciliationWaiverReason/);
  assert.match(
    component,
    /reconciliationWaiverReason:\s*reconciliationWaiverReason\.trim\(\)/,
  );
  assert.match(component, /医院关注指标基线/);
  assert.match(component, /import_hospital_metric_template/);
  assert.match(component, /activate_hospital_metric_definition/);
  assert.match(component, /metricDefinitionIds: selectedMetricIds/);
  assert.match(
    component,
    /visualizationDefinitionIds: selectedVisualizationIds/,
  );
  assert.match(component, /correctionOfId/);
  assert.match(component, /回滚到此版本/);
  assert.match(component, /item\.status === "superseded"/);
  assert.match(component, /rollbackReason\.trim\(\)\.length < 20/);
  assert.match(component, /comment:\s*rollbackReason\.trim\(\)/);
  assert.match(component, /确认创建回滚草稿/);
  assert.match(component, /item\.recordId/);
  assert.match(component, /baseRevision: row\.revision/);
  assert.match(component, /breakGlassReason/);
  assert.match(component, /创建人不能审核自己的发布/);
  assert.match(component, /更正版本/);
  assert.match(component, /回滚/);
  assert.doesNotMatch(component, /HIS|PACS|RIS|HRP|腾讯云|IoT/);
  assert.match(component, /自定义字段定义/);
  assert.match(component, /名称.*code.*类型.*单位.*字典.*必填.*校验/s);
  assert.match(component, /指标配置/);
  assert.match(component, /聚合 \/ 公式/);
  assert.match(component, /分子.*分母.*维度.*版本/s);
  assert.match(component, /展示配置/);
  for (const chartType of [
    "KPI",
    "表格",
    "柱状",
    "折线",
    "饼图",
    "散点",
    "热力图",
  ]) {
    assert.match(component, new RegExp(chartType));
  }
  assert.match(component, /data-entry-clicks=\{DATA_WORKBENCH_ENTRY_CLICKS\}/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /:focus-visible/);
  assert.doesNotMatch(styles, /font-size:\s*(?:9|10|11)px/);
  assert.doesNotMatch(styles, /outline:\s*(?:0|none)/);
});
