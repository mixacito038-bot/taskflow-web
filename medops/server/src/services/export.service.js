'use strict';
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const P = require('./period.service');
const fileSvc = require('./file.service');
const statsSvc = require('./stats.service');
const { REC_SELECT, WS_SELECT, MS_SELECT } = require('./record.service');

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

/* 月报矩阵的设备行 = 该月在本科室实际巡检过的设备 ∪ 本科室当前在用、该月之前已建档的设备。
   ⚠ 旧版只取「当前台账里属于本科室的设备」：设备一调拨，它在原科室历史月报里的整行（连同 ✗）
   消失，同一份文件的异常清单却还有它；调入科室的历史月报又凭空多出一整行空白，像整月漏检。
   已月签归档的月报不能随台账变动而变。
   当前在用设备整月没有巡检记录会显示为空行（真实漏检）；但该月在别的科室被巡检过的
   （月中调拨进来的）不算本科室漏检，不出空行。 */
function monthDevices(deptId, month, monthEnd, itemMap) {
  const db = getDb();
  const seen = new Set([...itemMap.values()].map(it => it.device_id));
  const elsewhere = new Set(db.prepare(`SELECT DISTINCT ri.device_id FROM record_items ri JOIN records r ON r.id = ri.record_id
    WHERE r.dept_id <> ? AND r.date LIKE ? || '-%'`).all(deptId, month).map(r => r.device_id));
  const rows = [...seen].map(id => db.prepare(`SELECT v.*, d.name AS now_dept FROM devices v
    JOIN depts d ON d.id = v.dept_id WHERE v.id = ?`).get(id)).filter(Boolean);
  for (const v of db.prepare("SELECT * FROM devices WHERE dept_id = ? AND status = 'in_use'").all(deptId)) {
    if (seen.has(v.id) || elsewhere.has(v.id) || P.shDateOf(v.created_at) > monthEnd) continue;
    rows.push(v);
  }
  return rows
    .map(v => ({ ...v, label: v.dept_id !== deptId ? `${v.name}（现属${v.now_dept}）` : v.name }))
    .sort((a, b) => (a.dept_id !== deptId) - (b.dept_id !== deptId) || a.sort - b.sort || a.code.localeCompare(b.code));
}

/* 月报：设备×日期矩阵(✓/✗) + 异常清单 + 三级签名（嵌图） */
async function monthlyXlsx(deptId, month) {
  const db = getDb();
  deptId = +deptId;
  const dept = db.prepare('SELECT * FROM depts WHERE id = ?').get(deptId);
  if (!dept) throw E.notFound('科室不存在');
  if (!P.isMonth(month)) throw E.badInput('month 格式必须是 YYYY-MM（月份 01–12）');

  const days = daysOfMonth(month);
  const recs = db.prepare(`${REC_SELECT} WHERE r.dept_id = ? AND r.date LIKE ? || '-%'`).all(deptId, month);
  const recByDate = new Map(recs.map(r => [r.date, r]));
  const itemMap = new Map(); // `${date}|${deviceId}` → result
  for (const r of recs) {
    for (const it of db.prepare('SELECT * FROM record_items WHERE record_id = ?').all(r.id)) {
      itemMap.set(`${r.date}|${it.device_id}`, it);
    }
  }
  const devices = monthDevices(deptId, month, days[days.length - 1], itemMap);

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
    ws.addRow([dv.code, dv.label, dv.cat_name, ...days.map(d => {
      const it = itemMap.get(`${d}|${dv.id}`);
      return it ? (it.result === 'ok' ? '✓' : '✗') : '';
    })]);
  }
  ws.addRow(['日签', '', '', ...days.map(d => { const r = recByDate.get(d); return r && r.sign_at ? '✓' : ''; })]);

  /* Sheet2 异常清单 */
  const ws2 = wb.addWorksheet('异常清单');
  /* 「日签」列：月报随时都能导，月中导出时有些天还没签或签字被作废，异常要能看出是不是已签字确认的 */
  ws2.addRow(['日期', '设备编码', '设备名称', '品类', '异常说明', '巡检员', '日签']).font = { bold: true };
  [12, 14, 20, 12, 40, 12, 18].forEach((w, i) => { ws2.getColumn(i + 1).width = w; });
  for (const x of statsSvc.ngList(null, { from: `${month}-01`, to: `${month}-31`, deptId })) {
    ws2.addRow([x.date, x.deviceCode, x.deviceName, x.catName, x.note, x.inspectorName, statsSvc.NG_SIGN_TEXT(x)]);
  }

  /* Sheet3 签字（三级，嵌图） */
  const ws3 = wb.addWorksheet('签字');
  [12, 12, 10, 24, 18, 20].forEach((w, i) => { ws3.getColumn(i + 1).width = w; });
  ws3.addRow(['级别', '周期', '签字人', '意见', '时间', '签名']).font = { bold: true };
  let r = 1;
  for (const d of days) {
    const rec = recByDate.get(d);
    if (!rec || !rec.sign_at) continue;
    r = ws3.addRow(['日签', d, rec.sign_user_live || rec.sign_name, rec.sign_opinion || '', rec.sign_at, '']).number;
    embedSign(wb, ws3, rec.sign_file_id, r, 5);
  }
  for (const w of db.prepare(`${WS_SELECT} WHERE w.dept_id = ? AND w.week_start LIKE ? || '-%' ORDER BY w.week_start`).all(deptId, month)) {
    r = ws3.addRow(['周签', `${w.week_start} 起`, w.member_live != null ? w.member_live : w.sign_name, w.sign_opinion || '', w.sign_at, '']).number;
    embedSign(wb, ws3, w.sign_file_id, r, 5);
  }
  const ms = db.prepare(`${MS_SELECT} WHERE ms.dept_id = ? AND ms.month = ?`).get(deptId, month);
  if (ms) {
    // 月签覆盖的是归属本月的各周（周一在本月），首尾可能跨到上月末、下月初，写明范围免得对不上
    const span = P.monthSpan(month);
    r = ws3.addRow(['月签', `${month}（${span.from.slice(5)}～${span.to.slice(5)}）`, ms.signer_live || ms.sign_name,
      ms.sign_opinion || '', ms.sign_at, '']).number;
    embedSign(wb, ws3, ms.sign_file_id, r, 5);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* 异常清单表（deptId 可选：与页面上的科室筛选一致，旧版忽略科室条件、总是导出全院） */
async function ngXlsx(deptIds, { from, to, deptId, sign }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('异常清单');
  ws.addRow(['日期', '科室', '设备编码', '设备名称', '品类', '异常说明', '巡检员', '当日签字', '设备现状']).font = { bold: true };
  [12, 14, 14, 20, 12, 40, 12, 18, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (const x of statsSvc.ngList(deptIds, { from, to, deptId, sign })) {
    ws.addRow([x.date, x.deptName, x.deviceCode, x.deviceName, x.catName, x.note, x.inspectorName,
      statsSvc.NG_SIGN_TEXT(x), statsSvc.devStatusText(x.deviceStatus)]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* 设备导入模板。示例行单独放第 2 张表：导入只读第 1 张表（import.service 取 worksheets[0]），
   用户忘删示例也不会凭空多出一台「JZ-CD-001」 */
const TPL_HEADER = ['科室名称', '设备品类', '设备编码', '设备名称', '型号', '位置', '状态', '有效期', '提醒提前天数'];
const TPL_WIDTHS = [14, 14, 16, 20, 16, 16, 10, 14, 14];

async function importTemplateXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('设备导入');
  ws.addRow(TPL_HEADER).font = { bold: true };
  TPL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const demo = wb.addWorksheet('填写示例（勿改此表）');
  demo.addRow(TPL_HEADER).font = { bold: true };
  TPL_WIDTHS.forEach((w, i) => { demo.getColumn(i + 1).width = w; });
  demo.addRow(['急诊科', '除颤仪', 'JZ-CD-001', '除颤监护仪', 'XD-100', '抢救室', '在用', '2027-03-15', 30]);
  demo.addRow(['重症医学科', '呼吸机', 'ICU-HX-001', '有创呼吸机', 'Savina300', '1 床', '在用', '', '']);
  demo.addRow([]);
  demo.addRow(['说明：请把设备填进第 1 张表「设备导入」，本表仅供参照，导入时不会被读取。']);
  demo.addRow(['「科室名称」须与系统中已建科室完全一致；「设备编码」是唯一标识，重复导入会更新同编码设备。']);
  demo.addRow(['「状态」可填：在用 / 维修 / 停用 / 报废。留空：新设备默认为在用；系统里已有的设备不改动原状态。']);
  demo.addRow(['「有效期」填除颤电极片、急救药品等的到期日，格式 2027-03-15（必须年月日填全）；设备本身没有有效期就留空。']);
  demo.addRow(['「提醒提前天数」到期前多少天开始提醒，留空表示用默认 30 天。']);
  demo.addRow(['⚠ 重新导入时，有效期两列留空表示「本次不改动」，不会清掉系统里已录好的到期日；要清空请在该格填「无」。']);
  demo.addRow(['「状态」必须是上面四个词之一，写「正常」「使用中」这类同义词会整行导入失败并提示。']);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* 科室导入模板（示例同样放第 2 张表，导入只读第 1 张） */
const DEPT_TPL_HEADER = ['科室名称', '编码', '排序', '状态'];
const DEPT_TPL_WIDTHS = [18, 14, 8, 8];
async function deptTemplateXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('科室导入');
  ws.addRow(DEPT_TPL_HEADER).font = { bold: true };
  DEPT_TPL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const demo = wb.addWorksheet('填写示例（勿改此表）');
  demo.addRow(DEPT_TPL_HEADER).font = { bold: true };
  DEPT_TPL_WIDTHS.forEach((w, i) => { demo.getColumn(i + 1).width = w; });
  demo.addRow(['急诊科', 'JZ', 1, '启用']);
  demo.addRow(['重症医学科', 'ICU', 2, '启用']);
  demo.addRow([]);
  demo.addRow(['说明：请把科室填进第 1 张表「科室导入」，本表仅供参照，导入时不会被读取。']);
  demo.addRow(['「科室名称」是唯一标识：系统里已有同名科室就更新它，没有就新建。']);
  demo.addRow(['「编码」「排序」「状态」留空：新科室编码为空、排序 0、启用；已有科室不改动。要清空编码请填「无」。']);
  demo.addRow(['「状态」可填：启用 / 停用。「排序」填整数，数字小的排在前面。']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { monthlyXlsx, ngXlsx, importTemplateXlsx, deptTemplateXlsx };
