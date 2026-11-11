// 账号管理：列表 / 新建 / 编辑（登录账号、角色、科室多选、启停）/ 重置密码显示一次性密码 / 解冻 / 删除 / Excel 批量导入
import { useEffect, useState } from 'react'
import { api, getUser, setUser } from '../api/client'
import { useDepts, deptOptLabel } from '../hooks'
import { asList, nz, ROLE_TEXT, fmtRetry } from '../utils'
import { Badge, Empty, ErrorTip, Field, Modal, Spinner } from '../components/ui'
import AccountImportModal from '../components/AccountImportModal'
import { usePaged } from '../components/Pager'
import VoidSignModal from '../components/VoidSignModal'

const ROLES = ['inspector', 'dept', 'equip', 'admin']

/* 登录账号的规则，和服务端一致（服务端最终把关）：不能为空、不能有空格、最多 32 个字、不能和别的账号重复（不区分大小写） */
export function usernameProblem(name, list, selfId) {
  const t = (name || '').trim()
  if (!t) return '登录账号不能为空'
  if (/\s/.test(t)) return '登录账号里不能有空格'
  if (t.length > 32) return '登录账号最多 32 个字'
  const dup = (list || []).find(u => String(u.id) !== String(selfId || '') && u.username.toLowerCase() === t.toLowerCase())
  if (dup) return `登录账号「${dup.username}」已被「${dup.displayName}」使用（不区分大小写），请换一个`
  return null
}

function normUser(u) {
  return {
    id: String(u.id),
    username: u.username,
    displayName: nz(u.displayName, u.display_name, ''),
    role: u.role,
    deptIds: (nz(u.deptIds, u.dept_ids, []) || []).map(String),
    status: nz(u.status, 'on'),
    mustChange: !!nz(u.mustChange, u.must_change, false),
    frozenSec: nz(u.frozenSec, 0)
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
            {deptOptLabel(d)}
          </button>
        )
      })}
      {depts.length === 0 && <span className="text-xs text-slate-500">暂无科室，请先在「科室管理」中创建</span>}
    </div>
  )
}

function UserModal({ open, onClose, editing, depts, allDepts, users, onSaved }) {
  const isNew = !editing?.id
  const me = getUser()
  const isSelf = !isNew && String(editing?.id) === String(me?.id)
  /* 只有管理员能授予「超级管理员」；设备科看到这个选项、选了也会被服务端拒绝 */
  const roles = ROLES.filter(r => r !== 'admin' || me?.role === 'admin')
  const [form, setForm] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  /* 换成护士长时，原来多选的科室不能原样带过去（护士长只能管 1 个科室，以前会存成挂多个科室的护士长）：
     只选了 1 个就保留，否则清空让人重新选 */
  const setRole = role => setForm(f => ({ ...f, role, deptIds: role === 'dept' && (f.deptIds || []).length > 1 ? [] : (f.deptIds || []) }))
  // 已分配的停用科室也要显示出来（标「已停用」），否则编辑时看不到、保存又会被悄悄带上
  const choices = [...depts, ...allDepts.filter(d => d.status === 'off' && (form.deptIds || []).includes(String(d.id)))]

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
    if (form.role === 'dept' && form.deptIds.length !== 1) return setErr({ message: '护士长只能属于 1 个科室' })
    if (!(form.displayName || '').trim()) return setErr({ message: '姓名不能为空' })
    const why = usernameProblem(form.username, users, isNew ? '' : editing.id)
    if (why) return setErr({ message: why })
    const username = form.username.trim()
    setBusy(true)
    try {
      if (isNew) {
        await api('/admin/users', {
          method: 'POST',
          body: { username, password: form.password, displayName: form.displayName.trim(), role: form.role, deptIds: needDept ? form.deptIds : [] }
        })
      } else {
        const saved = await api(`/admin/users/${editing.id}`, {
          method: 'PATCH',
          body: isSelf
            ? { username, displayName: form.displayName.trim(), deptIds: needDept ? form.deptIds : [] }
            : { username, displayName: form.displayName.trim(), role: form.role, deptIds: needDept ? form.deptIds : [], status: form.status }
        })
        // 改的是自己：左下角显示的名字跟着变
        if (isSelf && saved) setUser({ ...me, username: saved.username, displayName: saved.displayName })
      }
      onSaved()
      onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title={isNew ? '新建账号' : `编辑账号：${editing?.username}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorTip error={err} className="mb-3" />
        {isNew ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="登录账号" required hint="不能有空格，不能和已有账号重复">
              <input className="inp" value={form.username || ''} onChange={e => set('username', e.target.value)} required maxLength={32} />
            </Field>
            <Field label="初始密码" required hint="至少 6 位">
              <input className="inp" value={form.password || ''} onChange={e => set('password', e.target.value)} required minLength={6} />
            </Field>
          </div>
        ) : (
          <Field label="登录账号" required
            hint={(form.username || '').trim() !== editing.username
              ? `改好后，本人要用新账号「${(form.username || '').trim()}」登录（密码不变）；以前的巡检和签字记录不受影响`
              : '不能有空格，不能和已有账号重复（不区分大小写）'}>
            <input className="inp font-mono" value={form.username || ''} onChange={e => set('username', e.target.value)} required maxLength={32} />
          </Field>
        )}
        <Field label="姓名" required>
          <input className="inp" value={form.displayName || ''} onChange={e => set('displayName', e.target.value)} required />
        </Field>
        <Field label="角色" required hint={isSelf ? '不能修改自己正在使用的账号的角色' : '巡检员可多科室；护士长单科室；设备科/超管为全院'}>
          <select className="inp" value={form.role || 'inspector'} onChange={e => setRole(e.target.value)} disabled={isSelf}>
            {(form.role && !roles.includes(form.role) ? [...roles, form.role] : roles).map(r => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
          </select>
        </Field>
        {needDept && (
          <Field label={form.role === 'dept' ? '所属科室（单选）' : '负责科室（多选）'} required>
            <DeptMultiSelect value={form.deptIds || []} onChange={v => set('deptIds', v)} depts={choices} single={form.role === 'dept'} />
          </Field>
        )}
        {!isNew && !isSelf && (
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
  const { onDepts, depts, deptLabel, error: deptErr } = useDepts()
  const me = getUser()
  const iAmAdmin = me?.role === 'admin'
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)        // null | {} | user
  const [resetInfo, setResetInfo] = useState(null) // {username, password}
  const [copied, setCopied] = useState(false)
  const [delTarget, setDelTarget] = useState(null) // 待删除的账号
  const [importOpen, setImportOpen] = useState(false)
  const [kw, setKw] = useState('')
  const [roleF, setRoleF] = useState('')
  const shown = (list || []).filter(u => (!roleF || u.role === roleF)
    && (!kw || `${u.username} ${u.displayName}`.toLowerCase().includes(kw.trim().toLowerCase())))
  const { items: pageList, pager } = usePaged(list ? shown : null, 'users', { resetOn: [kw, roleF] })

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

  async function unfreeze(u) {
    if (!confirm(`确认是「${u.displayName}」本人输错了密码？解冻后可以立即用原密码登录。`)) return
    try {
      await api(`/admin/users/${u.id}/unfreeze`, { method: 'POST' })
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
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>批量导入</button>
          <button className="btn-primary" onClick={() => setModal({})}>+ 新建账号</button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="inp !w-36" value={roleF} onChange={e => setRoleF(e.target.value)} aria-label="按角色筛选">
          <option value="">全部角色</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
        </select>
        <input className="inp !w-64" placeholder="搜索账号 / 姓名" value={kw} onChange={e => setKw(e.target.value)} />
      </div>
      <ErrorTip error={err || deptErr} className="mb-4" />

      <div className="card overflow-x-auto">
        {!list ? <Spinner /> : shown.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead>
              <tr><th>账号</th><th>姓名</th><th>角色</th><th>科室</th><th>状态</th><th className="text-right">操作</th></tr>
            </thead>
            <tbody>
              {pageList.map(u => {
                /* 管理员账号只有管理员能动；自己的账号不能在这里停用（会把自己锁在门外） */
                const locked = u.role === 'admin' && !iAmAdmin
                const isSelf = String(u.id) === String(me?.id)
                return (
                <tr key={u.id}>
                  <td className="font-mono text-slate-600">{u.username}</td>
                  <td className="font-medium">
                    {u.displayName}
                    {isSelf && <span className="ml-1 text-xs text-slate-500">（我）</span>}
                    {u.mustChange && <Badge color="amber">待改密</Badge>}
                    {u.frozenSec > 0 && <span className="ml-1"><Badge color="red">冻结中 · 约 {fmtRetry(u.frozenSec)}后自动解除</Badge></span>}
                  </td>
                  <td>{ROLE_TEXT[u.role] || u.role}</td>
                  <td className="max-w-[260px]">
                    {u.role === 'equip' || u.role === 'admin'
                      ? <span className="text-slate-500">全院</span>
                      : (u.deptIds.length ? u.deptIds.map(deptLabel).join('、') : <span className="text-red-500">未分配科室</span>)}
                  </td>
                  <td>{u.status === 'on' ? <Badge color="green">启用</Badge> : <Badge color="red">已停用</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    {locked ? <span className="text-xs text-slate-500">仅超级管理员可操作</span> : (<>
                      {u.frozenSec > 0 && <button className="btn-ghost !px-2.5 !py-1 text-xs mr-1.5" onClick={() => unfreeze(u)}>解冻</button>}
                      <button className="btn-ghost !px-2.5 !py-1 text-xs mr-1.5" onClick={() => setModal(u)}>编辑</button>
                      {!isSelf && <button className="btn-ghost !px-2.5 !py-1 text-xs mr-1.5" onClick={() => resetPwd(u)}>重置密码</button>}
                      {!isSelf && (
                        <button className={`!px-2.5 !py-1 text-xs mr-1.5 ${u.status === 'on' ? 'btn-danger' : 'btn-ghost'}`} onClick={() => toggleStatus(u)}>
                          {u.status === 'on' ? '停用' : '启用'}
                        </button>
                      )}
                      {!isSelf && (
                        <button className="!px-2.5 !py-1 text-xs btn bg-red-600 text-white hover:bg-red-700" onClick={() => setDelTarget(u)}>删除</button>
                      )}
                    </>)}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {list && shown.length > 0 && <div className="border-t border-slate-100">{pager}</div>}
      </div>

      <UserModal open={modal !== null} editing={modal} depts={onDepts} allDepts={depts} users={list || []} onClose={() => setModal(null)} onSaved={load} />

      <DeleteModal user={delTarget} deptLabel={deptLabel} onClose={() => setDelTarget(null)} onDone={load} />

      <AccountImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />

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

/* 删除确认弹窗：写清楚删的是谁、删了会怎样。
   还有有效签字的账号服务端会拒绝（409）：这时把是哪几条签字列出来（哪个科室、哪一天 / 周 / 月），
   超级管理员可以就地作废（按月签 → 周签 → 日签的顺序排好），作废完就能删；也可以直接改为停用 */
const SIGN_TEXT = { day: '日签', week: '周签', month: '月签' }
function DeleteModal({ user, deptLabel, onClose, onDone }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [signs, setSigns] = useState(null)     // 挡住删除的签字
  const [voidTarget, setVoidTarget] = useState(null)
  const iAmAdmin = getUser()?.role === 'admin'
  useEffect(() => { setErr(null); setBlocked(false); setBusy(false); setSigns(null); setVoidTarget(null) }, [user])
  if (!user) return null
  const scope = user.role === 'equip' || user.role === 'admin' ? '全院' : (user.deptIds.map(deptLabel).join('、') || '未分配科室')

  async function loadSigns() {
    try {
      const list = await api(`/admin/users/${user.id}/signs`)
      setSigns(list)
      if (!list.length) { setBlocked(false); setErr(null) } // 都作废了：可以删了
    } catch (e) { setErr(e) }
  }
  async function remove() {
    setBusy(true); setErr(null)
    try {
      await api(`/admin/users/${user.id}`, { method: 'DELETE' })
      onDone(); onClose()
    } catch (e) {
      if (e.status === 409) { setBlocked(true); await loadSigns() } else setErr(e)
    } finally { setBusy(false) }
  }
  async function disable() {
    setBusy(true); setErr(null)
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'off' } })
      onDone(); onClose()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const keyText = x => (x.type === 'week' ? `${x.key} 起的一周` : x.key)

  return (
    <Modal open title="删除账号" onClose={onClose} width={blocked ? 'max-w-3xl' : 'max-w-md'}>
      <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm leading-7">
        <div>登录账号：<b className="font-mono">{user.username}</b></div>
        <div>姓名：<b>{user.displayName}</b></div>
        <div>角色：{ROLE_TEXT[user.role] || user.role}　科室：{scope}</div>
      </div>
      {!blocked && signs && signs.length === 0 && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">这个账号的签字都已作废，现在可以删除了。</p>
      )}
      {!blocked && (
        <p className="mb-3 text-sm text-slate-600">
          删除后这个账号<b className="text-red-600">不能恢复</b>，手机和电脑上的登录会立即失效。还有有效签字（日签、周签、月签）的账号不能删除：签错的先作废再删，不再使用的改为停用。确定删除？
        </p>
      )}
      {blocked && signs && signs.length > 0 && (
        <div className="mb-3">
          <p className="mb-2 text-sm text-red-700">
            这个账号还有 <b>{signs.length}</b> 条有效的签字，删了就查不到是谁签的，所以不能删除。
            确实签错的，{iAmAdmin ? '在下面逐条作废（已按月签 → 周签 → 日签排好，从上往下作废）' : '请超级管理员作废'}，全部作废后就能删除；
            不再使用的，直接改为停用即可。
          </p>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            <table className="tbl">
              <thead><tr><th>签字</th><th>科室</th><th>日期 / 周 / 月</th><th>签字人</th><th>签字时间</th>{iAmAdmin && <th></th>}</tr></thead>
              <tbody>
                {signs.map(x => (
                  <tr key={`${x.type}-${x.deptId}-${x.key}`}>
                    <td className="whitespace-nowrap"><Badge color={x.type === 'day' ? 'slate' : x.type === 'week' ? 'amber' : 'green'}>{SIGN_TEXT[x.type]}</Badge></td>
                    <td className="font-medium">{x.dept}</td>
                    <td className="whitespace-nowrap tabular-nums">{keyText(x)}</td>
                    <td>{x.signName || '—'}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-500">{x.at}</td>
                    {iAmAdmin && (
                      <td className="text-right">
                        <button className="btn-danger whitespace-nowrap !px-2.5 !py-1 text-xs"
                          onClick={() => setVoidTarget({ type: x.type, deptId: x.deptId, key: x.key, label: `${x.dept} ${keyText(x)}` })}>作废</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ErrorTip error={err} className="mb-3" />
      {blocked && user.status === 'on' && (
        <p className="mb-3 text-sm text-slate-600">停用后这个账号就登录不了了，历史记录里的名字照常显示，以后需要还能重新启用。</p>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{blocked ? '关闭' : '取消'}</button>
        {!blocked && <button className="btn bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={remove}>{busy ? '删除中…' : '确认删除'}</button>}
        {blocked && user.status === 'on' && <button className="btn-danger" disabled={busy} onClick={disable}>改为停用</button>}
      </div>
      <VoidSignModal target={voidTarget} onClose={() => setVoidTarget(null)} onDone={loadSigns} />
    </Modal>
  )
}
