import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform exposes a permission-gated passworded brand-click data workbench and capital plan", async () => {
  const source = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.match(source, /DataWorkbench/);
  assert.match(source, /CapitalPlanningCenter/);
  assert.match(source, /connector\.manage/);
  assert.match(source, /data\.publish/);
  assert.match(source, /brandClick/);
  assert.match(source, />= DATA_WORKBENCH_ENTRY_CLICKS/);
  assert.match(source, /4000/);
  assert.match(source, /workbenchEntryPromptOpen/);
  assert.match(source, /\/api\/workbench-entry/);
  assert.match(source, /数据准备模式/);
  assert.match(source, /资本计划/);
});

test("workbench entry password is verified server side with a default and env override", async () => {
  const route = await readFile(new URL("../app/api/workbench-entry/route.ts", import.meta.url), "utf8");
  assert.match(route, /DATA_WORKBENCH_ENTRY_PASSWORD/);
  assert.match(route, /"yonghong"/);
  assert.match(route, /invalid_entry_password/);
  const { POST } = await import("../app/api/workbench-entry/route.ts");
  const accepted = await POST(new Request("https://app.local/api/workbench-entry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "yonghong" }),
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true });
  const rejected = await POST(new Request("https://app.local/api/workbench-entry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "wrong-password" }),
  }));
  assert.equal(rejected.status, 403);
  const malformed = await POST(new Request("https://app.local/api/workbench-entry", {
    method: "POST",
    body: "not-json",
  }));
  assert.equal(malformed.status, 400);
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
