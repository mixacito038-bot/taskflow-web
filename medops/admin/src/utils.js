// 通用小工具

/** 取第一个非空值（容忍后端字段命名差异） */
export function nz(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v
  return undefined
}

/** 响应可能是数组或 {list|rows|items|data:[...]} —— 统一取数组 */
export function asList(res) {
  if (Array.isArray(res)) return res
  if (!res || typeof res !== 'object') return []
  return res.list || res.rows || res.items || res.data || []
}

/** retryAfter 秒 → 友好文案 */
export function fmtRetry(sec) {
  if (!sec || sec <= 0) return '稍后'
  if (sec < 60) return `${sec} 秒`
  return `${Math.ceil(sec / 60)} 分钟`
}

/** Date → YYYY-MM-DD（仅用于表单默认值，业务日期以 /api/time 为准） */
export function ymd(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export const ROLE_TEXT = { inspector: '巡检员', dept: '护士长', equip: '设备科', admin: '超级管理员' }
/* 必须与后端 import.service.js 的 STATUS_MAP 保持一致（在用/维修/停用/报废），
   少一个 scrapped 会让报废设备在列表里显示成英文、在编辑弹窗里被显示成「在用」 */
export const DEVICE_STATUS = [
  ['in_use', '在用'],
  ['repair', '维修中'],
  ['retired', '已停用'],
  ['scrapped', '已报废']
]
export const devStatusText = s => (DEVICE_STATUS.find(([k]) => k === s) || [s, s === 'on' ? '在用' : s])[1]
