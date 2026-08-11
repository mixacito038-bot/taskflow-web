import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform exposes a permission-gated six-click data workbench and capital plan", async () => {
  const source = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.match(source, /DataWorkbench/);
  assert.match(source, /CapitalPlanningCenter/);
  assert.match(source, /connector\.manage/);
  assert.match(source, /data\.publish/);
  assert.match(source, /brandClick/);
  assert.match(source, />= 6/);
  assert.match(source, /4000/);
  assert.match(source, /数据准备模式/);
  assert.match(source, /资本计划/);
});

test("permission catalog includes the full data preparation separation of duties", async () => {
  const [client, server] = await Promise.all([
    readFile(new URL("../app/access-control-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tenant-context/route.ts", import.meta.url), "utf8"),
  ]);
  for (const permission of ["connector.manage", "data.ingest", "data.clean", "data.review", "data.publish"]) {
    assert.match(client, new RegExp(permission.replace(".", "\\.")));
    assert.match(server, new RegExp(permission.replace(".", "\\.")));
  }
});
