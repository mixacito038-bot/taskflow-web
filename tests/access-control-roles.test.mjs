import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { initialRoles, permissionColumns } from "../app/access-control-data.ts";
import { menuCatalog, menuVisibleForPermissions } from "../app/menu-catalog.ts";

/**
 * 角色权限体系精简后的护栏。
 *
 * 本轮把权限从 17 条减到 15 条，删掉了两条谁也控制不了的空壳，并把几条与角色职责
 * 自相矛盾的授权收口。这些改动一旦被后来的提交悄悄退回去，界面上完全看不出来——
 * 权限勾选框照样能勾，只是勾了不起作用。下面每条断言都对着一种具体的退化。
 */

const appDir = fileURLToPath(new URL("../app/", import.meta.url));
const tenantRouteUrl = new URL("../app/api/tenant-context/route.ts", import.meta.url);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 收集 app/ 下所有 .ts/.tsx 源码（含 api 路由），键为相对 app/ 的路径。 */
async function collectAppSources(dir = appDir, collected = new Map()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectAppSources(full, collected);
    else if (/\.tsx?$/.test(entry.name)) collected.set(path.relative(appDir, full), await readFile(full, "utf8"));
  }
  return collected;
}

const roleById = (id) => {
  const role = initialRoles.find((item) => item.id === id);
  assert.ok(role, `内置角色 ${id} 不存在`);
  return role;
};

const visibleMenuLabels = (role) =>
  menuCatalog.filter((menu) => menuVisibleForPermissions(menu, new Set(role.permissions))).map((menu) => menu.label);

test("每条权限都必须控制得到东西，主表里不许留空壳权限", async () => {
  const sources = await collectAppSources();
  const platform = sources.get("EquipmentPlatform.tsx");
  assert.ok(platform, "EquipmentPlatform.tsx 必须存在，它是权限落地成界面的地方");
  const allSource = [...sources.values()].join("\n");
  const menuPermissions = new Set(menuCatalog.flatMap((menu) => [...menu.permissions]));

  for (const permission of permissionColumns) {
    const { code, label } = permission;
    // 一条权限要算「控制得到东西」，至少得满足下面三种落点之一：
    const controlsMenu = menuPermissions.has(code);                                   // ① 决定某个左侧菜单是否出现
    const gatesUi = allSource.includes(`hasPermission("${code}")`);                    // ② 有 hasPermission 判定挡着某个操作
    const feedsChildProp = new RegExp(`can[A-Z][A-Za-z]*=\\{[^}]*"${escapeRegExp(code)}"`).test(platform); // ③ 作为 can* 属性传给子组件
    assert.ok(
      controlsMenu || gatesUi || feedsChildProp,
      `权限「${label}」(${code}) 在 app/ 下没有任何落点：既不决定菜单可见性，也没有 hasPermission 判定或 can* 属性。\n`
      + "空壳权限比没有权限更危险——医院管理员在角色弹窗里把它取消掉，以为关停了某个功能，实际界面纹丝不动，"
      + "等到出事翻权限配置才发现这道闸门根本没接线。",
    );
  }

  // 精简的结果是 15 条，且编码不得重复（重复会让弹窗里出现两个同名勾选框，取消一个另一个还在）。
  assert.equal(permissionColumns.length, 15, "本轮清理后权限主表应为 15 条");
  assert.equal(new Set(permissionColumns.map((permission) => permission.code)).size, 15, "权限编码不得重复");
  for (const permission of permissionColumns) {
    assert.ok(permission.label?.trim(), `${permission.code} 缺少中文名，医院管权限的人认名字不认编码`);
  }
});

test("菜单目录引用的权限必须都在权限主表里，不能挂在被删掉的编码上", () => {
  const known = new Set(permissionColumns.map((permission) => permission.code));
  for (const menu of menuCatalog) {
    assert.ok(menu.permissions.length, `菜单「${menu.label}」没有声明任何权限，等于对所有人可见`);
    for (const code of menu.permissions) {
      // 菜单挂在一条已删除的权限上，谁也勾不到它 → 这个菜单对所有角色永久消失，且没有任何报错。
      assert.ok(known.has(code), `菜单「${menu.label}」依赖的权限 ${code} 不在权限主表里，该菜单将永远无人可见`);
    }
  }
});

test("audit.view 与 connector.manage 已从权限主表和菜单目录中彻底消失", async () => {
  const [dataSource, menuSource] = await Promise.all([
    readFile(new URL("../app/access-control-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/menu-catalog.ts", import.meta.url), "utf8"),
  ]);

  for (const dead of ["audit.view", "connector.manage"]) {
    assert.ok(!permissionColumns.some((permission) => permission.code === dead), `${dead} 是空壳权限，不应再出现在权限主表`);
    assert.ok(!menuCatalog.some((menu) => menu.permissions.includes(dead)), `${dead} 不应再参与任何菜单的可见性判断`);
    // 只匹配带引号的字符串字面量：说明为什么删掉它们的中文注释可以留着，残留的授权数据不行。
    // 内置角色的 permissions 数组里哪怕漏掉一条，服务端种子就会把这条权限重新写回数据库。
    const literal = new RegExp(`"${escapeRegExp(dead)}"`);
    assert.doesNotMatch(dataSource, literal, `access-control-data.ts 里仍有 ${dead} 的授权残留（多半在某个内置角色的 permissions 里）`);
    assert.doesNotMatch(menuSource, literal, `menu-catalog.ts 里仍有 ${dead} 残留`);
  }
});

test("前端权限主表与服务端种子逐条对齐：同一权限不许两处叫法不同", async () => {
  const route = await readFile(tenantRouteUrl, "utf8");
  const frontendByCode = new Map(permissionColumns.map((permission) => [permission.code, permission]));

  const seedStart = route.indexOf("const permissionSeeds");
  assert.ok(seedStart >= 0, "tenant-context 路由里找不到 permissionSeeds");
  const seedEnd = Math.min(...[route.indexOf("] as const", seedStart), route.indexOf("];", seedStart)].filter((index) => index >= 0));
  assert.ok(Number.isFinite(seedEnd), "permissionSeeds 数组没有正常闭合");
  const seedBlock = route.slice(seedStart, seedEnd);

  if (seedBlock.includes("permissionColumns")) {
    // 服务端直接复用前端主表 = 只有一份种子，分叉在结构上就不可能发生，这是最好的结果。
    assert.match(route, /import\s*\{[^}]*permissionColumns[^}]*\}\s*from\s*["'][^"']*access-control-data["']/,
      "permissionSeeds 若引用 permissionColumns，必须真的从 app/access-control-data 导入，而不是本地另建一份同名变量");
  } else {
    const seeds = [...seedBlock.matchAll(/\[\s*"([\w.]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"(\w+)"\s*\]/g)]
      .map(([, code, module, name, risk]) => ({ code, module, name, risk }));
    assert.ok(seeds.length, "没能从 permissionSeeds 里解析出任何一条权限种子，格式变了就要同步改这条断言");

    // 编码集合必须完全一致：服务端多一条 = 数据库里存在一条前端永远勾不到的权限；
    // 服务端少一条 = 前端勾上后写库时外键失败，角色保存直接报错。
    assert.deepEqual(
      [...new Set(seeds.map((seed) => seed.code))].sort(),
      permissionColumns.map((permission) => permission.code).sort(),
      "前端 permissionColumns 与服务端 permissionSeeds 的权限编码集合必须完全一致",
    );

    for (const seed of seeds) {
      const frontend = frontendByCode.get(seed.code);
      // 中文名逐字一致：这两份种子历史上分叉过（同一条权限前端叫「改进闭环」、服务端叫「运营改进」），
      // 于是审计导出和界面对不上号，医院要靠人肉猜两个名字是不是同一件事。
      assert.ok(
        [seed.module, seed.name].includes(frontend.label),
        `${seed.code} 在前端叫「${frontend.label}」，服务端种子里却是「${seed.module}／${seed.name}」，两处叫法必须逐字一致`,
      );
    }
  }

  // 服务端的角色授权表也不能留下已删除的权限：rolePermissions 外键指向 permissions.code，
  // 留一条 audit.view 就会让整个基础目录初始化在插入时失败。
  const mapStart = route.indexOf("const rolePermissionMap");
  assert.ok(mapStart >= 0, "tenant-context 路由里找不到 rolePermissionMap");
  const mapBlock = route.slice(mapStart, route.indexOf("};", mapStart) + 2);
  for (const dead of ["audit.view", "connector.manage"]) {
    const literal = new RegExp(`"${escapeRegExp(dead)}"`);
    assert.doesNotMatch(seedBlock, literal, `permissionSeeds 仍在向数据库播种已删除的空壳权限 ${dead}`);
    assert.doesNotMatch(mapBlock, literal, `rolePermissionMap 仍在给内置角色授予已删除的权限 ${dead}`);
  }
});

test("「审计只读」角色不得持有任何写权限：叫只读就不能改东西", () => {
  const auditor = roleById("role-auditor");

  // source.manage 是「指标字典增删改」，不是查看口径——一个只读角色能改全院指标口径，
  // 等于所有报表的分母都能被它悄悄改掉，而角色名字上写着「只读」，谁也不会去查它。
  for (const write of ["source.manage", "cost.manage", "equipment.manage", "improvement.manage", "member.manage", "hospital.manage"]) {
    assert.ok(!auditor.permissions.includes(write), `审计只读不得持有写权限 ${write}`);
  }
  for (const code of auditor.permissions) {
    // data.* 是数据准备中心的导入/清洗/复核/发布，条条都是写。
    assert.ok(!code.startsWith("data."), `审计只读不得持有数据准备写权限 ${code}`);
  }
  assert.deepEqual([...auditor.permissions].sort(), ["dashboard.view", "report.export"].sort(),
    "审计只读只应保留看板查看与报告导出两条读权限");
});

test("内置角色算出来的可见菜单不能和它的角色说明自相矛盾", () => {
  const auditor = roleById("role-auditor");
  const clinical = roleById("role-clinical");

  // 「审计只读」：能看结果，但不能进「指标字典」——那个菜单里就是增删改指标口径的地方。
  const auditorMenus = visibleMenuLabels(auditor);
  assert.ok(!auditorMenus.includes("指标字典"), `审计只读不应看到「指标字典」，当前可见：${auditorMenus.join("、")}`);
  assert.ok(auditorMenus.includes("效益驾驶舱"), "审计只读要能看到效益驾驶舱，否则这个角色登录进去无事可做");

  // 「临床科室负责人」的说明是「仅查看授权科室并跟进本科室改进任务」。资本计划是院长层的
  // 论证页（含导出全院论证清单），之前 improvement.manage 一并把它放进去了——科室主任因此
  // 能看到并导出全院设备的资本论证材料，越权且没有任何提示。改由 report.approve 收口。
  const clinicalMenus = visibleMenuLabels(clinical);
  assert.ok(!clinicalMenus.includes("资本计划"), `临床科室负责人不应看到「资本计划」，当前可见：${clinicalMenus.join("、")}`);
  assert.ok(clinicalMenus.includes("运营改进中心"), "临床科室负责人要能进运营改进中心跟进本科室任务");
  const capital = menuCatalog.find((menu) => menu.id === "capital");
  assert.deepEqual([...capital.permissions], ["report.approve"], "资本计划只由报告签发权限打开");

  // 每个内置角色至少要能看到一个菜单，否则它登录后是一片空白，却没有任何地方提示是权限问题。
  for (const role of initialRoles) {
    assert.ok(visibleMenuLabels(role).length, `内置角色「${role.name}」算不出任何可见菜单，登录后将是空白页`);
  }
});
