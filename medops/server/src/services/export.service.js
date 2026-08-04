'use strict';
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const P = require('./period.service');
const fileSvc = require('./file.service');
const statsSvc = require('./stats.service');

function daysOfMonth(month) {
  const d = P.D(`${month}-01`); d.setMonth(d.getMonth() + 1); d.setDate(0);
  const n = d.getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function embedSign(wb, ws, fileId, row, col) {
  const f = fileSvc.getFile(fileId);
  if (!f || !fs.existsSync(f.abs)) return;
  const imgId = wb.addImage({ buffer: fs.readFileSync(f.abs), extension: 'png' });
  // tl 用 0-based 列/行；ext 像素定位
  ws.addImage(imgId, { tl: { col, row: row - 1 }, ext: { width: 110, height: 44 } });
  ws.getRow(row).height = 36;
}

/* 月报：设备×日期矩阵(✓/✗) + 异常清单 + 三级签名（嵌图） */
async function monthlyXlsx(deptId, month) {
  const db = getDb();
  deptId = +deptId;
  const dept = db.prepare('SELECT * FROM depts WHERE id = ?').get(deptId);
  if (!dept) throw E.notFound('科室不存在');
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw E.badInput('month 格式必须是 YYYY-MM');

  const devices = db.prepare('SELECT * FROM devices WHERE dept_id = ? ORDER BY sort, code').all(deptId);
  const days = daysOfMonth(month);
  const recs = db.prepare("SELECT * FROM records WHERE dept_id = ? AND date LIKE ? || '-%'").all(deptId, month);
  const recByDate = new Map(recs.map(r => [r.date, r]));
  const itemMap = new Map(); // `${date}|${deviceId}` → result
  for (const r of recs) {
    for (const it of db.prepare('SELECT * FROM record_items WHERE record_id = ?').all(r.id)) {
      itemMap.set(`${r.date}|${it.device_id}`, it);
    }
  }

  const wb = new ExcelJS.Workbook();

  /* Sheet1 矩阵 */
  const ws = wb.addWorksheet('巡检记录');
  ws.addRow([`急救设备巡检月报 · ${dept.name} · ${month}`]);
  ws.mergeCells(1, 1, 1, 3 + days.length);
  ws.getRow(1).font = { bold: true, size: 14 };
  const head = ['设备编码', '设备名称', '品类', ...days.map(d => String(+d.slice(8, 10)))];
  ws.addRow(head).font = { bold: true };
  ws.getColumn(1).width = 14; ws.getColumn(2).width = 20; ws.getColumn(3).width = 12;
  for (let i = 0; i < days.length; i++) ws.getColumn(4 + i).width = 3.6;
  for (const dv of devices) {
    ws.addRow([dv.code, dv.name, dv.cat_name, ...days.map(d => {
      const it = itemMap.get(`${d}|${dv.id}`);
      return it ? (it.result === 'ok' ? '✓' : '✗') : '';
    })]);
  }
  ws.addRow(['日签', '', '', ...days.map(d => { const r = recByDate.get(d); return r && r.sign_at ? '✓' : ''; })]);

  /* Sheet2 异常清单 */
  const ws2 = wb.addWorksheet('异常清单');
  ws2.addRow(['日期', '设备编码', '设备名称', '品类', '异常说明', '巡检员']).font = { bold: true };
  [12, 14, 20, 12, 40, 12].forEach((w, i) => { ws2.getColumn(i + 1).width = w; });
  for (const x of statsSvc.ngList(null, { from: `${month}-01`, to: `${month}-31`, deptId })) {
    ws2.addRow([x.date, x.deviceCode, x.deviceName, x.catName, x.note, x.inspectorName]);
  }

  /* Sheet3 签字（三级，嵌图） */
  const ws3 = wb.addWorksheet('签字');
  [12, 12, 10, 24, 18, 20].forEach((w, i) => { ws3.getColumn(i + 1).width = w; });
  ws3.addRow(['级别', '周期', '签字人', '意见', '时间', '签名']).font = { bold: true };
  let r = 1;
  for (const d of days) {
    const rec = recByDate.get(d);
    if (!rec || !rec.sign_at) continue;
    r = ws3.addRow(['日签', d, rec.sign_name, rec.sign_opinion || '', rec.sign_at, '']).number;
    embedSign(wb, ws3, rec.sign_file_id, r, 5);
  }
  for (const w of db.prepare("SELECT * FROM week_signs WHERE dept_id = ? AND week_start LIKE ? || '-%' ORDER BY week_start").all(deptId, month)) {
    r = ws3.addRow(['周签', `${w.week_start} 起`, w.sign_name, w.sign_opinion || '', w.sign_at, '']).number;
    embedSign(wb, ws3, w.sign_file_id, r, 5);
  }
  const ms = db.prepare('SELECT * FROM month_signs WHERE dept_id = ? AND month = ?').get(deptId, month);
  if (ms) {
    r = ws3.addRow(['月签', month, ms.sign_name, ms.sign_opinion || '', ms.sign_at, '']).number;
    embedSign(wb, ws3, ms.sign_file_id, r, 5);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* 异常清单表 */
async function ngXlsx(deptIds, { from, to }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('异常清单');
  ws.addRow(['日期', '科室', '设备编码', '设备名称', '品类', '异常说明', '巡检员']).font = { bold: true };
  [12, 14, 14, 20, 12, 40, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (const x of statsSvc.ngList(deptIds, { from, to })) {
    ws.addRow([x.date, x.deptName, x.deviceCode, x.deviceName, x.catName, x.note, x.inspectorName]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* 设备导入模板 */
async function importTemplateXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('设备导入');
  ws.addRow(['科室名称', '设备品类', '设备编码', '设备名称', '型号', '位置', '状态']).font = { bold: true };
  [14, 14, 16, 20, 16, 16, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.addRow(['急诊科', '除颤仪', 'JZ-CD-001', '除颤监护仪', 'XD-100', '抢救室', '在用']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { monthlyXlsx, ngXlsx, importTemplateXlsx };
