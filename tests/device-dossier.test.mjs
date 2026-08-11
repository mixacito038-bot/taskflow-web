import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("single equipment dossier renders a QR card with a downloadable data URL", async () => {
  const views = await readFile(new URL("../app/InsightViews.tsx", import.meta.url), "utf8");
  assert.match(views, /import QRCode from "qrcode"/);
  assert.match(views, /QRCode\.toDataURL/);
  assert.match(views, /\$\{window\.location\.origin\}\/\?device=\$\{device\.id\}/);
  assert.match(views, /typeof window === "undefined"/);
  assert.match(views, /扫码直达本设备档案（需登录并具备权限）。/);
  assert.match(views, /设备编号[\s\S]*资产编号/);
  assert.match(views, /device\.assetCode/);
  assert.match(views, /下载二维码/);
  assert.match(views, /download=\{`\$\{device\.id\}-二维码\.png`\}/);
});

test("single equipment dossier timeline sticks to ledger facts with explicit pending states", async () => {
  const views = await readFile(new URL("../app/InsightViews.tsx", import.meta.url), "utf8");
  assert.match(views, /function DeviceTimeline/);
  assert.match(views, /设备时间轴/);
  assert.match(views, /采购启用/);
  assert.match(views, /运行使用/);
  assert.match(views, /维保状态/);
  assert.match(views, /当前关注/);
  assert.match(views, /device\.enabledDate/);
  assert.match(views, /可用率与停机事实待接入/);
  assert.match(views, /完整时间轴（验收\/维修工单\/调拨）将在维修与台账事实接入后自动补齐。/);
  assert.doesNotMatch(views, /new Date\(\)[^\n]*DeviceTimeline/);
});

test("HospitalComparePanel exports the exact shell wiring contract", async () => {
  const views = await readFile(new URL("../app/InsightViews.tsx", import.meta.url), "utf8");
  assert.match(views, /export function HospitalComparePanel\(\{ hospitals, activeHospitalId, onSwitchHospital \}/);
  assert.match(views, /hospitals: Array<\{ id: string; name: string; shortName: string; level: string; region: string \}>/);
  assert.match(views, /activeHospitalId: string/);
  assert.match(views, /onSwitchHospital: \(hospitalId: string\) => void/);
  assert.match(views, /cloneDevicesForHospital[^\n]*from "\.\/mock-data"/);
  assert.match(views, /cloneDevicesForHospital\(hospital\.id\)/);
  assert.match(views, /对比基于各院当前工作区数据；接入各院正式发布数据后自动切换为已发布口径。/);
  assert.match(views, /item\.utilization < 55 \|\| netBenefit\(item\) < 0/);
  assert.match(views, /需关注台数/);
  assert.match(views, /最高/);
  assert.match(views, /最低/);
  assert.match(views, /onSwitchHospital\(row\.hospital\.id\)/);
  assert.match(views, /table-scroll/);
  assert.match(views, /data-table/);
});
