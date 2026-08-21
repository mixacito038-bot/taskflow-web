// 账号管理：列表 / 新建 / 编辑（角色、科室多选、启停）/ 重置密码显示一次性密码
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useDepts } from '../hooks'
import { asList, nz, ROLE_TEXT } from '../utils'
import { Badge, Empty, ErrorTip, Field, Modal, Spinner } from '../components/ui'

const ROLES = ['inspector', 'dept', 'equip', 'admin']

function normUser(u) {
  return {
    id: String(u.id),
    username: u.username,
    displayName: nz(u.displayName, u.display_name, ''),
    role: u.role,
    deptIds: (nz(u.deptIds, u.dept_ids, []) || []).map(String),
    status: nz(u.status, 'on'),
    mustChange: !!nz(u.mustChange, u.must_change, false)
  }
}

function DeptMultiSelect({ value, onChange, depts, single }) {
  function toggle(id) {
    id = String(id)
    if (single) return onChange([id])
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
  }
  return (
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
      {depts.map(d => {
        const on = value.includes(String(d.id))
        return (
          <button key={d.id} type="button" onClick={() => toggle(d.id)}
            className={`rounded-full px-2.5 py-1 text-xs transition ${on ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {d.name}
          </button>
        )
      })}
      {depts.length === 0 && <span className="text-xs text-slate-500">暂无科室，请先在「科室管理」中创建</span>}
    </div>
  )
}

function UserModal({ open, onClose, editing, depts, onSaved }) {
  const isNew = !editing?.id
  const [form, setForm] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setErr(null)
      setForm(isNew
        ? { username: '', password: '', displayName: '', role: 'inspector', deptIds: [], status: 'on' }
        : { ...editing })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const needDept = form.role === 'inspector' || form.role === 'dept'

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (needDept && !(form.deptIds || []).length) return setErr({ message: '该角色需要至少选择一个科室' })
    setBusy(true)
    try {
      if (isNew) {
        await api('/admin/users', {
          method: 'POST',
          body: { username: form.username.trim(), password: form.password, displayName: form.displayName.trim(), role: form.role, deptIds: needDept ? form.deptIds : [] }
        })
      } else {
        await api(`/admin/users/${editing.id}`, {
          method: 'PATCH',
          body: { displayName: form.displayName.trim(), role: form.role, deptIds: needDept ? form.deptIds : [], status: form.status }
        })
      }
      onSaved()
      onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title={isNew ? '新建账号' : `编辑账号：${editing?.username}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorTip error={err} className="mb-3" />
        {isNew && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="登录账号" required>
              <input className="inp" value={form.username || ''} onChange={e => set('username', e.target.value)} required />
            </Field>
            <Field label="初始密码" required hint="至少 6 位">
              <input className="inp" value={form.password || ''} onChange={e => set('password', e.target.value)} required minLength={6} />
            </Field>
          </div>
        )}
        <Field label="姓名" required>
          <input className="inp" value={form.displayName || ''} onChange={e => set('displayName', e.target.value)} required />
        </Field>
        <Field label="角色" required hint="巡检员可多科室；护士长单科室；设备科/超管为全院">
          <select className="inp" value={form.role || 'inspector'} onChange={e => set('role', e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
          </select>
        </Field>
        {needDept && (
          <Field label={form.role === 'dept' ? '所属科室（单选）' : '负责科室（多选）'} required>
            <DeptMultiSelect value={form.deptIds || []} onChange={v => set('deptIds', v)} depts={depts} single={form.role === 'dept'} />
          </Field>
        )}
        {!isNew && (
          <Field label="状态" hint="停用后该账号全部登录态立即失效">
            <select className="inp" value={form.status || 'on'} onChange={e => set('status', e.target.value)}>
              <option value="on">启用</option>
              <option value="off">停用</option>
            </select>
          </Field>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Users() {
  const { onDepts, deptName } = useDepts()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)        // null | {} | user
  const [resetInfo, setResetInfo] = useState(null) // {username, password}
  const [copied, setCopied] = useState(false)

  function load() {
    api('/admin/users').then(res => setList(asList(res).map(normUser))).catch(setErr)
  }
  useEffect(load, [])

  async function toggleStatus(u) {
    const to = u.status === 'on' ? 'off' : 'on'
    if (to === 'off' && !confirm(`确定停用「${u.displayName}」？其全部登录态将立即失效。`)) return
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: to } })
      load()
    } catch (e) { setErr(e) }
  }

  async function resetPwd(u) {
    if (!confirm(`确定重置「${u.displayName}」的密码？旧密码将立即失效。`)) return
    try {
      const res = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST' })
      setCopied(false)
      setResetInfo({ username: u.username, password: res.password })
      load()
    } catch (e) { setErr(e) }
  }

  function copyPwd() {
    navigator.clipboard?.writeText(resetInfo.password).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold">账号管理</h2>
        <button className="btn-primary" onClick={() => setModal({})}>+ 新建账号</button>
      </div>
      <ErrorTip error={err} className="mb-4" />

      <div className="card overflow-x-auto">
        {!list ? <Spinner /> : list.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead>
              <tr><th>账号</th><th>姓名</th><th>角色</th><th>科室</th><th>状态</th><th className="text-right">操作</th></tr>
            </thead>
            <tbody>
              {list.map(u => (
                <tr key={u.id}>
                  <td className="font-mono text-slate-600">{u.username}</td>
                  <td className="font-medium">{u.displayName}{u.mustChange && <Badge color="amber">待改密</Badge>}</td>
                  <td>{ROLE_TEXT[u.role] || u.role}</td>
                  <td className="max-w-[260px]">
                    {u.role === 'equip' || u.role === 'admin'
                      ? <span className="text-slate-500">全院</span>
                      : (u.deptIds.length ? u.deptIds.map(deptName).join('、') : <span className="text-slate-400">—</span>)}
                  </td>
                  <td>{u.status === 'on' ? <Badge color="green">启用</Badge> : <Badge color="red">已停用</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost !px-2.5 !py-1 text-xs mr-1.5" onClick={() => setModal(u)}>编辑</button>
                    <button className="btn-ghost !px-2.5 !py-1 text-xs mr-1.5" onClick={() => resetPwd(u)}>重置密码</button>
                    <button className={`!px-2.5 !py-1 text-xs ${u.status === 'on' ? 'btn-danger' : 'btn-ghost'}`} onClick={() => toggleStatus(u)}>
                      {u.status === 'on' ? '停用' : '启用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UserModal open={modal !== null} editing={modal} depts={onDepts} onClose={() => setModal(null)} onSaved={load} />

      <Modal open={!!resetInfo} title="密码已重置" onClose={() => setResetInfo(null)} width="max-w-sm">
        {resetInfo && (
          <div>
            <p className="mb-3 text-sm text-slate-600">账号 <b>{resetInfo.username}</b> 的一次性初始密码（仅显示这一次，请立即告知本人；首次登录将强制改密）：</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-slate-100 px-3 py-2.5 text-center text-lg font-bold tracking-wider">{resetInfo.password}</code>
              <button className="btn-ghost" onClick={copyPwd}>{copied ? '已复制' : '复制'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
