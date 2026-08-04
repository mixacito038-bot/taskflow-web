'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const period = require('./period.service');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIGN_BYTES = 1024 * 1024; // 解码后 ≤1MB

let DATA_DIR = null;
function initFiles(dataDir) { DATA_DIR = dataDir; }
function absPath(relPath) { return path.join(DATA_DIR, 'files', relPath); }

/* 校验并落盘签名图：dataUrl(PNG) → DATA_DIR/files/signatures/YYYY/MM/<uuid>.png */
function saveSignature(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw E.badInput('签名必须是 PNG dataUrl');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_SIGN_BYTES) throw E.badInput('签名图过大（超过 1MB）');
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) throw E.badInput('签名图不是合法 PNG');
  const id = crypto.randomUUID();
  const { date } = period.shNow();
  const rel = `signatures/${date.slice(0, 4)}/${date.slice(5, 7)}/${id}.png`;
  const abs = absPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  getDb().prepare(`INSERT INTO files (id, kind, rel_path, mime, size, sha256, created_at)
    VALUES (?, 'signature', ?, 'image/png', ?, ?, ?)`)
    .run(id, rel, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), new Date().toISOString());
  return { id, url: `/api/files/${id}` };
}

function getFile(id) {
  const row = getDb().prepare('SELECT * FROM files WHERE id = ?').get(String(id));
  if (!row) return null;
  return { ...row, abs: absPath(row.rel_path) };
}

/* 文件归属的科室（用于范围校验）：被哪个签字引用 */
function fileDeptId(id) {
  const db = getDb();
  const r = db.prepare('SELECT dept_id FROM records WHERE sign_file_id = ?').get(id)
    || db.prepare('SELECT dept_id FROM week_signs WHERE sign_file_id = ?').get(id)
    || db.prepare('SELECT dept_id FROM month_signs WHERE sign_file_id = ?').get(id);
  return r ? r.dept_id : null;
}

module.exports = { initFiles, absPath, saveSignature, getFile, fileDeptId };
