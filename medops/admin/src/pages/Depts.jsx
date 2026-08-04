// 科室管理：有记录的科室禁删（服务端 CONFLICT），建议停用
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { asList, nz } from '../utils'
import { Badge, Empty, ErrorTip, Field, Modal, Spinner } from '../components/ui'

function DeptModal({ open, onClose, editing, onSaved }) {
  const isNew = !editing?.id
  const [form, setForm] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setErr(null)
      setForm(isNew ? { name: '', code: '', sort: 0, status: 'on' } : { ...editing })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const body = { name: form.name.trim(), code: (form.code || '').trim(), sort: Number(form.sort) || 0, status: form.status }
    try {
      if (isNew) await api('/admin/depts', { method: 'POST', body })
      else await api(`/admin/depts/${editing.id}`, { method: 'PATCH', body })
      onSaved()
      onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title={isNew ? '新建科室' : `编辑科室：${editing?.name}`} onClose={onClose} width="max-w-sm">
      <form onSubmit={submit}>
        <ErrorTip error={err} className="mb-3" />
        <Field label="科室名称" required>
          <input className="inp" value={form.name || ''} onChange={e => set('name', e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="编码">
            <input className="inp" value={form.code || ''} onChange={e => set('code', e.target.value)} />
          </Field>
          <Field label="排序" hint="数字小的在前">
            <input type="number" className="inp" value={form.sort ?? 0} onChange={e => set('sort', e.target.value)} />
          </Field>
        </div>
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

export default function Depts() {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)

  function load() {
    api('/admin/depts')
      .then(res => setList(asList(res).map(d => ({ ...d, id: String(d.id), sort: nz(d.sort, 0) }))))
      .catch(setErr)
  }
  useEffect(load, [])

  async function remove(d) {
    if (!confirm(`确定删除科室「${d.name}」？仅无巡检记录的科室可删除。`)) return
    setErr(null)
    try {
      await api(`/admin/depts/${d.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      if (e.code === 'CONFLICT') setErr({ message: `「${d.name}」已有巡检记录，不能删除；请改为「停用」。` })
      else setErr(e)
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold">科室管理</h2>
        <button className="btn-primary" onClick={() => setModal({})}>+ 新建科室</button>
      </div>
      <ErrorTip error={err} className="mb-4" />

      <div className="card overflow-x-auto">
        {!list ? <Spinner /> : list.length === 0 ? <Empty text="暂无科室，点右上角新建" /> : (
          <table className="tbl">
            <thead>
              <tr><th>排序</th><th>科室名称</th><th>编码</th><th>状态</th><th className="text-right">操作</th></tr>
            </thead>
            <tbody>
              {[...list].sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name)).map(d => (
                <tr key={d.id}>
                  <td className="text-slate-400 tabular-nums">{d.sort}</td>
                  <td className="font-medium">{d.name}</td>
                  <td className="font-mono text-slate-500">{d.code || '—'}</td>
                  <td>{d.status === 'on' ? <Badge color="green">启用</Badge> : <Badge color="red">已停用</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost !px-2.5 !py-1 text-xs mr-1.5" onClick={() => setModal(d)}>编辑</button>
                    <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={() => remove(d)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <DeptModal open={modal !== null} editing={modal} onClose={() => setModal(null)} onSaved={load} />
    </div>
  )
}
