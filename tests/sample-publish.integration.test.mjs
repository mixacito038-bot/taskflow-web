import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { eq } from "drizzle-orm";

import { SAMPLE_DATA_ROW_COUNTS } from "../app/sample-data-package.ts";
import { buildPublishedPayload, normalizePublishedDefinitions } from "../app/published-data-server-model.ts";
import { createPublishedDatasetView } from "../app/published-data.ts";
import { publishSampleDataset, SamplePublishError } from "../db/sample-dataset-publisher.ts";
import { readCurrentPublishedDatasetSet } from "../db/data-workbench-pipeline.ts";
import {
  dataLineageEvents,
  dataMetricDefinitions,
  dataPublishVersions,
  dataVisualizationDefinitions,
} from "../db/schema.ts";
import { createMigratedTestDatabase, FakeR2Bucket } from "./helpers/sqlite-d1-r2.mjs";

const hospitalId = "hospital-sample";
const accountId = "account-sample-admin";

async function setup() {
  const { sqlite, db } = await createMigratedTestDatabase();
  sqlite.exec(`
    INSERT INTO hospitals(id, code, name, short_name) VALUES ('${hospitalId}', 'SAMP', '示范发布测试医院', '示范医院');
    INSERT INTO accounts(id, email, display_name) VALUES ('${accountId}', 'sample-admin@example.test', '示范管理员');
  `);
  return { sqlite, db, bucket: new FakeR2Bucket() };
}

test("示范数据一键发布走完整链路并生成可消费的正式供数", async (t) => {
  const { sqlite, db, bucket } = await setup();
  t.after(() => sqlite.close());

  const summary = await publishSampleDataset({ db, bucket, hospitalId, accountId });
  assert.equal(summary.seriesId, "hospital-current-supply");
  assert.equal(summary.version, 1);
  assert.equal(summary.files.length, 5);
  for (const file of summary.files) {
    assert.equal(file.rowCount, SAMPLE_DATA_ROW_COUNTS[file.templateCode], `${file.templateCode} 行数与清单一致`);
  }
  const expectedRows = summary.files.reduce((sum, file) => sum + file.rowCount, 0);
  assert.equal(summary.publishedRowCount, expectedRows);

  const [publishRow] = await db.select().from(dataPublishVersions).where(eq(dataPublishVersions.id, summary.publishId));
  assert.equal(publishRow.status, "published");
  assert.equal(publishRow.seriesId, "hospital-current-supply");
  assert.ok(publishRow.publishedSnapshotId);

  // 供数可读，且负载能归一化出全部 20 台设备。
  const supply = await readCurrentPublishedDatasetSet({ hospitalId }, { db, bucket });
  assert.equal(supply.sources.length, 1);
  const metricRows = await db.select().from(dataMetricDefinitions).where(eq(dataMetricDefinitions.hospitalId, hospitalId));
  const visualizationRows = await db.select().from(dataVisualizationDefinitions).where(eq(dataVisualizationDefinitions.hospitalId, hospitalId));
  const definitions = normalizePublishedDefinitions(metricRows, visualizationRows);
  const payload = buildPublishedPayload({ hospitalId, supplyHash: supply.supplyHash, sources: supply.sources, ...definitions });
  assert.equal(payload.publication.id, summary.publishId);
  assert.equal(payload.rows.length, expectedRows);

  const view = createPublishedDatasetView(payload);
  assert.equal(view.status, "published");
  assert.equal(view.devices.length, SAMPLE_DATA_ROW_COUNTS.device_master, "全部示范设备通过正式设备归一化");
  for (const device of view.devices) {
    assert.ok(device.revenue >= 0, `${device.id} 收费净额非负`);
    assert.ok(device.utilization >= 0 && device.utilization <= 100, `${device.id} 利用率在合理区间`);
    assert.ok(Object.values(device.cost).every((value) => typeof value === "number" && value >= 0));
    assert.ok(["运行良好", "需要关注", "效益预警"].includes(device.status));
  }
  // 检查/收费类设备（示范包为 14 台）应有收费净额；检验线、呼吸机等无检查事实的设备如实归零而不是编造。
  assert.ok(view.devices.filter((device) => device.revenue > 0).length >= 14, "至少 14 台设备有收费净额");
  assert.ok(view.devices.some((device) => device.status === "运行良好"), "存在经营健康的设备");

  // 年收入按“抽样收费均价 × 利用表全年人次”推算，口径必须写进发布清单，避免与月度明细被误读为同口径。
  const manifest = JSON.parse(publishRow.manifestJson);
  assert.match(String(manifest.sample?.revenueBasis ?? ""), /抽样收费均价/);
  assert.match(String(manifest.sample?.costAllocationBasis ?? ""), /空间成本/);
  const deviceRevenueTotal = view.devices.reduce((sum, device) => sum + device.revenue, 0);
  // 万元口径合理性：全院年收入应在千万元量级，不出现元级别的天文数字。
  assert.ok(deviceRevenueTotal > 1000 && deviceRevenueTotal < 200000, `全院收入 ${deviceRevenueTotal.toFixed(2)} 万元应在合理区间`);
  // 设备年收入与全年检查人次同向：人次为零的设备收入必须为零。
  for (const device of view.devices) {
    if (device.serviceVolume === 0) assert.equal(device.revenue, 0, `${device.id} 无检查人次时收入必须为 0`);
  }
  // 金额单位为万元：单台设备收入应在几十到几千万元之间，而不是元级别的巨大数字。
  const maxRevenue = Math.max(...view.devices.map((device) => device.revenue));
  assert.ok(maxRevenue < 100000, `万元口径检查（实际最大 ${maxRevenue}）`);

  const lineageRows = await db.select().from(dataLineageEvents).where(eq(dataLineageEvents.hospitalId, hospitalId));
  const actions = new Set(lineageRows.map((row) => row.action));
  assert.ok(actions.has("file_imported"));
  assert.ok(actions.has("cleaning_completed_and_reviewed"));
  assert.ok(actions.has("sample_dataset_published"));

  // 重复执行被拒绝，绝不覆盖既有发布。
  await assert.rejects(
    publishSampleDataset({ db, bucket, hospitalId, accountId }),
    (error) => error instanceof SamplePublishError && error.code === "sample_publish_conflict",
  );
});

test("路由与数据准备中心暴露一键示范发布入口", async () => {
  const [route, workbench] = await Promise.all([
    readFile(new URL("../app/api/data-workbench/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/DataWorkbench.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /publish_sample_dataset/);
  assert.match(route, /publishSampleDataset/);
  assert.match(route, /data\.publish/);
  assert.match(workbench, /一键载入示范数据并正式发布/);
  assert.match(workbench, /publish_sample_dataset/);
});

test("示范发布按医院隔离：第二家医院可独立发布，中途失败后同院可重放", async (t) => {
  const { sqlite, db } = await createMigratedTestDatabase();
  t.after(() => sqlite.close());
  const bucket = new FakeR2Bucket();
  sqlite.exec(`
    INSERT INTO hospitals(id, code, name, short_name) VALUES
      ('hosp-a', 'HA', '示范医院甲', '甲院'),
      ('hosp-b', 'HB', '示范医院乙', '乙院');
    INSERT INTO accounts(id, email, display_name) VALUES ('acct-multi', 'multi@example.test', '多院管理员');
  `);

  const first = await publishSampleDataset({ db, bucket, hospitalId: "hosp-a", accountId: "acct-multi" });
  const second = await publishSampleDataset({ db, bucket, hospitalId: "hosp-b", accountId: "acct-multi" });
  assert.notEqual(first.publishId, second.publishId, "两院发布版本 id 必须隔离");
  const supplyA = await readCurrentPublishedDatasetSet({ hospitalId: "hosp-a" }, { db, bucket });
  const supplyB = await readCurrentPublishedDatasetSet({ hospitalId: "hosp-b" }, { db, bucket });
  assert.equal(supplyA.sources.length, 1);
  assert.equal(supplyB.sources.length, 1);
  assert.notEqual(supplyA.sources[0].publish.id, supplyB.sources[0].publish.id);

  // 模拟上次执行中途失败：删掉发布版本但保留导入批次残留，重试应清理残留后成功。
  await db.delete(dataPublishVersions).where(eq(dataPublishVersions.id, second.publishId));
  const replayed = await publishSampleDataset({ db, bucket, hospitalId: "hosp-b", accountId: "acct-multi" });
  assert.equal(replayed.publishId, second.publishId, "重放沿用同院固定发布 id");
  assert.equal(replayed.files.length, 5);
});
