import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HOSPITAL_CATEGORIES,
  HOSPITAL_LEVELS,
  HOSPITAL_LEVEL_VALUES,
  hospitalLevelRank,
  normalizeHospitalTaxonomy,
} from "../app/hospital-catalog.ts";

test("医院等级覆盖《医院分级管理办法》三级十等", async () => {
  // 一、二级各分甲乙丙三等，三级另增特等，合称三级十等。
  const formal = ["一级甲等", "一级乙等", "一级丙等", "二级甲等", "二级乙等", "二级丙等", "三级特等", "三级甲等", "三级乙等", "三级丙等"];
  for (const value of formal) assert.ok(HOSPITAL_LEVEL_VALUES.includes(value), `缺少法定等次 ${value}`);
  assert.equal(formal.length, 10, "法定等次共十等");
  // 已定级未定等在实际填报里大量存在，每一级都要能选
  for (const value of ["一级（未定等）", "二级（未定等）", "三级（未定等）"]) {
    assert.ok(HOSPITAL_LEVEL_VALUES.includes(value), `缺少未定等选项 ${value}`);
  }
  assert.ok(HOSPITAL_LEVEL_VALUES.includes("未定级"));
  assert.equal(HOSPITAL_LEVEL_VALUES.length, 14);
  assert.equal(new Set(HOSPITAL_LEVEL_VALUES).size, 14, "等级取值不得重复");
  // 类别不许再混进等级
  for (const wrong of ["三级综合", "三级专科", "二级医院", "未设置"]) {
    assert.ok(!HOSPITAL_LEVEL_VALUES.includes(wrong), `${wrong} 是类别或旧口径，不应出现在等级里`);
  }
});

test("每个等级都带 tier，且按等级从高到低排列", () => {
  for (const option of HOSPITAL_LEVELS) {
    if (option.value === "未定级") { assert.equal(option.tier, 0); continue; }
    const expected = option.value.startsWith("三级") ? 3 : option.value.startsWith("二级") ? 2 : 1;
    assert.equal(option.tier, expected, `${option.value} 的 tier 不对`);
  }
  assert.ok(hospitalLevelRank("三级特等") < hospitalLevelRank("三级甲等"));
  assert.ok(hospitalLevelRank("三级甲等") < hospitalLevelRank("二级甲等"));
  assert.ok(hospitalLevelRank("未定级") > hospitalLevelRank("一级丙等"));
  // 不认识的取值排在最后，而不是被当成最高等级
  assert.ok(hospitalLevelRank("某种没见过的写法") >= HOSPITAL_LEVEL_VALUES.length);
});

test("医院类别取自《医疗机构管理条例实施细则》的机构类别", () => {
  for (const value of ["综合医院", "中医医院", "中西医结合医院", "民族医医院", "专科医院", "康复医院", "妇幼保健院", "护理院"]) {
    assert.ok(HOSPITAL_CATEGORIES.includes(value), `缺少类别 ${value}`);
  }
  assert.ok(HOSPITAL_CATEGORIES.includes("未设置"));
});

test("历史取值折算：把类别从等级里拆出来，且不臆造等次", () => {
  assert.deepEqual(normalizeHospitalTaxonomy("三级综合"), { level: "三级（未定等）", category: "综合医院" });
  assert.deepEqual(normalizeHospitalTaxonomy("三级专科"), { level: "三级（未定等）", category: "专科医院" });
  assert.deepEqual(normalizeHospitalTaxonomy("二级医院"), { level: "二级（未定等）", category: "未设置" });
  assert.deepEqual(normalizeHospitalTaxonomy("未设置"), { level: "未定级", category: "未设置" });
  assert.deepEqual(normalizeHospitalTaxonomy(""), { level: "未定级", category: "未设置" });
  // 折算不得把"三级综合"猜成甲等
  assert.notEqual(normalizeHospitalTaxonomy("三级综合").level, "三级甲等");
  // 已经是规范取值的原样保留
  assert.deepEqual(normalizeHospitalTaxonomy("三级甲等", "中医医院"), { level: "三级甲等", category: "中医医院" });
  // 已显式填了类别时，不被历史映射覆盖
  assert.deepEqual(normalizeHospitalTaxonomy("三级综合", "中医医院"), { level: "三级（未定等）", category: "中医医院" });
  // 不认识的取值原样保留，不静默改写医院资料
  assert.deepEqual(normalizeHospitalTaxonomy("某省特殊口径"), { level: "某省特殊口径", category: "未设置" });
});

test("医院表单用目录渲染两个下拉，并保留库里的历史取值", async () => {
  const center = await readFile(new URL("../app/AccessControlCenter.tsx", import.meta.url), "utf8");
  assert.match(center, /HOSPITAL_LEVELS\.map/);
  assert.match(center, /HOSPITAL_CATEGORIES\.map/);
  assert.match(center, /医院类别/);
  // 旧的硬编码五项必须彻底消失
  assert.doesNotMatch(center, /<option>三级综合<\/option>/);
  assert.doesNotMatch(center, /<option>三级专科<\/option>/);
  // 库里存的值若不在清单内，单列出来，避免下拉显示空白把医院资料改掉
  assert.match(center, /原有取值/);
});

test("迁移脚本补 category 列并把历史等级拆开", async () => {
  const [migration, journal] = await Promise.all([
    readFile(new URL("../drizzle/0012_hospital_taxonomy.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /ALTER TABLE `hospitals` ADD `category` text/);
  assert.match(migration, /WHERE `level` = '三级综合'/);
  assert.match(migration, /WHERE `level` = '三级专科'/);
  assert.match(migration, /WHERE `level` = '未设置'/);
  // 折算后的等级不能出现臆造的甲乙丙
  assert.doesNotMatch(migration, /SET `category` = '综合医院', `level` = '三级甲等'/);
  assert.match(journal, /0012_hospital_taxonomy/);
});
