// 登录页：账号密码 + mustChange 强制改密；FROZEN/PROBE_COOLDOWN/KICKED 友好文案（契约 §1）
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setSession, setUser, clearSession } from '../api/client'
import { fmtRetry } from '../utils'
import { ErrorTip, Field } from '../components/ui'

function loginErrText(e) {
  switch (e.code) {
    case 'FROZEN': return `登录失败次数过多，账号已临时冻结，请 ${fmtRetry(e.retryAfter)} 后再试`
    case 'PROBE_COOLDOWN': return `尝试过于频繁，请 ${fmtRetry(e.retryAfter)} 后再试`
    case 'KICKED': return e.message || '您的账户已被禁用，请联系设备科'
    case 'UNAUTHORIZED': return '账号或密码不正确'
    default: return e.message || '登录失败，请稍后再试'
  }
}

export default function Login() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  // mustChange 强制改密步骤
  const [mustChange, setMustChange] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [pwd1, setPwd1] = useState('')
  const [pwd2, setPwd2] = useState('')

  async function doLogin(e) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } })
      if (!['equip', 'admin'].includes(data.user?.role)) {
        // 非管理角色：吊销刚发的 refreshToken，不留会话
        try {
          await fetch('/api/auth/logout', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.accessToken },
            body: JSON.stringify({ refreshToken: data.refreshToken })
          })
        } catch { /* 忽略 */ }
        setErr({ message: '该账号无权访问管理后台（仅设备科 / 超级管理员）' })
        return
      }
      setSession(data)
      if (data.user.mustChange) {
        setOldPwd(password)
        setMustChange(true)
      } else {
        nav('/', { replace: true })
      }
    } catch (e2) {
      setErr({ message: loginErrText(e2) })
    } finally {
      setBusy(false)
    }
  }

  async function doChangePwd(e) {
    e.preventDefault()
    setErr(null)
    if (pwd1.length < 6) return setErr({ message: '新密码至少 6 位' })
    if (pwd1 !== pwd2) return setErr({ message: '两次输入的新密码不一致' })
    setBusy(true)
    try {
      await api('/auth/change-password', { method: 'POST', body: { oldPassword: oldPwd, newPassword: pwd1 } })
      const me = await api('/auth/me')
      setUser(me.user || me)
      nav('/', { replace: true })
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  function cancelChange() {
    clearSession()
    setMustChange(false)
    setPassword('')
    setErr(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white text-2xl font-bold shadow-lg shadow-primary/30">巡</span>
          <h1 className="text-xl font-semibold">急救设备巡检 · 管理后台</h1>
          <p className="mt-1 text-sm text-slate-400">设备科 / 管理员登录</p>
        </div>

        <div className="card p-6">
          {!mustChange ? (
            <form onSubmit={doLogin}>
              <ErrorTip error={err} className="mb-4" />
              <Field label="账号" required>
                <input className="inp" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" autoFocus />
              </Field>
              <Field label="密码" required>
                <input type="password" className="inp" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
              </Field>
              <button className="btn-primary mt-2 w-full" disabled={busy}>{busy ? '登录中…' : '登 录'}</button>
            </form>
          ) : (
            <form onSubmit={doChangePwd}>
              <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
                首次登录（或密码已被重置），请先设置新密码
              </div>
              <ErrorTip error={err} className="mb-4" />
              <Field label="新密码" required hint="至少 6 位">
                <input type="password" className="inp" value={pwd1} onChange={e => setPwd1(e.target.value)} required autoComplete="new-password" autoFocus />
              </Field>
              <Field label="确认新密码" required>
                <input type="password" className="inp" value={pwd2} onChange={e => setPwd2(e.target.value)} required autoComplete="new-password" />
              </Field>
              <button className="btn-primary mt-2 w-full" disabled={busy}>{busy ? '提交中…' : '设置并进入'}</button>
              <button type="button" className="btn-ghost mt-2 w-full" onClick={cancelChange}>返回登录</button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">巡检员 / 护士长请使用手机端（/xunjian/）</p>
      </div>
    </div>
  )
}
