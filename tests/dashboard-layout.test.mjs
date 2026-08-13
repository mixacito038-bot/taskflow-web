import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard modules carry an optional height profile in the shared data model", async () => {
  const mock = await readFile(new URL("../app/mock-data.ts", import.meta.url), "utf8");
  assert.match(mock, /export type ModuleHeight = "compact" \| "standard" \| "tall";/);
  assert.match(mock, /height\?: ModuleHeight;/);
  // Stored layouts written before the height field must keep loading: the
  // initial modules stay height-free and the renderer defaults to "standard".
  const initialModulesBlock = mock.slice(mock.indexOf("export const initialModules"), mock.indexOf("export const initialCostEntries"));
  assert.ok(initialModulesBlock.length > 0, "initialModules must stay in mock-data.ts");
  assert.doesNotMatch(initialModulesBlock, /height:/);
});

test("cockpit offers an in-place layout editor gated by member.manage", async () => {
  const platform = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.match(platform, /hasPermission\("member\.manage"\)[^\n]*\n[^\n]*toggleLayoutEditing/, "the 编辑布局 toggle must sit behind member.manage");
  assert.match(platform, /\{layoutEditing \? "完成布局" : "编辑布局"\}/);
  assert.match(platform, /const \[layoutEditing, setLayoutEditing\] = useState\(false\)/);
});

test("cockpit modules render height classes and drag-reorder handlers while editing", async () => {
  const platform = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.match(platform, /module module-\$\{module\.size\} module-h-\$\{module\.height \?\? "standard"\}/);
  assert.match(platform, /draggable=\{layoutEditing\}/);
  assert.match(platform, /onDragStart=\{layoutEditing \? \(\) => setDraggingModule\(module\.id\) : undefined\}/);
  assert.match(platform, /onDragOver=\{layoutEditing \? \(event\) => event\.preventDefault\(\) : undefined\}/);
  assert.match(platform, /onDrop=\{layoutEditing \? \(\) => dropModule\(module\.id\) : undefined\}/);
  assert.match(platform, /function stepModuleSize\(id: string, direction: -1 \| 1\)/);
  assert.match(platform, /function stepModuleHeight\(id: string, direction: -1 \| 1\)/);
  assert.match(platform, /className="module-layout-controls"/);
  // Exiting edit mode persists through the cloud-synced setModules path and
  // surfaces the existing toast.
  assert.match(platform, /function toggleLayoutEditing\(\)[\s\S]{0,400}setModules\(\(current\) => \[\.\.\.current\]\)[\s\S]{0,200}notify\("驾驶舱布局已保存/);
});

test("layout configuration keeps parity with a height control next to width", async () => {
  const platform = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.match(platform, /const heightLabels: Record<ModuleHeight, string> = \{\n  compact: "紧凑",\n  standard: "标准",\n  tall: "加高",\n\};/);
  assert.match(platform, /<span>高度<\/span><select value=\{module\.height \?\? "standard"\}/);
  assert.match(platform, /height: event\.target\.value as ModuleHeight/);
});

test("globals.css defines module height tiers, edit affordances and mobile relaxation", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.module-h-compact \{ min-height: 260px; \}/);
  assert.match(css, /\.module-h-standard \{ min-height: 340px; \}/);
  assert.match(css, /\.module-h-tall \{ min-height: 460px; \}/);
  assert.match(css, /\.module-h-compact, \.module-h-standard, \.module-h-tall \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.module-editing \{[^}]*outline: 2px dashed var\(--primary\)/);
  assert.match(css, /\.module-layout-controls \{[^}]*position: absolute/);
  assert.match(css, /\.module-control-group \{/);
  // Small screens collapse the grid to one column and drop the fixed heights.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.module-h-compact, \.module-h-standard, \.module-h-tall \{ min-height: 0; \}/);
});

test("configurable analytics canvas accepts an explicit pixel height", async () => {
  const canvas = await readFile(new URL("../app/ConfigurableAnalyticsCanvas.tsx", import.meta.url), "utf8");
  assert.match(canvas, /height\?: number;/);
  assert.match(canvas, /style=\{typeof height === "number" \? \{ height \} : undefined\}/);
});

test("驾驶舱标题行按可用空间换行，而不是把标题压窄或把按钮顶出页面", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // 驾驶舱标题行比其它页多一个「行业看板 / 指标字典看板」切换，加上投屏、编辑布局、
  // 配置驾驶舱、生成效益报告，操作区自身就要 800px 出头：1024px 实测把页面顶宽 140px。
  // 全局 .heading-actions 带 flex-shrink: 0（否则中文按钮会被压成竖排），这条不能动。
  assert.match(css, /\.heading-actions \{[^}]*flex-shrink: 0/, "全局操作区仍要禁止压缩，否则按钮文字会被挤变形");
  const block = css.slice(css.indexOf("@media (min-width: 721px)"));
  assert.ok(block.startsWith("@media (min-width: 721px)"), "缺少驾驶舱标题行的换行规则");
  const body = block.slice(0, block.indexOf("\n}") + 2);
  assert.match(body, /\.cockpit-heading \{[^}]*flex-wrap: wrap/);
  // 关键是 basis 而不是断点：顶栏支持 110%/125% 缩放，媒体查询的 px 数对不上真实可用宽度
  assert.match(body, /\.cockpit-heading > :first-child \{[^}]*flex: 1 1 420px/);
  assert.match(body, /\.cockpit-heading \.heading-actions \{[^}]*flex-wrap: wrap/);
  // 容器可以被压窄触发换行，按钮本身不压缩：是「换行」不是「压扁」
  assert.match(body, /\.cockpit-heading \.heading-actions > \* \{[^}]*flex: 0 0 auto/);
});
