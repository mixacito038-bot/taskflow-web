import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const platformUrl = new URL("../app/EquipmentPlatform.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const mockUrl = new URL("../app/mock-data.ts", import.meta.url);

test("cockpit offers a projection mode with fullscreen, auto-rotation and an exit overlay", async () => {
  const platform = await readFile(platformUrl, "utf8");
  assert.match(platform, /<MonitorPlay size=\{17\} \/>投屏模式/, "the cockpit heading must expose a 投屏模式 button");
  assert.match(platform, /function enterProjectionMode\(\)/);
  assert.match(platform, /function exitProjectionMode\(\)/);
  assert.match(platform, /document\.documentElement\.requestFullscreen\?\.\(\)\.catch\(\(\) => undefined\)/);
  assert.match(platform, /document\.exitFullscreen\(\)\.catch\(\(\) => undefined\)/);
  // The shell root carries a projection-mode class that drives the CSS overrides.
  assert.match(platform, /\$\{projectionMode \? " projection-mode" : ""\}/);
  // Auto-rotation loops every 15 seconds through the visible modules.
  assert.match(platform, /window\.setInterval\([\s\S]{0,400}scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)[\s\S]{0,80}\}, 15000\)/);
  assert.match(platform, /return \(\) => window\.clearInterval\(timer\)/);
  // Escape exits projection mode.
  assert.match(platform, /if \(event\.key !== "Escape"\) return;[\s\S]{0,200}setProjectionMode\(false\)/);
  // The slim overlay bar shows hospital, period, a static label plus pause and exit controls.
  assert.match(platform, /className="projection-overlay"/);
  assert.match(platform, /效益驾驶舱投屏/);
  assert.match(platform, /\{projectionPaused \? "继续轮播" : "暂停轮播"\}/);
  assert.match(platform, /退出投屏/);
});

test("globals.css hides the chrome in projection mode and styles the overlay bar", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.projection-mode \.sidebar,[\s\S]{0,200}\.projection-mode \.topbar,[\s\S]{0,120}\.projection-mode \.page-heading,[\s\S]{0,120}\{ display: none; \}/);
  assert.match(css, /\.projection-mode \.main-shell \{ margin-left: 0; \}/);
  assert.match(css, /\.projection-mode \.content \{ width: 100%; max-width: none;/);
  assert.match(css, /\.projection-overlay \{ position: fixed;/);
  // Mobile keeps a sane full-width fallback.
  assert.match(css, /@media \(max-width: 900px\) \{\n  \.projection-overlay \{ flex-wrap: wrap;/);
});

test("device deep links resolve ?device= and safe ?view= parameters once, then clean the URL", async () => {
  const platform = await readFile(platformUrl, "utf8");
  assert.match(platform, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(platform, /params\.get\("device"\)/);
  assert.match(platform, /params\.get\("view"\)/);
  assert.match(platform, /const safeViews: View\[\] = \["cockpit", "analysis", "equipment", "detail"\]/);
  assert.match(platform, /devices\.some\(\(device\) => device\.id === deviceParam\)[\s\S]{0,120}setSelectedDeviceId\(deviceParam\);\s*setView\("detail"\)/);
  assert.match(platform, /window\.history\.replaceState\(null, "", `\$\{window\.location\.pathname\}\$\{window\.location\.hash\}`\)/);
  // The deep link is consumed exactly once.
  assert.match(platform, /const deepLinkHandled = useRef\(false\)/);
});

test("deep links carry hospital context and never strand ?view behind an empty device list", async () => {
  const platform = await readFile(platformUrl, "utf8");
  assert.match(platform, /params\.get\("hospital"\)/);
  // 有权限就切院再解析设备，无权限如实告知，不静默落到当前医院。
  assert.match(platform, /accessibleHospitals\.some\(\(hospital\) => hospital\.id === hospitalParam\)[\s\S]{0,80}setActiveHospitalIdLocal\(hospitalParam\)/);
  assert.match(platform, /扫码指向的医院不在当前账号的授权范围/);
  // 只在发布数据仍在读取时等待；读完仍为空要照常消费，否则同一条深链的 ?view 会被一起卡死。
  assert.match(platform, /if \(deviceParam && !devices\.length && !demoMode && publishedLoading\) return;/);
  assert.doesNotMatch(platform, /if \(deviceParam && !devices\.length\) return;/);
  // 切院只允许发生一次，避免"切院→数据重载→再切院"的循环。
  assert.match(platform, /const deepLinkHospitalSwitched = useRef\(false\)/);
});

test("the group hospital comparison module is registered and wired to HospitalComparePanel", async () => {
  const [platform, mock] = await Promise.all([
    readFile(platformUrl, "utf8"),
    readFile(mockUrl, "utf8"),
  ]);
  assert.match(mock, /\{ id: "hospital-compare", name: "集团医院对比", description: "同集团医院核心效益指标横向对比", visible: false, size: "full" \}/);
  assert.match(mock, /export function cloneDevicesForHospital\(hospitalId: string\): Device\[\]/);
  assert.match(platform, /module\.id === "hospital-compare"/);
  assert.match(platform, /<HospitalComparePanel/);
  assert.match(platform, /activeHospitalId=\{effectiveHospitalId\}/);
  assert.match(platform, /onSwitchHospital=\{switchHospital\}/);
});

test("设备数据填报接管旧成本填报页，并保留旧记录的迁移出口", async () => {
  const [platform, center] = await Promise.all([
    readFile(platformUrl, "utf8"),
    readFile(new URL("../app/DeviceReportCenter.tsx", import.meta.url), "utf8"),
  ]);
  // 旧的三段式成本表单（人工/耗材/固定）整体退场，页面换成按设备+期间的填报
  assert.doesNotMatch(platform, /function CostManagement/);
  assert.doesNotMatch(platform, /导出成本明细文件/);
  assert.match(platform, /<DeviceReportCenter/);
  // 旧记录不能凭空消失：仍然传进去供归并，且归并逻辑在数据层有对照表
  assert.match(platform, /oldCostEntries=\{costEntries\}/);
  assert.match(center, /migrateCostEntries/);
  // 业务量三项走已发布数据，查不到返回 undefined 让界面显示「—」，绝不回退成 0
  assert.match(platform, /const workloadOf = \(deviceId: string, periodKey: string\) =>\s*\n\s*workloadIndex\.get/);
  // 演示兜底只在演示模式生效：正式模式查不到就是查不到，不许拿演示数编进正式口径
  assert.match(platform, /demoMode \? cloneDeviceWorkloadForHospital\(effectiveHospitalId\) : null/);
  // 填报记录、填报字段按医院存云端，跨设备可见
  assert.match(platform, /persistCloudResource\("deviceReports", next\)/);
  assert.match(platform, /persistCloudResource\("reportFields", next\)/);
});

test("筛选条允许换行：平板宽度不会把整页顶出横向滚动条", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // 1024/1100 宽（iPad 横屏）下筛选条一行排不下，不换行就会撑出横向滚动
  assert.match(css, /\.filter-bar \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.filter-bar select \{[^}]*max-width: 100%/);
  // 宽表必须在自己的容器里滚，不能顶宽页面
  assert.match(css, /\.table-scroll \{ width: 100%; overflow-x: auto; \}/);
});
