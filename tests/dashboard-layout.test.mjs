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
