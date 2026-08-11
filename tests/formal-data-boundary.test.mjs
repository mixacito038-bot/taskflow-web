import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("authenticated hospitals never bootstrap or fall back to demonstration facts", async () => {
  const source = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.match(source, /devices: \[\]/);
  assert.match(source, /costEntries: \[\]/);
  assert.match(source, /improvementActions: \[\]/);
  assert.match(source, /demoMode \? cloneDevicesForHospital\(effectiveHospitalId\) : \[\]/);
  assert.match(source, /demoMode \? initialActions : \[\]/);
});
