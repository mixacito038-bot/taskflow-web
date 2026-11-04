'use strict';
/* 资产盘点数据还原：把服务器上的资产盘点数据退回到「某一次改动之前」的样子。

   服务器上每份数据（电脑台账、部门、流转记录……各是一个 key）都保留最近 20 个版本
   （ams_kv_history 存被替换下来的旧版本，ams_kv 是当前版本；每个版本都记着是哪台电脑、
   哪个账号、什么时候写的）。这里把所有版本按时间排开，同一台电脑几秒内连着写的算「一次改动」。
   典型的误操作——另一台电脑登录时选了「使用本机数据」——是一次改动里把所有 key 都换掉，很好认。

   还原 = 按「那次改动开始之前」各 key 最后的版本写回去。写回本身也是一次正常的改动
   （旧值照样进历史、版本号 +1、全局游标前进），所以：
     · 各电脑打开着的页面 30 秒内自动拉到还原后的数据；
     · 还原也能再被还原（撤销还原：选还原那一次即可）。
   附件（照片等）不在这 20 版历史里：被删掉的附件文件已经不在了，只能从整机备份里找回，这里只报告。 */
const { getDb } = require('../db/connection');
const amsSvc = require('./ams.service');

const RESTORE_DEVICE = 'ams-restore'; // 每次还原用 ams-restore:<时间>，两次还原永远是两次改动（撤销还原才对得上）
const isRestore = dev => String(dev || '').startsWith(RESTORE_DEVICE);
const GROUP_MS = 3000; // 同一台电脑 3 秒内连着写的，算一次改动

/* 数据份（key）的中文名：只列用户认得出的几份，其余按 key 原样显示 */
const LABELS = [
  ['ams:assets', '电脑台账'], ['ams:otherAssets', '其他资产'], ['ams:sites', '部门'],
  ['ams:movements', '流转记录'], ['ams:inventories', '盘点任务'], ['ams:users', '系统账号'], ['ams:changelog', '变更日志'],
  ['ams:roles', '角色权限'], ['ams:approvals', '审批'], ['ams:cats', '资产类别'], ['ams:catCodes', '类别编码'],
  ['ams:otherCats', '其他资产类别'], ['ams:otherCatCodes', '其他资产类别编码'], ['ams:depreCfg', '折旧设置'],
  ['ams:locations', '存放位置'], ['ams:areas', '区域'], ['ams:tags', '标签']
];
const SUMMARY_KEYS = LABELS.slice(0, 5).map(([k]) => k);
/* ams:inventories:<id> 这类子 key 按所属那份数据显示 */
const baseKey = k => (LABELS.find(([x]) => k === x || k.startsWith(x + ':')) || [])[0];
const labelOf = k => (LABELS.find(([x]) => x === baseKey(k)) || [])[1] || k;
const rank = k => { const i = LABELS.findIndex(([x]) => x === baseKey(k)); return i < 0 ? 99 : i; };

/* 一份数据有多少条：JSON 数组的长度；对象按键数；解析不了返回 null */
function countOf(value) {
  if (value == null) return 0;
  try {
    const j = JSON.parse(value);
    if (Array.isArray(j)) return j.length;
    return j && typeof j === 'object' ? Object.keys(j).length : null;
  } catch { return null; }
}

/* 每个 key 的全部已知版本（历史 + 当前），按版本号升序 */
function timeline(db = getDb()) {
  const byKey = new Map();
  const add = r => { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); };
  db.prepare('SELECT key, value, version, updated_at, updated_by, device_id FROM ams_kv_history').all().forEach(add);
  db.prepare('SELECT key, value, version, updated_at, updated_by, device_id FROM ams_kv').all().forEach(r => add({ ...r, current: true }));
  for (const l of byKey.values()) l.sort((a, b) => a.version - b.version);
  return byKey;
}

/* 所有改动，时间升序；每次改动 = 同一台电脑、同一账号、相邻两笔间隔不超过 3 秒的一串写入 */
function listEvents(db = getDb()) {
  const byKey = timeline(db);
  const writes = [];
  for (const [key, l] of byKey) for (const v of l) writes.push({ key, version: v.version, at: v.updated_at, by: v.updated_by, dev: v.device_id || '' });
  writes.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1));
  const evs = [];
  for (const w of writes) {
    const last = evs[evs.length - 1];
    if (last && last.dev === w.dev && last.by === w.by && Date.parse(w.at) - Date.parse(last.end) <= GROUP_MS) {
      last.writes.push(w); last.end = w.at;
    } else evs.push({ start: w.at, end: w.at, dev: w.dev, by: w.by, writes: [w] });
  }
  const users = new Map(db.prepare('SELECT id, username, display_name FROM users').all().map(u => [u.id, u]));
  evs.forEach(e => {
    e.keys = [...new Set(e.writes.map(w => w.key))].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
    const u = users.get(e.by);
    e.user = u ? (u.display_name && u.display_name !== u.username ? `${u.display_name}（${u.username}）` : u.username) : '';
    e.before = stateAt(byKey, e.start, false);
    e.after = stateAt(byKey, e.end, true);
  });
  return evs;
}

/* 某时刻各 key 的值。inclusive=false：严格早于 t 的最后一个版本（= 这次改动之前）。
   返回 Map key → { value } ；某 key 在 t 之前还不存在 → { value: null }；
   t 之前的版本已经被挤出 20 版历史、无从知道 → { unknown: true } */
function stateAt(byKey, t, inclusive) {
  const out = new Map();
  for (const [key, l] of byKey) {
    let hit = null;
    for (const v of l) if (inclusive ? v.updated_at <= t : v.updated_at < t) hit = v;
    if (hit) out.set(key, { value: hit.value });
    else if (l[0].version === 1) out.set(key, { value: null }); // 第 1 版都在 t 之后：那时还没有这份数据
    else out.set(key, { unknown: true });
  }
  return out;
}

const countIn = (state, key) => { const s = state.get(key); return !s ? 0 : s.unknown ? null : countOf(s.value); };

/* 最像误操作的那次：最近的一次「一次改了 4 份以上、而且条数变了」或「哪份数据一下少了不少」的改动
   （不算还原操作自己、之前确实有数据）。只是整份重存一遍、条数一条没变的（页面刚升级后重存）不算 */
function suspectIndex(evs) {
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (isRestore(e.dev)) continue;
    const hadData = SUMMARY_KEYS.some(k => (countIn(e.before, k) || 0) > 0);
    if (!hadData) continue;
    const pairs = SUMMARY_KEYS.filter(k => e.keys.includes(k)).map(k => [countIn(e.before, k), countIn(e.after, k)]);
    const changed = pairs.some(([b, a]) => b !== a);
    const drop = pairs.some(([b, a]) => b != null && a != null && b - a >= Math.max(2, b * 0.05));
    if ((e.keys.length >= 4 && changed) || drop) return i;
  }
  return -1;
}

/* ---------- 「保留之后的改动」：三方合并 ----------
   base = 那次改动刚做完时（被覆盖成的样子），ours = 那次之前（覆盖前），theirs = 现在。
   覆盖之后有人改过的（现在 ≠ 覆盖后）用现在的；没人改过的退回覆盖前的。
   数组里的记录（资产、流转、日志……都带 id）逐条比：
     · 覆盖时丢掉、之后也没再出现的 → 找回
     · 覆盖时被改成旧样子、之后没人动过的 → 改回覆盖前的
     · 覆盖之后新加的 → 保留
     · 覆盖之后改过的 → 改过的字段用现在的，其余字段用覆盖前的
     · 覆盖时带进来（覆盖前没有）、之后没人动过的 → 去掉；之后有人改过的 → 保留
     · 覆盖之后删掉的 → 照删 */
function canon(v) { // 键排好序的 JSON，用来比「是不是一样」（同一条记录前后字段顺序可能不同）
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const same = (a, b) => canon(a) === canon(b);
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const idList = a => Array.isArray(a) && a.every(x => isObj(x) && (typeof x.id === 'string' || typeof x.id === 'number'))
  && new Set(a.map(x => String(x.id))).size === a.length;
const primList = a => Array.isArray(a) && a.every(x => x == null || typeof x !== 'object');
const newStats = () => ({ recovered: 0, keptNew: 0, keptChanged: 0, dropped: 0, deletedLater: 0, conflicts: 0 });

function mergeById(base, ours, theirs, st) {
  const B = new Map(base.map(x => [String(x.id), x])), O = new Map(ours.map(x => [String(x.id), x])), T = new Map(theirs.map(x => [String(x.id), x]));
  const later = [], out = [];
  for (const t of theirs) { // 覆盖前没有的：之后新加的、或覆盖带进来又被人改过的 → 留；带进来没人动的 → 去掉
    const id = String(t.id);
    if (O.has(id)) continue;
    if (B.has(id) && same(t, B.get(id))) { st.dropped++; continue; }
    later.push(t);
    if (B.has(id)) st.keptChanged++; else st.keptNew++;
  }
  for (const o of ours) { // 按覆盖前的顺序
    const id = String(o.id);
    if (T.has(id)) {
      const t = T.get(id);
      if (!B.has(id)) { out.push(t); st.keptChanged++; continue; } // 覆盖时没了、之后又加回（同一条）
      const b = B.get(id);
      if (same(t, b)) { out.push(o); if (!same(o, b)) st.recovered++; } // 之后没人动 → 覆盖前的
      else { out.push(merge3(b, o, t, st)); st.keptChanged++; }
    } else if (B.has(id)) st.deletedLater++; // 覆盖之后删掉的：照删
    else { out.push(o); st.recovered++; }     // 覆盖时丢掉的：找回
  }
  return [...later, ...out];
}

function merge3(base, ours, theirs, st) {
  if (same(theirs, base)) return ours;
  if (same(ours, base)) return theirs;
  if (idList(base) && idList(ours) && idList(theirs)) return mergeById(base, ours, theirs, st);
  if (primList(base) && primList(ours) && primList(theirs)) {
    const T = new Set(theirs.map(canon)), B = new Set(base.map(canon));
    const removed = new Set(base.map(canon).filter(x => !T.has(x)));
    const out = ours.filter(x => !removed.has(canon(x)));
    const seen = new Set(out.map(canon));
    for (const x of theirs) { const c = canon(x); if (!B.has(c) && !seen.has(c)) { out.push(x); seen.add(c); } }
    return out;
  }
  if (isObj(base) && isObj(ours) && isObj(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
      const v = merge3(base[k], ours[k], theirs[k], st);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  st.conflicts++;
  return theirs; // 两边都改了同一处、又没法逐条比：以后来的为准
}

/* 三个原样 JSON 串（null = 这份数据不存在）合并，返回新的串 */
function mergeValues(b, o, t) {
  const st = newStats();
  let B, O, T;
  try {
    B = b == null ? undefined : JSON.parse(b);
    O = o == null ? undefined : JSON.parse(o);
    T = t == null ? undefined : JSON.parse(t);
  } catch { st.conflicts++; return { value: t, stats: st }; }
  const m = merge3(B, O, T, st);
  if (m === O) return { value: o, stats: st };
  if (m === T) return { value: t, stats: st };
  return { value: m === undefined ? null : JSON.stringify(m), stats: st };
}

/* 电脑台账里资产编号重复的（多半是覆盖后又录了一遍）：只报还原后新出现的 */
function dupCodes(value) {
  let a; try { a = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(a)) return [];
  const n = new Map();
  for (const x of a) { const c = x && String(x.code || '').trim(); if (c) n.set(c, (n.get(c) || 0) + 1); }
  return [...n].filter(([, k]) => k > 1).map(([c]) => c);
}

/* 还原到第 idx 次改动（listEvents 的下标）之前：要写哪些 key、各是什么值。
   keepLater：这次之后的改动保留（三方合并）；否则完全退回到那次之前 */
function plan(idx, db = getDb(), { keepLater = false } = {}) {
  const evs = listEvents(db);
  const e = evs[idx];
  if (!e) return null;
  const cur = new Map(db.prepare('SELECT key, value, version FROM ams_kv').all().map(r => [r.key, r]));
  const later = evs.length - 1 - idx; // 这次之后还有几次改动
  const changes = [], unknown = [], stats = {}, target = new Map();
  for (const [key, s] of e.before) {
    const now = cur.get(key);
    const nowVal = now ? now.value : null;
    if (s.unknown) { unknown.push(key); target.set(key, nowVal); continue; }
    let val = s.value;
    if (keepLater && later > 0) {
      const a = e.after.get(key);
      if (a && !a.unknown && a.value !== nowVal) { // 这份数据覆盖之后又被改过 → 合并
        const r = mergeValues(a.value, s.value, nowVal);
        val = r.value; stats[key] = r.stats;
      }
    }
    target.set(key, val);
    if (nowVal === val) continue;
    changes.push({ key, value: val, baseVersion: now ? now.version : 0 });
  }
  const tState = new Map([...target].map(([k, v]) => [k, { value: v }]));
  const nowState = new Map([...cur].map(([k, r]) => [k, { value: r.value }]));
  const before = (e.before.get('ams:assets') || {}).value;
  const files = db.prepare('SELECT id, deleted FROM ams_files WHERE updated_at >= ?').all(e.start);
  return {
    event: e, changes, unknown, later, keepLater: keepLater && later > 0, stats,
    summary: SUMMARY_KEYS.map(k => ({ key: k, label: labelOf(k), now: countIn(nowState, k), restored: countIn(tState, k) })),
    newDups: keepLater ? dupCodes(target.get('ams:assets')).filter(c => !dupCodes(before).includes(c)) : [],
    filesDeleted: files.filter(f => f.deleted).length,
    filesChanged: files.filter(f => !f.deleted).length
  };
}

/* 真正还原：走与客户端推送相同的写入路径（旧值进历史、版本 +1、游标前进），一个事务 */
function apply(idx, db = getDb(), opts = {}) {
  const p = plan(idx, db, opts);
  if (!p) return null;
  if (!p.changes.length) return { ...p, written: 0 };
  const res = amsSvc.push({ id: null }, { deviceId: `${RESTORE_DEVICE}:${Date.now().toString(36)}`, changes: p.changes });
  const bad = res.results.filter(r => !r.ok);
  if (bad.length) {
    const e = new Error(`有 ${bad.length} 份数据在还原的同时被别的电脑改了（${bad.map(r => labelOf(r.key)).join('、')}），请稍后重新执行一次`);
    e.code = 'CONFLICT';
    throw e;
  }
  db.prepare(`INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (NULL, 'ams_restore', ?, 'manage.sh', ?)`)
    .run(`before=${p.event.start} dev=${p.event.dev} keys=${p.changes.length} keepLater=${p.keepLater ? 1 : 0}`, new Date().toISOString());
  return { ...p, written: p.changes.length };
}

module.exports = { listEvents, suspectIndex, plan, apply, labelOf, countOf, isRestore, mergeValues, RESTORE_DEVICE, SUMMARY_KEYS };
