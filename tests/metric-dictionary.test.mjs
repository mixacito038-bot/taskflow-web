import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_METRIC_CATEGORIES,
  DEFAULT_METRIC_DICTIONARY,
  METRIC_CATEGORY_TONES,
  evidenceTone,
  metricCategory,
} from "../app/metric-dictionary.ts";

test("出厂指标字典与医院原表逐字一致，一条不少", async () => {
  const raw = await readFile(new URL("../tests/fixtures/metric-dictionary-source.json", import.meta.url), "utf8");
  const source = JSON.parse(raw);
  assert.equal(DEFAULT_METRIC_DICTIONARY.length, source.length, "指标条数与原表不符");
  for (const [index, expected] of source.entries()) {
    const actual = DEFAULT_METRIC_DICTIONARY[index];
    assert.equal(actual.seq, Number(expected.seq));
    assert.equal(actual.name, expected.name.replace(/\n/g, "").trim());
    // 口径与依据出处是医院签过字的原文，平台只承载不改写——改一个字就是造假
    assert.equal(actual.formula, expected.formula, `第 ${expected.seq} 条计算口径被改动`);
    assert.equal(actual.source, expected.source, `第 ${expected.seq} 条理论依据出处被改动`);
    assert.equal(actual.system, expected.system, `第 ${expected.seq} 条取数系统被改动`);
    assert.equal(actual.note, expected.note, `第 ${expected.seq} 条备注被改动`);
    assert.equal(actual.evidence, expected.evidence, `第 ${expected.seq} 条依据判定被改动`);
  }
});

test("每条指标都挂在一个真实存在的分类下", () => {
  const ids = new Set(DEFAULT_METRIC_CATEGORIES.map((category) => category.id));
  for (const entry of DEFAULT_METRIC_DICTIONARY) {
    assert.ok(ids.has(entry.categoryId), `${entry.name} 的分类 ${entry.categoryId} 不存在`);
  }
  // id 不能重复，否则设置页里改一条会连带改另一条
  const seen = new Set(DEFAULT_METRIC_DICTIONARY.map((entry) => entry.id));
  assert.equal(seen.size, DEFAULT_METRIC_DICTIONARY.length);
  for (const category of DEFAULT_METRIC_CATEGORIES) {
    assert.ok(METRIC_CATEGORY_TONES.includes(category.tone), `${category.label} 用了不存在的颜色标签`);
  }
});

test("依据判定的配色按档位而不是按整串原文", () => {
  // 原文常带"（资料+行业标准）"这类尾巴，不能因此判错色
  assert.equal(evidenceTone("是"), "success");
  assert.equal(evidenceTone("是（资料直接参考）"), "success");
  assert.equal(evidenceTone("部分相关"), "warning");
  assert.equal(evidenceTone("部分相关（资料+行业标准）"), "warning");
  assert.equal(evidenceTone("否"), "neutral");
  assert.equal(evidenceTone("否（行业标准补充）"), "neutral");
  assert.equal(evidenceTone(""), "neutral");
});

test("分类查找找不到时返回 undefined，而不是瞎给一个", () => {
  assert.equal(metricCategory(DEFAULT_METRIC_CATEGORIES, "economic")?.label, "经济效益");
  assert.equal(metricCategory(DEFAULT_METRIC_CATEGORIES, "不存在的分类"), undefined);
});

test("指标字典面板按 xlsx 口径出列，且旧的三块治理面板已删", async () => {
  const views = await readFile(new URL("../app/InsightViews.tsx", import.meta.url), "utf8");
  assert.match(views, /<h3>指标字典<\/h3>/);
  assert.match(views, /<th>理论依据出处（详细）<\/th>/);
  assert.match(views, /<th>数据来源\/取数系统<\/th>/);
  assert.match(views, /<th>备注<\/th>/);
  // 标题里的问句式副标题、示例值角标都要没了
  assert.doesNotMatch(views, /值从哪里来、怎么算、谁确认/);
  assert.doesNotMatch(views, /示例值均为模拟/);
  assert.doesNotMatch(views, /个核心指标；信息部负责取数过程/);
  // 三块被删的面板
  assert.doesNotMatch(views, /口径评审记录/);
  assert.doesNotMatch(views, /三类数据采集路径/);
  assert.doesNotMatch(views, /部门责任矩阵/);
  // 分类标签与筛选不能再硬编码
  assert.match(views, /metricCategory\(categories, entry\.categoryId\)/);
  assert.match(views, /metric-tag tone-/);
});

test("指标字典页只留标题、模板下载与指标字典正文", async () => {
  const platform = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(platform, /明确每类 Excel\/CSV\/JSON 文件的字段/);
  assert.doesNotMatch(platform, /文件数据清单/);
  assert.doesNotMatch(platform, /核心字段映射与责任人/);
  // 下载模板保留
  assert.match(platform, /下载文件字段模板/);
  // 回收站里的条目不能出现在分析页
  assert.match(platform, /<MetricGovernanceCenter entries=\{activeMetrics\(metricEntries\)\} categories=\{metricCategories\} \/>/);
});

test("指标字典可在设置页配置，并按医院存到云端", async () => {
  const [settings, cloud, store, platform] = await Promise.all([
    readFile(new URL("../app/MetricDictionarySettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(cloud, /"metricDictionary"/);
  assert.match(cloud, /"metricCategories"/);
  assert.match(store, /metricDictionary: "source\.manage"/);
  // 分类和颜色标签都要能配
  assert.match(settings, /METRIC_CATEGORY_TONES/);
  assert.match(settings, /理论依据出处/);
  assert.match(settings, /数据来源\/取数系统/);
  assert.match(platform, /view === "metric-dictionary"/);
  assert.match(platform, /指标字典配置/);
});

test("审计策略板块已从医院与权限页移除", async () => {
  const center = await readFile(new URL("../app/AccessControlCenter.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(center, /审计与复核策略/);
  assert.doesNotMatch(center, /授权与访问日志/);
  assert.doesNotMatch(center, /save_audit_policy/);
  // 医院/成员/角色三个标签页必须还在
  assert.match(center, /type AccessTab = "hospitals" \| "members" \| "roles"/);
});

test("软删除进回收站：主列表不显示，回收站按删除时间倒序", async () => {
  const { activeMetrics, deletedMetrics } = await import("../app/metric-dictionary.ts");
  const entries = [
    { id: "a", seq: 1, name: "甲", categoryId: "economic", formula: "", evidence: "", source: "", system: "", note: "" },
    { id: "b", seq: 2, name: "乙", categoryId: "economic", formula: "", evidence: "", source: "", system: "", note: "", deletedAt: "2026-08-13T01:00:00.000Z" },
    { id: "c", seq: 3, name: "丙", categoryId: "economic", formula: "", evidence: "", source: "", system: "", note: "", deletedAt: "2026-08-13T02:00:00.000Z" },
  ];
  assert.deepEqual(activeMetrics(entries).map((e) => e.id), ["a"]);
  // 最近删的排最前，方便误删后马上还原
  assert.deepEqual(deletedMetrics(entries).map((e) => e.id), ["c", "b"]);
  // 不得就地修改入参
  assert.equal(entries.length, 3);
});

test("配置页具备恢复默认、删除确认与回收站，且弹窗沿用既有样式", async () => {
  const settings = await readFile(new URL("../app/MetricDictionarySettings.tsx", import.meta.url), "utf8");
  assert.match(settings, /恢复默认/);
  assert.match(settings, /DEFAULT_METRIC_DICTIONARY/);
  // 恢复默认必须连分类一起恢复，否则默认条目会挂到不存在的分类上变孤儿
  assert.match(settings, /onCategoriesChange\(/);
  assert.match(settings, /回收站/);
  assert.match(settings, /还原/);
  assert.match(settings, /deletedMetrics/);
  assert.match(settings, /activeMetrics/);
  // 删除不再是点了就删
  assert.match(settings, /new Date\(\)\.toISOString\(\)/);
  // 确认弹窗沿用仓库既有的一套，而不是另造
  assert.match(settings, /modal-backdrop confirmation-modal/);
  assert.match(settings, /confirmation-dialog/);
  assert.match(settings, /danger-button/);
});

test("指标字典表格恢复表格布局：首列不再是 flex", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // td 一旦 display:flex 就退出表格布局，列宽与 vertical-align 全部失效，
  // 这正是之前"左右两边都乱了"的根因，不能再退回去。
  assert.match(css, /\.metric-dictionary \.dictionary-table td:first-child \{ display: table-cell; \}/);
  assert.match(css, /\.metric-dictionary \.dictionary-table \{ table-layout: fixed/);
  assert.match(css, /vertical-align: top/);
});
