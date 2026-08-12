import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

/**
 * 这一组断言守的是「四个分析页只有一个真相来源」这条架构底线。
 *
 * 改版前的实际状况：alert-rules 一套阈值、CapitalPlanningCenter.classify() 一套风险分、
 * ImprovementCenter 又一套情景测算，三处用同一批底层事实各算一套。
 * 结果是同一台设备，院长在分析页看到"该换"、在资本计划看到"可延寿"。
 * 医院拿这个开会是要出事的，所以下面每一条都不是风格偏好，是不能退回去的边界。
 */

test("四个分析页都从同一个诊断内核取数，没有第二处口径", async () => {
  const [analysis, improvement, capital, platform] = await Promise.all([
    read("app/BenefitAnalysisCenter.tsx"),
    read("app/ImprovementCenter.tsx"),
    read("app/CapitalPlanningCenter.tsx"),
    read("app/EquipmentPlatform.tsx"),
  ]);
  // 三个页面都只接收诊断结果，不自己算
  for (const [name, source] of [["效益分析", analysis], ["运营改进", improvement], ["资本计划", capital]]) {
    assert.match(source, /from "\.\/benefit-diagnosis"/, `${name}页没有引用诊断内核`);
  }
  // 内核只在平台层调用一次，四页共用同一份结果
  assert.equal(
    (platform.match(/buildDiagnoses\(/g) ?? []).length,
    1,
    "buildDiagnoses 被调用多次：四页应共用同一份诊断结果，多次调用会因入参不同再次出现口径分裂",
  );
  assert.match(platform, /diagnoses=\{diagnoses\}/);
});

test("旧的三套重复算法已经拆掉", async () => {
  const [improvement, capital] = await Promise.all([
    read("app/ImprovementCenter.tsx"),
    read("app/CapitalPlanningCenter.tsx"),
  ]);
  // 资本计划不再自己分档与做情景
  assert.doesNotMatch(capital, /^function classify\(/m, "资本计划仍保留自有 classify()");
  assert.doesNotMatch(capital, /^function scenario\(/m, "资本计划仍保留自有 scenario()");
  // 改进中心不再走旧的阈值规则引擎
  assert.doesNotMatch(improvement, /from "\.\/alert-rules"/, "改进中心仍在用旧的 alert-rules 判定问题");
  // 情景测算只剩内核一处
  assert.match(capital, /scenarioFor\(/);
  assert.doesNotMatch(improvement, /scenarioFor\(/, "情景测算应只在资本计划出现，改进中心不再重复");
});

test("闭环的三条去向在平台层接好，页面之间能真正走通", async () => {
  const platform = await read("app/EquipmentPlatform.tsx");
  // 分析页发现问题 → 改进中心建任务
  assert.match(platform, /function routeFindingToImprovement\(deviceId: string, finding: Finding\)/);
  assert.match(platform, /setPendingFinding\(\{ deviceId, finding \}\)/);
  assert.match(platform, /pendingFinding=\{pendingFinding \?\? undefined\}/);
  // 分析页/改进中心 → 资本计划论证
  assert.match(platform, /function routeDeviceToCapital\(deviceId: string\)/);
  assert.match(platform, /focusDeviceId=\{capitalFocusDeviceId \|\| undefined\}/);
  // 缺数 → 回设备数据填报
  assert.match(platform, /function routeDeviceToReporting\(deviceId: string\)/);
  assert.match(platform, /onOpenReporting=\{routeDeviceToReporting\}/);
  // 消费后必须清空，否则下次进页面会重复弹出上一次的问题
  assert.match(platform, /onPendingFindingConsumed=\{\(\) => setPendingFinding\(null\)\}/);
  assert.match(platform, /onFocusConsumed=\{\(\) => setCapitalFocusDeviceId\(""\)\}/);
});

test("分析口径的开关只有一个，四页跟着同一个走", async () => {
  const platform = await read("app/EquipmentPlatform.tsx");
  // onlyConfirmed 只在一处定义，页面通过 props 读同一个值；
  // 各页自己存一份会出现"分析页按正式口径、资本计划按预览口径"这种对不上的账
  assert.match(platform, /const \[analysisOnlyConfirmed, setAnalysisOnlyConfirmed\] = useState\(true\)/);
  assert.match(platform, /onlyConfirmed: analysisOnlyConfirmed/);
  assert.match(platform, /onlyConfirmed=\{analysisOnlyConfirmed\}/);
  // 期间口径同理：一处推导，四页共用同一句人话
  assert.match(platform, /const analysisPeriodLabel = /);
  assert.equal(
    (platform.match(/periodLabel=\{analysisPeriodLabel\}/g) ?? []).length >= 3,
    true,
    "至少效益分析/运营改进/资本计划三页要显示同一个期间口径",
  );
});

test("填报数据真的流到了分析页，不再只读台账年度汇总", async () => {
  const platform = await read("app/EquipmentPlatform.tsx");
  // 改版前四个分析页读的是 Device 上的年度 revenue/cost，
  // 新上线的按月填报数据根本到不了这里，等于填了白填
  assert.match(platform, /records: currentDeviceReports/);
  assert.match(platform, /fields: currentReportFields/);
  assert.match(platform, /workloadOf,/);
  assert.match(platform, /periods: analysisPeriods/);
});

test("菜单已从「采集与分析」改名为「效益分析」，且两处保持一致", async () => {
  const [catalog, platform] = await Promise.all([
    read("app/menu-catalog.ts"),
    read("app/EquipmentPlatform.tsx"),
  ]);
  // 菜单目录（角色勾选用）与左侧导航（渲染用）是两份清单，改名必须同步，
  // 否则角色配置页勾的名字和用户看到的对不上
  assert.match(catalog, /id: "analysis", label: "效益分析"/);
  assert.match(platform, /id: "analysis", label: "效益分析"/);
  assert.doesNotMatch(catalog, /采集与分析/);
  assert.doesNotMatch(platform, /采集与分析/);
});
