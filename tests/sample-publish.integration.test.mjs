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
  // 年度口径推算生效：至少 10 台设备年收入应为百万元级（>50 万元），而非抽样合计的个位数万元。
  assert.ok(view.devices.filter((device) => device.revenue > 50).length >= 10, "年度收入口径推算生效");
  assert.ok(view.devices.some((device) => device.status === "运行良好"), "存在经营健康的设备");
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
