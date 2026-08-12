import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { initialActions, normalizeActionBenefitUnits } from "../app/improvement-actions.ts";

/**
 * 改进任务的收益字段历史上按万元存，而效益分析、资本计划、设备数据填报一律用元。
 * 两个差一万倍的数在相邻页面并排出现，迟早会被加到一起。
 * 下面这组断言守的就是「换算只做一次、且绝不靠猜」。
 */

test("没有单位标记的存量任务按万元换算成元，并打上标记", () => {
  const legacy = [{ id: "a", deviceId: "d1", title: "t", issue: "i", owner: "o", dueDate: "2026-01-01", expectedBenefit: 118, status: "进行中", priority: "高", progress: 10 }];
  const [normalized] = normalizeActionBenefitUnits(legacy);
  assert.equal(normalized.expectedBenefit, 1_180_000);
  assert.equal(normalized.benefitUnit, "yuan");
  // 入参不得被就地改写：云端读回的数组还要用来做版本比较
  assert.equal(legacy[0].expectedBenefit, 118);
  assert.equal(legacy[0].benefitUnit, undefined);
});

test("实际收益一并换算，没填的保持没填", () => {
  const [withActual] = normalizeActionBenefitUnits([
    { id: "a", deviceId: "d", title: "t", issue: "i", owner: "o", dueDate: "2026-01-01", expectedBenefit: 38, actualBenefit: 31, status: "已完成", priority: "中", progress: 100 },
  ]);
  assert.equal(withActual.expectedBenefit, 380_000);
  assert.equal(withActual.actualBenefit, 310_000);
  const [withoutActual] = normalizeActionBenefitUnits([
    { id: "b", deviceId: "d", title: "t", issue: "i", owner: "o", dueDate: "2026-01-01", expectedBenefit: 38, status: "进行中", priority: "中", progress: 10 },
  ]);
  // 没填过实际收益就不能凭空冒出一个 0，那会被当成"复测确认收益为零"
  assert.equal(withoutActual.actualBenefit, undefined);
  assert.ok(!("actualBenefit" in withoutActual) || withoutActual.actualBenefit === undefined);
});

test("反复换算结果不变：这是就地迁移能成立的前提", () => {
  const legacy = [{ id: "a", deviceId: "d", title: "t", issue: "i", owner: "o", dueDate: "2026-01-01", expectedBenefit: 46, actualBenefit: 12, status: "进行中", priority: "高", progress: 30 }];
  const once = normalizeActionBenefitUnits(legacy);
  const twice = normalizeActionBenefitUnits(once);
  const thrice = normalizeActionBenefitUnits(twice);
  assert.equal(once[0].expectedBenefit, 460_000);
  assert.equal(twice[0].expectedBenefit, 460_000);
  assert.equal(thrice[0].expectedBenefit, 460_000);
  assert.equal(thrice[0].actualBenefit, 120_000);
  // 已带标记的对象原样返回，避免每次读取都产生新引用让 useMemo 白算
  assert.equal(twice[0], once[0]);
});

test("换算只认标记，不按数值大小猜", async () => {
  const source = await readFile(new URL("../app/improvement-actions.ts", import.meta.url), "utf8");
  // 「38」既可能是没换算的 38 万元、也可能是换算过的 38 元，靠阈值判断必然出错
  assert.doesNotMatch(source, /expectedBenefit\s*[<>]=?\s*\d/, "出现了按数值大小判断单位的写法");
  assert.match(source, /if \(action\.benefitUnit === "yuan"\) return action;/);
});

test("出厂样例任务已按元存储且带标记，不会被再乘一次", () => {
  assert.ok(initialActions.length > 0);
  for (const action of initialActions) {
    assert.equal(action.benefitUnit, "yuan", `${action.id} 缺少单位标记，会被重复换算成一万倍`);
    // 出厂值本来就是万元量级的 118/46/38，换算后应当都在十万元以上
    assert.ok(action.expectedBenefit >= 100_000, `${action.id} 的预计收益 ${action.expectedBenefit} 看着还是万元口径`);
  }
  const normalized = normalizeActionBenefitUnits(initialActions);
  assert.deepEqual(normalized.map((a) => a.expectedBenefit), initialActions.map((a) => a.expectedBenefit));
});

test("界面上收益一律标元，不再出现万元", async () => {
  const [component, model] = await Promise.all([
    readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/improvement-actions.ts", import.meta.url), "utf8"),
  ]);
  // 注释里解释历史口径可以提万元，渲染出来的文案和样例数据不行
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(strip(component), /万元/, "页面仍有万元文案，会和分析页的元并排出现");
  assert.doesNotMatch(strip(model), /万元/, "出厂样例的描述里仍写着万元");
  assert.match(component, /预计收益（元）/);
  assert.match(component, /实际收益（元）/);
});

test("平台在读和写两侧都做换算，避免旧值被原样写回云端", async () => {
  const platform = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  // 只在读侧换算的话，用户改一条任务就会把同一批未换算的旧值再存回去
  assert.equal(
    (platform.match(/normalizeActionBenefitUnits\(/g) ?? []).length,
    2,
    "读侧与写侧都要换算，缺一侧都会让旧口径回流",
  );
  assert.match(platform, /const improvementActions = useMemo\(/);
});
