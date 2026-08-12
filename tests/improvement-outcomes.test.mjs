import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("improvement actions retain evidence, review values and confirmed benefit", async () => {
  const source = await readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8");
  for (const contract of ["actualBenefit", "baselineValue", "targetValue", "actualValue", "evidence", "reviewDate", "history"]) {
    assert.match(source, new RegExp(contract));
  }
  // 改版后文案换了，但"实际值 / 实际收益 / 证据 / 复测"这条闭环一个环节都不能少：
  // 没有实际值就说不清改没改动，没有证据就等于自说自话。
  assert.match(source, /待复测/);
  assert.match(source, /实际收益/);
  assert.match(source, /实际值与实际收益需有可核对的证据/);
  // 填了实际值就自动落复测日期，避免"改完了但没人知道什么时候复的测"
  assert.match(source, /reviewDate: draft\.actualValue\.trim\(\) \? today : undefined/);
});
