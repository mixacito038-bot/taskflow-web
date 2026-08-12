import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 全部走源码静态断言：这页是 React 组件，没有 DOM 环境也要能在 CI 里守住那几条会静默改坏口径的规则。
const source = await readFile(new URL("../app/ReportFieldSettings.tsx", import.meta.url), "utf8");

test("组件签名与接线保持一致，且不新建样式文件", () => {
  assert.match(source, /export default function ReportFieldSettings\(\{\s*fields,\s*onChange,\s*canManage,\s*notify,\s*onBack,\s*\}/);
  // 全局类够用；再加一份 module.css 会让两个字段配置页的手感慢慢分叉
  assert.doesNotMatch(source, /\.module\.css/);
});

test("生效清单按六组分区，且以合并后的字段为准", () => {
  // fields 只是覆盖层，直接拿它渲染会漏掉 18 项出厂字段
  assert.match(source, /mergeReportFields\(fields\)/);
  assert.match(source, /reportFieldsByGroup\(effective\)/);
  assert.match(source, /\{group\.label\}/);
  assert.match(source, /\{group\.hint\}/);
  assert.match(source, /\{groupFields\.length\} 项/);
});

test("覆盖层只改可改的几项，其余原样带上出厂值", () => {
  // 缺项写进覆盖层，mergeReportFields 合出来就是残缺定义
  assert.match(source, /\.\.\.editingFactory,[\s\S]{0,320}labelPattern:[\s\S]{0,320}unit:[\s\S]{0,320}required:[\s\S]{0,320}hint:[\s\S]{0,320}order:/);
  // key / source / type / countsToCost 不出现在改写分支里，说明没被覆盖
  const rewriteStart = source.indexOf("...editingFactory,");
  const rewriteEnd = source.indexOf("}", source.indexOf("order: draft.order", rewriteStart));
  const rewrite = source.slice(rewriteStart, rewriteEnd);
  assert.doesNotMatch(rewrite, /\bkey:/);
  assert.doesNotMatch(rewrite, /\bsource:/);
  assert.doesNotMatch(rewrite, /\btype:/);
  assert.doesNotMatch(rewrite, /countsToCost:/);
});

test("出厂 18 项不可删，删除按钮禁用并说明原因", () => {
  assert.match(source, /field\.builtin \? \(/);
  assert.match(source, /disabled\s*\n?\s*title="出厂字段的口径被指标字典引用，删了指标就断了；不需要可以设为选填"/);
  // 自定义项才走确认删除
  assert.match(source, /setConfirmAction\(\{ kind: "remove", field \}\)/);
});

test("编辑时标识锁定，并讲清为什么不能改", () => {
  assert.match(source, /const keyLocked = editingKey !== null/);
  assert.match(source, /disabled=\{keyLocked\}/);
  assert.match(source, /标识创建后不可修改：已填的数据以它为下标/);
});

test("出厂项的「计入总成本」不可改", () => {
  assert.match(source, /const factoryLocked = editingFactory !== undefined/);
  assert.match(source, /countsToCost \? "yes" : "no"\}\s*disabled=\{factoryLocked\}/);
  assert.match(source, /出厂字段是否计入成本由平台口径固定，不可改，否则总成本会和指标字典对不上/);
});

test("业务量三项标注为数据准备中心导入", () => {
  for (const key of ["examVolume", "positiveCount", "totalRevenue"]) assert.match(source, new RegExp(key));
  assert.match(source, /由数据准备中心表格上传，不在填报页手工填/);
  assert.match(source, /数据准备中心导入/);
});

test("{期} 占位符有五种粒度的实时预览", () => {
  assert.match(source, /const PREVIEW_GRANULARITIES: readonly PeriodGranularity\[\] = \["day", "week", "month", "quarter", "range"\]/);
  // 预览直接用渲染填报页的同一个函数，避免预览和实际显示两套拼法
  assert.match(source, /PREVIEW_GRANULARITIES\.map\(\(granularity\) => \([\s\S]{0,320}reportFieldLabel\(\{ \.\.\.draft, labelPattern: previewPattern \}, granularity\)/);
  assert.match(source, /PERIOD_GRANULARITY_LABELS\[granularity\]/);
});

test("恢复出厂就是清空覆盖层，且必须先确认", () => {
  assert.match(source, /onChange\(\[\]\)/);
  assert.match(source, /setConfirmAction\(\{ kind: "reset" \}\)/);
  assert.match(source, /modal-backdrop confirmation-modal/);
  assert.match(source, /confirmation-dialog/);
  assert.match(source, /danger-button/);
  assert.match(source, /恢复出厂字段？/);
});

test("无权限时只读，且顶部有提示", () => {
  assert.match(source, /!canManage \?/);
  assert.match(source, /dialog-warning/);
  assert.match(source, /当前角色只能查看，修改需要「设备数据填报」管理权限/);
});

test("没有小于 12px 的字号", () => {
  // 平台硬性规定：12px 以下在科室的老显示器上根本看不清
  const sizes = [...source.matchAll(/fontSize:\s*"?(\d+)/g)].map((matched) => Number(matched[1]));
  assert.ok(sizes.length > 0, "没扫到内联字号，正则或写法变了");
  for (const size of sizes) assert.ok(size >= 12, `存在 ${size}px 字号，最小只能到 12px`);
});
