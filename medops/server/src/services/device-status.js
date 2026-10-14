'use strict';
/* 设备状态：系统只认 in_use / repair / retired / scrapped 四个值（手机端巡检清单、有效期提醒只看 in_use）。
   别处来的数据（旧版 JSON、手工编的测试数据）常写成 active、停用、报废 之类，这里统一换算；
   对照表与迁移 005_device_status_fix.sql 一致。 */
const DEVICE_STATUS = ['in_use', 'repair', 'retired', 'scrapped'];
const STATUS_TEXT = { in_use: '在用', repair: '维修中', retired: '已停用', scrapped: '已报废' };
const SYNONYMS = {
  in_use: ['in_use', 'inuse', 'active', 'enabled', 'enable', 'on', 'normal', 'ok', 'using', 'used', 'available',
    '在用', '在用中', '正常', '正常使用', '使用', '使用中', '启用', '可用', '良好', '完好'],
  repair: ['repair', 'repairing', 'maintenance', 'broken',
    '维修', '维修中', '检修', '检修中', '保养', '保养中', '送修', '待修', '故障'],
  retired: ['retired', 'inactive', 'disabled', 'disable', 'off', 'stop', 'stopped', 'idle',
    '停用', '已停用', '闲置', '封存'],
  scrapped: ['scrapped', 'scrap', 'discarded', '报废', '已报废', '淘汰']
};
const MAP = new Map();
for (const [k, words] of Object.entries(SYNONYMS)) for (const w of words) MAP.set(w, k);

/* 与迁移 005 的归一键一致：去首尾空白（含全角空格）→ 小写 → 空格、横线当下划线 */
const keyOf = v => String(v).replace(/^[\s　]+|[\s　]+$/g, '').toLowerCase().replace(/ /g, '_').replace(/-/g, '_');

/* 返回系统值；没填返回 ''；认不出返回 null（由调用方决定提示还是报错） */
function normDeviceStatus(v) {
  if (v == null) return '';
  const k = keyOf(v);
  if (!k) return '';
  return MAP.get(k) || null;
}

/* 科室 / 签字人 / 账号的启用状态：明确表示停用的写法 → off，其余 → on */
const OFF_WORDS = new Set(['off', 'inactive', 'disabled', 'disable', 'stop', 'stopped', 'false', '0',
  '停用', '已停用', '禁用', '已禁用', '离职', '已离职', '注销', '已注销', '撤销', '已撤销']);
const onOff = v => (v != null && OFF_WORDS.has(keyOf(v)) ? 'off' : 'on');

module.exports = { DEVICE_STATUS, STATUS_TEXT, SYNONYMS, normDeviceStatus, onOff };
