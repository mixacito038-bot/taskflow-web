'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const fileSvc = require('./file.service');

const nowIso = () => new Date().toISOString();
const HISTORY_KEEP = 20;
const PRESENCE_TTL = 5 * 60 * 1000;

/* 同步 key 白名单（契约 §5）：ams:<name> 或 ams:<name>:* */
const NAMES = ['sites', 'areas', 'assets', 'movements', 'inventories', 'users', 'roles', 'approvals',
  'cats', 'catCodes', 'otherCats', 'otherCatCodes', 'otherAssets', 'depreCfg', 'locations', 'tags', 'changelog'];
const EXCLUDE = [/^ams:session$/, /^ams:ui:/, /^ams:_ts$/, /^ams:_lastBackup$/, /^ams:migrated:/];
function keyAllowed(k) {
  if (typeof k !== 'string' || !k.startsWith('ams:')) return false;
  if (EXCLUDE.some(re => re.test(k))) return false;
  const rest = k.slice(4);
  return NAMES.some(n => rest === n || rest.startsWith(n + ':'));
}

/* meta 走 HTTP Header 传输：统一转成 \uXXXX 转义的纯 ASCII JSON */
function jsonAscii(obj) {
  return JSON.stringify(obj == null ? {} : obj)
    .replace(/[\u0080-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}
/* Header 里的 JSON：兼容原样 UTF-8（Node 按 latin1 收）与 \uXXXX 转义两种写法 */
function parseMetaHeader(h) {
  if (!h) return {};
  let s = String(h);
  if (/[\u0080-\u00ff]/.test(s)) s = Buffer.from(s, 'latin1').toString('utf8');
  return JSON.parse(s);
}

function curSeq(db) { return db.prepare('SELECT n FROM ams_seq WHERE id = 1').get().n; }
function nextSeq(db) {
  db.prepare('UPDATE ams_seq SET n = n + 1 WHERE id = 1').run();
  return curSeq(db);
}

/* GET /api/ams/snapshot */
function snapshot() {
  const db = getDb();
  const keys = {};
  for (const r of db.prepare('SELECT key, value, version FROM ams_kv WHERE value IS NOT NULL').all()) {
    keys[r.key] = { value: r.value, version: r.version };
  }
  return { seq: curSeq(db), keys };
}

/* POST /api/ams/push —— 事务逐 key 乐观锁；旧值进 history（留 20 版） */
function push(user, { deviceId, changes }) {
  const db = getDb();
  if (!Array.isArray(changes)) throw E.badInput('changes 必须是数组');
  const dev = String(deviceId || '').slice(0, 64);
  const results = [];
  db.transaction(() => {
    for (const c of changes) {
      const key = c && c.key;
      if (!keyAllowed(key)) { results.push({ key: String(key), ok: false, error: 'BAD_INPUT' }); continue; }
      const base = c.baseVersion | 0;
      const value = c.value === null ? null : String(c.value);
      const row = db.prepare('SELECT * FROM ams_kv WHERE key = ?').get(key);
      const curVer = row ? row.version : 0;
      if (base !== curVer) {
        results.push({ key, ok: false, conflict: { value: row ? row.value : null, version: curVer } });
        continue;
      }
      const seq = nextSeq(db);
      if (row) {
        db.prepare(`INSERT INTO ams_kv_history (key, value, version, updated_at, updated_by, device_id)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(key, row.value, row.version, row.updated_at, row.updated_by, row.device_id);
        db.prepare(`DELETE FROM ams_kv_history WHERE key = ? AND id NOT IN
          (SELECT id FROM ams_kv_history WHERE key = ? ORDER BY id DESC LIMIT ${HISTORY_KEEP})`).run(key, key);
        db.prepare('UPDATE ams_kv SET value = ?, version = version + 1, seq = ?, updated_at = ?, updated_by = ?, device_id = ? WHERE key = ?')
          .run(value, seq, nowIso(), user.id, dev, key);
        results.push({ key, ok: true, newVersion: row.version + 1 });
      } else {
        db.prepare('INSERT INTO ams_kv (key, value, version, seq, updated_at, updated_by, device_id) VALUES (?, ?, 1, ?, ?, ?, ?)')
          .run(key, value, seq, nowIso(), user.id, dev);
        results.push({ key, ok: true, newVersion: 1 });
      }
    }
  })();
  return { seq: curSeq(db), results };
}

/* GET /api/ams/changes?since= */
function changes(since) {
  const db = getDb();
  const s = Number.isFinite(+since) ? +since : 0;
  const keys = {};
  for (const r of db.prepare('SELECT * FROM ams_kv WHERE seq > ?').all(s)) {
    keys[r.key] = { value: r.value, version: r.version };
  }
  const files = db.prepare('SELECT id, sha256, size, deleted, seq FROM ams_files WHERE seq > ?').all(s)
    .map(f => ({ id: f.id, sha256: f.sha256, size: f.size, deleted: !!f.deleted, seq: f.seq }));
  return { seq: curSeq(db), keys, files };
}

/* ---------- 附件 ---------- */
function amsFilePath(id) { return fileSvc.absPath(path.join('ams', `${id}.bin`)); }

function manifest() {
  const db = getDb();
  return db.prepare('SELECT id, asset_id, meta, mime, size, sha256, deleted, seq, updated_at FROM ams_files').all()
    .map(f => ({ id: f.id, assetId: f.asset_id, meta: safeJson(f.meta), mime: f.mime,
      size: f.size, sha256: f.sha256, deleted: !!f.deleted, seq: f.seq, updatedAt: f.updated_at }));
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

function getAmsFile(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ams_files WHERE id = ?').get(String(id));
  if (!row || row.deleted) return null;
  return { ...row, abs: amsFilePath(row.id) };
}

/* PUT ≤20MB 幂等：内容未变化则不推进 seq */
function putAmsFile(id, buffer, metaHeader, mime) {
  const db = getDb();
  id = String(id);
  if (!/^[\w.\-:]{1,128}$/.test(id)) throw E.badInput('文件 id 不合法');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw E.badInput('缺少文件内容');
  let meta = {};
  if (metaHeader) { try { meta = parseMetaHeader(metaHeader); } catch { throw E.badInput('X-Ams-Meta 不是合法 JSON'); } }
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const row = db.prepare('SELECT * FROM ams_files WHERE id = ?').get(id);
  if (row && !row.deleted && row.sha256 === sha) { // 幂等重传
    db.prepare('UPDATE ams_files SET meta = ?, updated_at = ? WHERE id = ?').run(jsonAscii(meta), nowIso(), id);
    return { id, sha256: sha, size: buffer.length, seq: row.seq };
  }
  const abs = amsFilePath(id);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const rel = path.join('ams', `${id}.bin`);
  const m = mime || 'application/octet-stream';
  const seq = db.transaction(() => {
    const s = nextSeq(db);
    if (row) {
      db.prepare('UPDATE ams_files SET asset_id = ?, meta = ?, rel_path = ?, mime = ?, size = ?, sha256 = ?, deleted = 0, seq = ?, updated_at = ? WHERE id = ?')
        .run(String(meta.assetId || row.asset_id || ''), jsonAscii(meta), rel, m, buffer.length, sha, s, nowIso(), id);
    } else {
      db.prepare(`INSERT INTO ams_files (id, asset_id, meta, rel_path, mime, size, sha256, deleted, seq, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
        .run(id, String(meta.assetId || ''), jsonAscii(meta), rel, m, buffer.length, sha, s, nowIso());
    }
    return s;
  })();
  return { id, sha256: sha, size: buffer.length, seq };
}

/* DELETE：置墓碑，幂等 */
function deleteAmsFile(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ams_files WHERE id = ?').get(String(id));
  if (!row) return { id: String(id), deleted: true };
  if (!row.deleted) {
    const s = nextSeq(db);
    db.prepare('UPDATE ams_files SET deleted = 1, seq = ?, updated_at = ? WHERE id = ?').run(s, nowIso(), row.id);
    try { fs.unlinkSync(amsFilePath(row.id)); } catch { /* 已不存在则忽略 */ }
  }
  return { id: row.id, deleted: true };
}

/* ---------- presence 内存表（5min 过期） ---------- */
const presence = new Map(); // deviceId → lastSeen(ms)
function touchPresence(deviceId) {
  const dev = String(deviceId || '').slice(0, 64);
  if (!dev) throw E.badInput('缺少 deviceId');
  const now = Date.now();
  presence.set(dev, now);
  const others = [];
  for (const [id, at] of presence) {
    if (now - at > PRESENCE_TTL) { presence.delete(id); continue; }
    if (id !== dev) others.push({ deviceId: id, lastSeen: new Date(at).toISOString() });
  }
  return { others };
}

module.exports = { snapshot, push, changes, manifest, getAmsFile, putAmsFile, deleteAmsFile, touchPresence, keyAllowed, jsonAscii, safeJson };
