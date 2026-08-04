// fetch 封装：Bearer 注入、401 自动 refresh 重试一次、KICKED 清 token 回登录页
// X-Device-Id 持久于 localStorage；credentials:'include' 让 sid cookie 生效（<img>/下载用）

const LS_AT = 'insp_admin_at'
const LS_RT = 'insp_admin_rt'
const LS_USER = 'insp_admin_user'
const LS_DEV = 'insp_device_id'

export class ApiError extends Error {
  constructor(code, message, retryAfter, status) {
    super(message || '请求失败')
    this.code = code || 'UNKNOWN'
    this.retryAfter = retryAfter
    this.status = status
  }
}

export function deviceId() {
  let v = localStorage.getItem(LS_DEV)
  if (!v) {
    v = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)
    localStorage.setItem(LS_DEV, v)
  }
  return v
}

export function getToken() { return localStorage.getItem(LS_AT) }
export function getUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || 'null') } catch { return null }
}
export function setSession({ accessToken, refreshToken, user }) {
  if (accessToken) localStorage.setItem(LS_AT, accessToken)
  if (refreshToken) localStorage.setItem(LS_RT, refreshToken)
  if (user) localStorage.setItem(LS_USER, JSON.stringify(user))
}
export function setUser(user) { localStorage.setItem(LS_USER, JSON.stringify(user)) }
export function clearSession() {
  localStorage.removeItem(LS_AT)
  localStorage.removeItem(LS_RT)
  localStorage.removeItem(LS_USER)
}

export function gotoLogin() {
  clearSession()
  const login = import.meta.env.BASE_URL + 'login' // => /admin/login
  if (location.pathname !== login) location.assign(login)
}

// refresh 单飞：并发 401 只发一次 refresh
let refreshing = null
async function doRefresh() {
  const rt = localStorage.getItem(LS_RT)
  if (!rt) throw new ApiError('UNAUTHORIZED', '未登录', undefined, 401)
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() },
    credentials: 'include',
    body: JSON.stringify({ refreshToken: rt })
  })
  if (!res.ok) throw new ApiError('UNAUTHORIZED', '登录已过期', undefined, res.status)
  const data = await res.json()
  setSession(data)
  return data.accessToken
}

/**
 * api('/depts') → JSON；api(path,{raw:true}) → Response（下载用）
 * body 为 FormData 时不设 Content-Type（浏览器自带 boundary）
 */
export async function api(path, { method = 'GET', body, headers = {}, raw = false, _retried = false } = {}) {
  const h = { 'X-Device-Id': deviceId(), ...headers }
  const at = getToken()
  if (at) h.Authorization = 'Bearer ' + at
  let payload
  if (body instanceof FormData) payload = body
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }

  const res = await fetch('/api' + path, { method, headers: h, body: payload, credentials: 'include' })
  if (res.ok) {
    if (raw) return res
    if (res.status === 204) return null
    return res.json()
  }

  let err = { code: 'UNKNOWN', message: `请求失败（HTTP ${res.status}）` }
  try { const j = await res.json(); if (j && j.error) err = j.error } catch { /* 非 JSON 响应 */ }

  // 账号被禁用：清 token 回登录页（仅在已登录态下自动跳，避免登录页自身被刷）
  if (err.code === 'KICKED' && at && !path.startsWith('/auth/login')) {
    gotoLogin()
    throw new ApiError(err.code, err.message, err.retryAfter, res.status)
  }

  // 401：refresh 后重试一次（auth 端点自身除外）
  if (res.status === 401 && !_retried && at && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    try {
      if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null })
      await refreshing
    } catch {
      gotoLogin()
      throw new ApiError('UNAUTHORIZED', '登录已过期，请重新登录', undefined, 401)
    }
    return api(path, { method, body, headers, raw, _retried: true })
  }

  throw new ApiError(err.code, err.message, err.retryAfter, res.status)
}

/** 带 Bearer 拉流并触发浏览器下载（模板等仅认 Bearer 的端点也可用） */
export async function download(path, fallbackName) {
  const res = await api(path, { raw: true })
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)
  let name = fallbackName || 'download'
  if (m) { try { name = decodeURIComponent(m[1].replace(/"/g, '')) } catch { name = m[1] } }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
