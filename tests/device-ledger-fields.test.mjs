import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEVICE_DATA_SOURCES,
  nextAssetCode,
  normalizeAssetCodePrefix,
  deriveFieldKey,
  normalizeFieldKey,
  sortedLedgerFields,
  tableLedgerFields,
  usingDepartmentList,
  validateCustomFieldValues,
  validateFieldDefinition,
  validateFieldValue,
} from "../app/device-ledger-fields.ts";

const field = (overrides = {}) => ({
  key: "contract_no", label: "合同编号", type: "text", required: false, options: [], hint: "", visibleInTable: true, order: 1, ...overrides,
});

test("资产编号按医院简码 + 7 位顺序号自增", () => {
  assert.equal(nextAssetCode("YHZX", []), "YHZX0000001");
  assert.equal(nextAssetCode("YHZX", ["YHZX0000001"]), "YHZX0000002");
  // 取最大号而不是条数：删过设备也不会撞号
  assert.equal(nextAssetCode("YHZX", ["YHZX0000001", "YHZX0000009", "YHZX0000003"]), "YHZX0000010");
  // 别的简码、别的格式一律不参与推算
  assert.equal(nextAssetCode("YHZX", ["YHDY0000088", "ZC-2021-0186", ""]), "YHZX0000001");
  // 大小写不敏感，避免同一简码大小写混用导致重号
  assert.equal(nextAssetCode("yhzx", ["YHZX0000005"]), "YHZX0000006");
  // 没配简码就不自动生成，交给用户手工填，而不是造一个无前缀的号
  assert.equal(nextAssetCode("", ["YHZX0000001"]), "");
});

test("简码规范化：去掉非法字符并限长", () => {
  assert.equal(normalizeAssetCodePrefix(" yh-zx 中心 "), "YH-ZX");
  assert.equal(normalizeAssetCodePrefix("abcdefghijklmnop"), "ABCDEFGHIJKL");
});

test("字段标识规范化只保留字母数字下划线", () => {
  assert.equal(normalizeFieldKey(" 维保到期日 Maintenance Due! "), "maintenance_due");
  assert.equal(normalizeFieldKey("__a__b__"), "a__b");
});

test("中文字段名也能自动生成标识（医院基本都用中文命名）", () => {
  // 纯中文过 normalizeFieldKey 是空串，直接拿它当标识会报"标识只能用字母数字下划线"，
  // 等于逼用户自己想英文名——回退到 field_N。
  assert.equal(normalizeFieldKey("设备来源"), "");
  assert.equal(deriveFieldKey("设备来源", []), "field_1");
  assert.equal(deriveFieldKey("维保到期日", [field({ key: "field_1" })]), "field_2");
  // 有英文名就用英文名
  assert.equal(deriveFieldKey("Contract No", []), "contract_no");
  // 撞到已有标识就加序号，不覆盖别人
  assert.equal(deriveFieldKey("Contract No", [field({ key: "contract_no" })]), "contract_no_2");
  // 撞到系统保留键同样要避开
  assert.equal(deriveFieldKey("roomNumber", []), "roomnumber");
  assert.equal(deriveFieldKey("assetCode", []), "assetcode");
});

test("字段定义校验拦下空名、保留字、重名和缺候选项", () => {
  const existing = [field()];
  assert.equal(validateFieldDefinition(field({ key: "x", label: "x" }), []), null);
  assert.equal(validateFieldDefinition(field({ label: "  " }), []), "label_required");
  assert.equal(validateFieldDefinition(field({ key: "" }), []), "key_required");
  // 内置列的键不能被占用，否则会和系统列串位
  assert.equal(validateFieldDefinition(field({ key: "assetCode" }), []), "key_reserved");
  assert.equal(validateFieldDefinition(field({ key: "roomNumber" }), []), "key_reserved");
  assert.equal(validateFieldDefinition(field({ key: "contract_no" }), existing), "key_duplicated");
  // 编辑自己时不算重名
  assert.equal(validateFieldDefinition(field({ key: "contract_no" }), existing, "contract_no"), null);
  assert.equal(validateFieldDefinition(field({ type: "select", options: [] }), []), "options_required");
  assert.equal(validateFieldDefinition(field({ type: "select", options: ["  "] }), []), "options_required");
});

test("字段值校验：必填拦空，选填留空放行，格式错误当场报错", () => {
  assert.equal(validateFieldValue(field({ required: true }), ""), "合同编号为必填项");
  assert.equal(validateFieldValue(field({ required: false }), ""), "");
  assert.equal(validateFieldValue(field({ type: "number" }), "12.5"), "");
  assert.equal(validateFieldValue(field({ type: "number" }), "12a"), "合同编号只能填数字");
  assert.equal(validateFieldValue(field({ type: "date" }), "2026-08-12"), "");
  assert.equal(validateFieldValue(field({ type: "date" }), "2026/08/12"), "合同编号请填写为 YYYY-MM-DD");
  assert.equal(validateFieldValue(field({ type: "select", options: ["院内自购", "厂家投放"] }), "厂家投放"), "");
  assert.equal(validateFieldValue(field({ type: "select", options: ["院内自购"] }), "别的"), "合同编号只能从候选项中选择");
});

test("保存前整体校验按列顺序返回第一条错误", () => {
  const fields = [
    field({ key: "b", label: "乙字段", required: true, order: 2 }),
    field({ key: "a", label: "甲字段", required: true, order: 1 }),
  ];
  assert.equal(validateCustomFieldValues(fields, {}), "甲字段为必填项");
  assert.equal(validateCustomFieldValues(fields, { a: "x" }), "乙字段为必填项");
  assert.equal(validateCustomFieldValues(fields, { a: "x", b: "y" }), "");
  assert.equal(validateCustomFieldValues([], undefined), "");
});

test("列顺序与表格可见性", () => {
  const fields = [field({ key: "c", order: 3 }), field({ key: "a", order: 1, visibleInTable: false }), field({ key: "b", order: 2 })];
  assert.deepEqual(sortedLedgerFields(fields).map((item) => item.key), ["a", "b", "c"]);
  // 关掉"台账显示"的字段只在编辑弹窗出现，不占表格宽度
  assert.deepEqual(tableLedgerFields(fields).map((item) => item.key), ["b", "c"]);
});

test("使用科室多值读取，老数据回落到 department", () => {
  assert.deepEqual(usingDepartmentList({ usingDepartments: ["影像科", "急诊科"] }), ["影像科", "急诊科"]);
  // 老设备只有 department，不能因为没有 usingDepartments 就显示空白
  assert.deepEqual(usingDepartmentList({ department: "医学影像科" }), ["医学影像科"]);
  assert.deepEqual(usingDepartmentList({ usingDepartments: ["  ", ""], department: "急诊科" }), ["急诊科"]);
  assert.deepEqual(usingDepartmentList({}), []);
});

test("数据来源三类齐备", () => {
  assert.deepEqual([...DEVICE_DATA_SOURCES], ["手动填写", "文件导入", "接口对接"]);
});

test("台账表格按新口径出列，且去掉了效益列与本机保存提示", async () => {
  const platform = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  assert.match(platform, /<th>所属科室<\/th><th>使用科室<\/th><th>房间号<\/th>/);
  assert.match(platform, /<th>数据来源<\/th>/);
  assert.match(platform, /columns\.map\(\(field\) => <th key=\{field\.key\}>\{field\.label\}<\/th>\)/);
  // 年度收入/总成本/使用率不再出现在台账表头。
  // 只截 EquipmentManagement 这一段来断言：驾驶舱的「设备效益明细」表本来就该有这几列。
  const ledgerStart = platform.indexOf("function EquipmentManagement(");
  const ledgerEnd = platform.indexOf("function CostManagement(", ledgerStart);
  assert.ok(ledgerStart > 0 && ledgerEnd > ledgerStart, "取不到设备台账组件源码");
  const ledger = platform.slice(ledgerStart, ledgerEnd);
  assert.doesNotMatch(ledger, /年度收入/);
  assert.doesNotMatch(ledger, /总成本/);
  assert.doesNotMatch(ledger, /使用率/);
  assert.doesNotMatch(platform, /编辑后自动保存到本机/);
  assert.doesNotMatch(platform, /维护单机基础资料、收入、工作量和计划指标/);
  assert.doesNotMatch(platform, /数据完整率/);
  // 空态必须有，否则没有设备时整页是白的
  assert.match(platform, /ledger-empty/);
  assert.match(platform, /本院台账还没有设备/);
  // 多使用科室折叠展开
  assert.match(platform, /using-departments-toggle/);
  assert.match(platform, /aria-expanded=\{expanded\}/);
});

test("资产编号自动生成接到新增设备上，并在保存时查重", async () => {
  const platform = await readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8");
  // 编号按台账全集（已发布 + 手工建档）推算，避免和已发布编号撞号
  assert.match(platform, /assetCode: nextAssetCode\(activeHospital\?\.assetCodePrefix \?\? "", ledgerDevices\.map/);
  assert.match(platform, /const ledgerDevices = useMemo/);
  // 分析口径仍只认已发布数据，这条边界不能被合并逻辑破坏
  assert.match(platform, /sessionState === "demo" \? workspaceDevices : \[\.\.\.publishedData\.devices\]/);
  assert.match(platform, /资产编号已存在，请换一个/);
  assert.match(platform, /validateCustomFieldValues\(currentLedgerFields, deviceDraft\.customFields\)/);
  // 医院配置里能设简码
  const center = await readFile(new URL("../app/AccessControlCenter.tsx", import.meta.url), "utf8");
  assert.match(center, /资产编号简码/);
  assert.match(center, /normalizeAssetCodePrefix/);
});

test("文件导入发布的设备来源标为文件导入", async () => {
  const published = await readFile(new URL("../app/published-data.ts", import.meta.url), "utf8");
  assert.match(published, /dataSource: "文件导入"/);
});

test("台账字段配置页与云端资源接好线", async () => {
  const [settings, cloud, store] = await Promise.all([
    readFile(new URL("../app/LedgerFieldSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cloud-state.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cloud, /"ledgerFields"/);
  assert.match(store, /"ledgerFields",/);
  // 列定义跟着设备台账的管理权限走
  assert.match(store, /ledgerFields: "equipment\.manage"/);
  assert.match(settings, /台账字段配置/);
  assert.match(settings, /系统内置列/);
  // 键创建后不可改，否则设备上已填的值会全丢
  assert.match(settings, /keyLocked/);
  assert.match(settings, /标识创建后不可修改/);
  // 删除字段不删数据
  assert.match(settings, /设备上已填写的值仍保留/);
  // 中文名要能自动生成标识
  assert.match(settings, /deriveFieldKey\(draft\.label, ordered\)/);
});
