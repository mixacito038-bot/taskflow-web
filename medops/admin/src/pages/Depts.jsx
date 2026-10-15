// 科室管理：有记录的科室禁删（服务端 CONFLICT），建议停用；Excel 批量导入；勾选批量启用 / 停用 / 删除
import { useEffect, useState } from 'react'
import { api, download } from '../api/client'
import { asList, nz } from '../utils'
import { Badge, Empty, ErrorTip, Field, Modal, Spinner } from '../components/ui'
import XlsxImportModal from '../components/XlsxImportModal'

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
        <Field label="状态" hint={form.status === 'off' ? '停用后：不能再录入巡检；历史记录、统计、月报照常可查可导出；在用的过期设备仍会提醒' : undefined}>
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

/* 批量删除的结果：用过的科室删不掉，逐个写明原因，并一键改为「停用」 */
function BatchDeleteResult({ result, onClose, onDone }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setErr(null) }, [result])
  if (!result) return null
  const { deleted = [], blocked = [] } = result

  async function disableAll() {
    setErr(null)
    setBusy(true)
    try {
      await api('/admin/depts/batch', { method: 'POST', body: { ids: blocked.map(b => b.id), action: 'status', status: 'off' } })
      onDone(`已把 ${blocked.length} 个科室改为「停用」`)
      onClose()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <Modal open title="批量删除结果" onClose={onClose}>
      <p className="text-sm leading-relaxed text-slate-700">
        已删除 <b>{deleted.length}</b> 个。下面 <b>{blocked.length}</b> 个科室用过，不能删除：
      </p>
      <ul className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 text-sm">
        {blocked.map(b => (
          <li key={b.id} className="border-b border-slate-100 px-3 py-1.5 last:border-0">
            <span className="font-medium text-slate-800">{b.name}</span>
            <span className="text-slate-600">：{b.reason}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-slate-600">
        不再使用的改为「停用」即可：不能再录入巡检，历史记录、统计、月报照常保留。
      </p>
      <ErrorTip error={err} className="mt-3" />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>关闭</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={disableAll}>这 {blocked.length} 个改为「停用」</button>
      </div>
    </Modal>
  )
}

export default function Depts() {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState('') // '' 全部 / on 启用 / off 停用
  const [kw, setKw] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [batchResult, setBatchResult] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    api('/admin/depts')
      .then(res => setList(asList(res).map(d => ({ ...d, id: String(d.id), sort: nz(d.sort, 0) }))))
      .catch(setErr)
  }
  useEffect(load, [])

  async function remove(d) {
    if (!confirm(`确定删除科室「${d.name}」？只有从没用过的科室能删除，用过的请改为「停用」。`)) return
    setErr(null)
    setNotice('')
    try {
      await api(`/admin/depts/${d.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      // 服务端会说清楚为什么不能删（有巡检/签字记录，或还有护士长账号属于它）
      setErr({ message: `「${d.name}」不能删除：${e.message}` })
    }
  }

  const shown = [...(list || [])]
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name))
    .filter(d => (!filterStatus || d.status === filterStatus) &&
      (!kw || [d.name, d.code].join(' ').toLowerCase().includes(kw.toLowerCase())))

  /* 勾选只对当前列表里看得见的科室生效：换了筛选条件，看不见的自动取消勾选 */
  const shownKey = shown.map(d => d.id).join(',')
  useEffect(() => {
    const ids = new Set(shown.map(d => d.id))
    setSel(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [shownKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const allOn = shown.length > 0 && shown.every(d => sel.has(d.id))
  const someOn = shown.some(d => sel.has(d.id))
  const toggleAll = () => setSel(allOn ? new Set() : new Set(shown.map(d => d.id)))
  const toggle = id => setSel(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function batch(action, status) {
    const ids = [...sel]
    if (!ids.length) return
    const ask = action === 'delete'
      ? `删除选中的 ${ids.length} 个科室？\n只有从没用过的科室能删除（会连同它下面没巡检过的设备、签字人名单一起删除）；用过的会列出来，可以一键改为停用。`
      : `把选中的 ${ids.length} 个科室改为「${status === 'on' ? '启用' : '停用'}」？${status === 'off' ? '\n停用后不能再录入巡检，历史记录、统计、月报照常保留。' : ''}`
    if (!confirm(ask)) return
    setErr(null)
    setNotice('')
    setBusy(true)
    try {
      const res = await api('/admin/depts/batch', { method: 'POST', body: { ids, action, status } })
      setSel(new Set())
      if (action === 'delete') {
        if (res.blocked?.length) setBatchResult(res)
        else setNotice(`已删除 ${res.deleted.length} 个科室`)
      } else setNotice(`已把 ${res.updated.length} 个科室改为「${status === 'on' ? '启用' : '停用'}」`)
      load()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">科室管理</h2>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => download('/admin/depts/import-template', '科室导入模板.xlsx').catch(setErr)}>下载导入模板</button>
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>批量导入</button>
          <button className="btn-primary" onClick={() => setModal({})}>+ 新建科室</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className="inp !w-36" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="按状态筛选">
          <option value="">全部状态</option>
          <option value="on">启用</option>
          <option value="off">已停用</option>
        </select>
        <input className="inp !w-64" placeholder="搜索科室名称 / 编码" value={kw} onChange={e => setKw(e.target.value)} />
        <span className="self-center text-sm text-slate-600">共 {shown.length} 个</span>
      </div>
      <ErrorTip error={err} className="mb-4" />
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
      {sel.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-light px-3 py-2 text-sm shadow-sm">
          <span className="mr-1 font-medium text-primary">已选 {sel.size} 个</span>
          <span className="text-slate-600">改为</span>
          <button className="btn-ghost !bg-white !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => batch('status', 'on')}>启用</button>
          <button className="btn-ghost !bg-white !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => batch('status', 'off')}>停用</button>
          <span className="mx-1 h-4 w-px bg-slate-300" aria-hidden="true" />
          <button className="btn-danger !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => batch('delete')}>批量删除</button>
          <button className="ml-auto text-xs text-slate-600 hover:text-slate-800" onClick={() => setSel(new Set())}>取消选择</button>
        </div>
      )}

      <div className="card overflow-x-auto">
        {!list ? <Spinner /> : list.length === 0 ? <Empty text="暂无科室，点右上角新建，或用「批量导入」" />
          : shown.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" aria-label="全选当前列表" checked={allOn} onChange={toggleAll}
                    ref={el => { if (el) el.indeterminate = someOn && !allOn }} />
                </th>
                <th>排序</th><th>科室名称</th><th>编码</th><th>状态</th><th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(d => (
                <tr key={d.id} className={sel.has(d.id) ? 'bg-primary-light/60' : ''}>
                  <td><input type="checkbox" aria-label={`选择 ${d.name}`} checked={sel.has(d.id)} onChange={() => toggle(d.id)} /></td>
                  <td className="text-slate-500 tabular-nums">{d.sort}</td>
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
      <XlsxImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load}
        title="批量导入科室（xlsx）" uploadPath="/admin/depts/import"
        template={{ path: '/admin/depts/import-template', name: '科室导入模板.xlsx' }}
        intro="按「科室名称」新增或更新：系统里已有同名科室就更新它，没有就新建。"
        columns="科室名称 / 编码 / 排序 / 状态"
        note={<>「编码」「排序」「状态」留空表示已有科室<b>本次不改动</b>；状态填「启用」或「停用」。</>} />
      <BatchDeleteResult result={batchResult} onClose={() => setBatchResult(null)} onDone={msg => { setNotice(msg); load() }} />
    </div>
  )
}
