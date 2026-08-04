// 签字人名单：科室维度增删改（周签时护士长从中选人）
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useDepts } from '../hooks'
import { asList, nz } from '../utils'
import { Badge, Empty, ErrorTip, Field, Modal, Spinner } from '../components/ui'

function normMember(m) {
  return {
    id: String(m.id),
    deptId: String(nz(m.deptId, m.dept_id, '')),
    name: m.name,
    title: nz(m.title, ''),
    status: nz(m.status, 'on')
  }
}

function MemberModal({ open, onClose, editing, depts, defaultDeptId, onSaved }) {
  const isNew = !editing?.id
  const [form, setForm] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setErr(null)
      setForm(isNew
        ? { deptId: defaultDeptId || (depts[0]?.id ? String(depts[0].id) : ''), name: '', title: '', status: 'on' }
        : { ...editing })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const body = { deptId: form.deptId, name: form.name.trim(), title: (form.title || '').trim(), status: form.status }
    try {
      if (isNew) await api('/admin/members', { method: 'POST', body })
      else await api(`/admin/members/${editing.id}`, { method: 'PATCH', body })
      onSaved()
      onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title={isNew ? '新增签字人' : `编辑签字人：${editing?.name}`} onClose={onClose} width="max-w-sm">
      <form onSubmit={submit}>
        <ErrorTip error={err} className="mb-3" />
        <Field label="科室" required>
          <select className="inp" value={form.deptId || ''} onChange={e => set('deptId', e.target.value)} required>
            <option value="" disabled>请选择</option>
            {depts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="姓名" required>
          <input className="inp" value={form.name || ''} onChange={e => set('name', e.target.value)} required />
        </Field>
        <Field label="职称" hint="如：护士长、主管护师">
          <input className="inp" value={form.title || ''} onChange={e => set('title', e.target.value)} />
        </Field>
        <Field label="状态">
          <select className="inp" value={form.status || 'on'} onChange={e => set('status', e.target.value)}>
            <option value="on">启用</option>
            <option value="off">停用</option>
          </select>
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Members() {
  const { onDepts, deptName } = useDepts()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  const [modal, setModal] = useState(null)

  function load() {
    api('/admin/members').then(res => setList(asList(res).map(normMember))).catch(setErr)
  }
  useEffect(load, [])

  async function remove(m) {
    if (!confirm(`确定删除签字人「${m.name}」？`)) return
    try {
      await api(`/admin/members/${m.id}`, { method: 'DELETE' })
      load()
    } catch (e) { setErr(e) }
  }

  const shown = (list || []).filter(m => !filterDept || m.deptId === filterDept)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold">签字人名单</h2>
        <button className="btn-primary" onClick={() => setModal({})}>+ 新增签字人</button>
      </div>

      <div className="mb-4 flex gap-2">
        <select className="inp !w-48" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
          <option value="">全部科室</option>
          {onDepts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
        </select>
        <span className="self-center text-sm text-slate-400">共 {shown.length} 人</span>
      </div>
      <ErrorTip error={err} className="mb-4" />

      <div className="card overflow-x-auto">
        {!list ? <Spinner /> : shown.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead>
              <tr><th>姓名</th><th>职称</th><th>科室</th><th>状态</th><th className="text-right">操作</th></tr>
            </thead>
            <tbody>
              {shown.map(m => (
                <tr key={m.id}>
                  <td className="font-medium">{m.name}</td>
                  <td className="text-slate-500">{m.title || '—'}</td>
                  <td>{deptName(m.deptId)}</td>
                  <td>{m.status === 'on' ? <Badge color="green">启用</Badge> : <Badge color="red">已停用</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost !px-2.5 !py-1 text-xs mr-1.5" onClick={() => setModal(m)}>编辑</button>
                    <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={() => remove(m)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <MemberModal open={modal !== null} editing={modal} depts={onDepts} defaultDeptId={filterDept} onClose={() => setModal(null)} onSaved={load} />
    </div>
  )
}
