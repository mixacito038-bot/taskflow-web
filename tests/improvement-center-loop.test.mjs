import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 静态源码断言：运营改进中心是一个纯 UI 页，跑起来要整个平台的上下文；
// 这里守的是「页面只做闭环这一件事」的结构边界，源码级检查足够稳、也不会被样式改动带偏。
const source = await readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8");
const moduleCss = await readFile(new URL("../app/ImprovementAlerts.module.css", import.meta.url), "utf8");

/** 取出文件里所有 import 的来源模块，用来核对依赖，而不是在全文里瞎搜关键字。 */
function importSources(code) {
  return [...code.matchAll(/import\s+(?:type\s+)?[\s\S]*?from\s+"([^"]+)";/g)].map((match) => match[1]);
}

test("三段行业案例说明文被整块删除", () => {
  // 用户明确说「多余的解释」要删：三张实践卡是纯说明文，既不驱动任务也不产生数据。
  for (const removed of [
    "行业优秀实践如何落到系统",
    "大型医用设备绩效专项审计",
    "WHO 设备台账与维护信息系统",
    "NHS CT 需求—产能改进",
    "practiceCards",
  ]) {
    assert.ok(!source.includes(removed), `行业实践残留：${removed}`);
  }
});

test("情景测算与资源配置建议已搬去资本计划页", () => {
  // 处置情景只应有一套引擎（资本计划），本页留着就是两套口径打架。
  for (const removed of [
    "单机效益情景测算",
    "方案前后效益对比",
    "全生命周期资源配置建议",
    "需求—产能周监测",
    "weeklyFlow",
    "saveScenario",
  ]) {
    assert.ok(!source.includes(removed), `情景/配置残留：${removed}`);
  }
});

test("不再依赖 recharts 图表库", () => {
  // 平台离线部署，其它新页都是手写 SVG / CSS 进度条，本页不该再拉图表库进来。
  const sources = importSources(source);
  assert.ok(!sources.includes("recharts"), `仍在 import recharts：${sources.join(", ")}`);
  for (const symbol of ["ResponsiveContainer", "BarChart", "LineChart", "CartesianGrid", "ReferenceLine"]) {
    assert.ok(!source.includes(symbol), `图表组件残留：${symbol}`);
  }
});

test("预警改由诊断内核的 findings 驱动，不再 import alert-rules", () => {
  // 阈值统一由 benefit-diagnosis 管；页面上再配一套规则就会出现两个口径的「预警」。
  const sources = importSources(source);
  assert.ok(sources.includes("./benefit-diagnosis"), `没有从诊断内核取类型：${sources.join(", ")}`);
  assert.ok(!sources.some((item) => item.includes("alert-rules")), "仍在 import alert-rules");
  for (const symbol of ["defaultAlertRules", "evaluateAlertRules", "validateAlertRule", "预警规则配置", "alertThresholdBounds"]) {
    assert.ok(!source.includes(symbol), `旧预警规则残留：${symbol}`);
  }
  assert.match(source, /diagnoses\.flatMap\(/);
  assert.match(source, /diagnosis\.findings\.map\(/);
});

test("只认领 route 为 improvement 的问题，capital 转资本计划、data 不出现", () => {
  // 三条去向各归各家：改进任务留在本页，更新处置去资本计划，缺数据是填报的事。
  assert.match(source, /row\.finding\.route !== "improvement"/);
  assert.match(source, /row\.finding\.route === "capital"/);
  assert.match(source, /onSendToCapital\(row\.facts\.deviceId\)/);
  assert.ok(!source.includes('route === "data"'), "本页不应处理 data 路由的问题");
});

test("问题证据原文在待认领清单里真的渲染出来", () => {
  // 证据不显示就等于没有证据：认领的人必须能当场核对，所以不折叠、不截断。
  assert.match(source, /className=\{styles\.findingEvidence\}>\{row\.finding\.evidence\}/);
  assert.match(moduleCss, /\.findingEvidence\s*\{[^}]*font-size: 12px/);
});

test("已认领的问题带任务标题单列，不再重复出现在待认领里", () => {
  // 同一条问题既在待办又在看板会让人重复建任务，所以按认领与否二选一地分流。
  assert.match(source, /const owner = actions\.find\(\(action\) => matchesFinding\(action, row\.facts\.deviceId, row\.finding\)\)/);
  assert.match(source, /if \(owner\) claimed\.push\(\{ \.\.\.row, action: owner \}\);\s*\n\s*else pending\.push\(row\);/);
  assert.match(source, /claimedRows\.map\(/);
  assert.match(source, /\{row\.action\.title\}/);
  assert.match(source, /已认领/);
});

test("认领判定优先用 sourceFinding，老任务按标题文本兼容", () => {
  // initialActions 与已存档数据没有 sourceFinding，只能退回文本匹配，否则老任务会被判成未认领。
  assert.match(source, /sourceFinding\?: ActionSource;/);
  assert.match(source, /export type ActionSource = \{ deviceId: string; code: FindingCode; title: string \}/);
  assert.match(source, /if \(action\.sourceFinding\) \{[\s\S]*?action\.sourceFinding\.code === finding\.code;/);
  assert.match(source, /action\.deviceId === deviceId && \(action\.issue\.includes\(finding\.title\) \|\| action\.title\.includes\(finding\.title\)\)/);
  assert.match(source, /sourceFinding: \{ deviceId, code: finding\.code, title: finding\.title \}/);
});

test("pendingFinding 进页面即打开新建弹窗并回告已消费", () => {
  // 从效益分析页点「建改进任务」跳过来，不预填就等于让人把问题再抄一遍；
  // 不回告 consumed 则切页回来会反复弹窗。
  // 弹窗草稿走惰性初值：切到本页是全新挂载，放进 effect 会先渲染一帧没有弹窗的页面。
  assert.match(source, /useState<ActionDraft \| null>\(\(\) => \{\s*\n\s*if \(!pendingFinding\) return null;/);
  assert.match(source, /return draftFromFinding\(pendingFinding\.deviceId, pendingFinding\.finding, facts\);/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?onPendingFindingConsumed\?\.\(\);/);
  assert.match(source, /consumedRef\.current \|\| !pendingFinding/);
  // 预填内容来自 finding 与 facts：标题用建议、描述保留证据、基线取对应事实。
  assert.match(source, /title: finding\.suggestion/);
  assert.match(source, /issue: `\$\{finding\.title\}：\$\{finding\.evidence\}`/);
  assert.match(source, /baselineValue: numberText\(baseline\.value\)/);
});

test("逾期任务有统一判定并在看板上显著标红", () => {
  // 逾期是唯一需要当场处理的信号，判定只留一处，样式上整卡描红加逾期天数。
  assert.match(source, /function isOverdue\(action: ImprovementAction, today: string\) \{\s*\n\s*return action\.status !== "已完成" && action\.dueDate < today;/);
  assert.match(source, /overdue \? styles\.taskOverdue : ""/);
  assert.match(source, /className=\{styles\.overdueTag\}/);
  assert.match(source, /逾期 \{overdueDays\(action\.dueDate, today\)\} 天/);
  assert.match(moduleCss, /\.taskOverdue\s*\{[^}]*var\(--red\)/);
  assert.match(moduleCss, /\.overdueTag\s*\{[^}]*color: var\(--red\)/);
});

test("状态变更写入 history", () => {
  // 闭环要能追溯：谁在什么时候把任务推到哪一档，推进和编辑两条路径都得留痕。
  assert.match(source, /history: \[\s*\n\s*\.\.\.\(item\.history \?\? \[\]\),\s*\n\s*\{ at: today, status: next, note: `状态由「\$\{action\.status\}」推进到「\$\{next\}」` \},/);
  assert.match(source, /const statusChanged = existing\.status !== status;/);
  assert.match(source, /statusChanged\s*\n?\s*\? \[\.\.\.\(item\.history \?\? \[\]\), \{ at: today, status, note: `编辑任务并改为「\$\{status\}」` \}\]/);
  assert.match(source, /note: "由待认领问题建立改进任务"/);
});

test("module.css 字号不小于 12px 且不写裸十六进制颜色", () => {
  // 12px 是这套平台的最小可读字号；颜色走主题变量才能在浅色/teal/深色三套主题下都能看，
  // 半透明阴影用 rgba 是例外，它跟着底色走。
  const fontSizes = [...moduleCss.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(fontSizes.length > 0, "样式里应当有字号声明");
  assert.deepEqual(fontSizes.filter((size) => size < 12), [], "存在小于 12px 的字号");
  const hexColors = moduleCss.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hexColors, [], `存在裸十六进制颜色：${hexColors.join(", ")}`);
});

test("ImprovementAction 与 initialActions 仍然导出", () => {
  // cloud-state.ts 与 EquipmentPlatform.tsx 都依赖这两个导出，精简页面不能顺手把它们删了。
  assert.match(source, /export type ImprovementAction = \{/);
  assert.match(source, /export const initialActions: ImprovementAction\[\] = \[/);
  assert.match(source, /export type ActionStatus =/);
  assert.match(source, /export type Priority =/);
  // 老数据里没有 sourceFinding，字段必须是可选的，否则历史任务无法通过类型检查。
  assert.ok(!/sourceFinding: \{ deviceId: string/.test(source), "sourceFinding 不能是必填字段");
});

test("组件签名与接线契约逐项一致", () => {
  // 父页面按这份签名接线，少一个参数就渲染不出来，多一个默认值会掩盖没接上的错误。
  for (const prop of [
    "diagnoses: DeviceDiagnosis[];",
    "actions: ImprovementAction[];",
    "setActions: Dispatch<SetStateAction<ImprovementAction[]>>;",
    "periodLabel: string;",
    "onSelectDevice: (deviceId: string) => void;",
    "onSendToCapital: (deviceId: string) => void;",
    'notify: (message: string, tone?: "info" | "error") => void;',
    "canManage: boolean;",
    "pendingFinding?: { deviceId: string; finding: Finding };",
    "onPendingFindingConsumed?: () => void;",
  ]) {
    assert.ok(source.includes(prop), `签名缺少：${prop}`);
  }
  // 旧签名里的 devices / publishedData / demoMode 已经不属于本页。
  for (const removed of ["devices: Device[]", "publishedData?: PublishedDatasetView", "demoMode?: boolean"]) {
    assert.ok(!source.includes(removed), `旧入参残留：${removed}`);
  }
});

test("页面只剩四块：概览、待认领问题、任务闭环看板、目标达成", () => {
  // 这一页只做「问题 → 任务 → 目标 → 兑现」，多一块就是把别的页的活揽过来。
  for (const kept of ["问题到收益的闭环", "运营改进中心", "待认领问题", "任务闭环看板", "目标达成"]) {
    assert.ok(source.includes(kept), `缺少保留区块：${kept}`);
  }
  const panels = source.match(/aria-label="(闭环概览|待认领问题|任务闭环看板|目标达成)"/g) ?? [];
  assert.equal(panels.length, 4, `主体面板应为 4 块，实际 ${panels.length}`);
  // 概览五个数值卡对应闭环的五个口子。
  for (const card of ["待认领问题", "进行中任务", "本期已完成", "已兑现收益", "逾期任务"]) {
    assert.ok(source.includes(card), `概览缺少数值卡：${card}`);
  }
});

test("目标达成用 CSS 进度条展示基线→目标→实际", () => {
  // 达成率对「越高越好」和「越低越好」都要成立，所以按基线到目标这段距离折算，而不是直接比大小。
  assert.match(source, /function achievement\(action: ImprovementAction\)/);
  assert.match(source, /const span = targetValue - baselineValue;/);
  assert.match(source, /\(\(actualValue - baselineValue\) \/ span\) \* 100/);
  assert.match(source, /<div className=\{styles\.targetBar\}>/);
  assert.match(source, /style=\{\{ width: `\$\{rate\}%` \}\} data-reached=\{rate >= 100\}/);
  assert.match(moduleCss, /\.targetBar i\[data-reached="true"\]\s*\{[^}]*var\(--green\)/);
});

test("无管理权限时不给出改动入口，写操作也被挡住", () => {
  // canManage 为假时只读：只藏按钮不挡函数，等于把权限做成了样式。
  assert.match(source, /function guard\(\) \{\s*\n\s*if \(canManage\) return true;/);
  assert.match(source, /当前账号只能查看改进任务，不能新建或修改", "error"/);
  assert.match(source, /if \(!draft \|\| !guard\(\)\) return;/);
  assert.match(source, /\{canManage \? \(/);
});
