// 主框架：左侧固定侧栏 + 内容区；含修改密码与退出
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, clearSession, getUser } from '../api/client'
import { ROLE_TEXT } from '../utils'
import { Modal, Field, ErrorTip } from './ui'

const NAV = [
  { group: '总览', items: [{ to: '/', label: '未签提醒', icon: '◉', end: true }] },
  {
    group: '巡检数据',
    items: [
      { to: '/records', label: '巡检记录', icon: '☑' },
      { to: '/signs', label: '周签 / 月签', icon: '✍' },
      { to: '/ng', label: '异常清单', icon: '⚠' },
      { to: '/stats', label: '统计分析', icon: '▤' },
      { to: '/export', label: '月报导出', icon: '⤓' }
    ]
  },
  {
    group: '基础资料',
    items: [
      { to: '/depts', label: '科室管理', icon: '▦' },
      { to: '/devices', label: '设备台账', icon: '✚' },
      { to: '/members', label: '签字人名单', icon: '☰' }
    ]
  },
  {
    group: '系统',
    items: [
      { to: '/users', label: '账号管理', icon: '◑' },
      { to: '/import-legacy', label: '历史数据导入', icon: '⇪', adminOnly: true }
    ]
  }
]

function ChangePwdModal({ open, onClose }) {
  const [oldPwd, setOldPwd] = useState('')
  const [pwd1, setPwd1] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (pwd1.length < 6) return setErr({ message: '新密码至少 6 位' })
    if (pwd1 !== pwd2) return setErr({ message: '两次输入的新密码不一致' })
    setBusy(true)
    try {
      await api('/auth/change-password', { method: 'POST', body: { oldPassword: oldPwd, newPassword: pwd1 } })
      setOk(true)
      setTimeout(onClose, 1200)
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title="修改密码" onClose={onClose} width="max-w-sm">
      {ok ? <div className="py-4 text-center text-emerald-600 text-sm">修改成功</div> : (
        <form onSubmit={submit}>
          <ErrorTip error={err} className="mb-3" />
          <Field label="当前密码" required>
            <input type="password" className="inp" value={oldPwd} onChange={e => setOldPwd(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Field label="新密码" required hint="至少 6 位">
            <input type="password" className="inp" value={pwd1} onChange={e => setPwd1(e.target.value)} required autoComplete="new-password" />
          </Field>
          <Field label="确认新密码" required>
            <input type="password" className="inp" value={pwd2} onChange={e => setPwd2(e.target.value)} required autoComplete="new-password" />
          </Field>
          <button className="btn-primary w-full mt-1" disabled={busy}>{busy ? '提交中…' : '确认修改'}</button>
        </form>
      )}
    </Modal>
  )
}

export default function Layout() {
  const user = getUser()
  const nav = useNavigate()
  const [pwdOpen, setPwdOpen] = useState(false)
  const isAdmin = user?.role === 'admin'

  async function logout() {
    try { await api('/auth/logout', { method: 'POST', body: { refreshToken: localStorage.getItem('insp_admin_rt') } }) } catch { /* 忽略 */ }
    clearSession()
    nav('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen">
      {/* 侧栏 */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col bg-white border-r border-slate-200">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white text-lg font-bold">巡</span>
          <div>
            <div className="text-sm font-semibold leading-tight">急救设备巡检</div>
            <div className="text-xs text-slate-400">管理后台</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {NAV.map(g => {
            const items = g.items.filter(i => !i.adminOnly || isAdmin)
            if (!items.length) return null
            return (
              <div key={g.group} className="mb-4">
                <div className="px-2 pb-1.5 text-xs text-slate-400">{g.group}</div>
                {items.map(i => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.end}
                    className={({ isActive }) =>
                      `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                        isActive ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-primary-light hover:text-primary'
                      }`
                    }
                  >
                    <span className="w-4 text-center opacity-80">{i.icon}</span>
                    {i.label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 px-2">
            <div className="text-sm font-medium text-slate-700">{user?.displayName || user?.username}</div>
            <div className="text-xs text-slate-400">{ROLE_TEXT[user?.role] || user?.role}</div>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 !px-2 !py-1.5 text-xs" onClick={() => setPwdOpen(true)}>修改密码</button>
            <button className="btn-ghost flex-1 !px-2 !py-1.5 text-xs" onClick={logout}>退出登录</button>
          </div>
        </div>
      </aside>

      {/* 内容区 */}
      <main className="ml-56 flex-1 p-6">
        <Outlet />
      </main>

      <ChangePwdModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  )
}
