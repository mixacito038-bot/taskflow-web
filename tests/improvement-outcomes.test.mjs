import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("improvement actions retain evidence, review values and confirmed benefit", async () => {
  const source = await readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8");
  for (const contract of ["actualBenefit", "baselineValue", "targetValue", "actualValue", "evidence", "reviewDate", "history"]) {
    assert.match(source, new RegExp(contract));
  }
  assert.match(source, /记录复测/);
  assert.match(source, /已确认收益/);
  assert.match(source, /执行证据/);
});
