// 设备台账：增删改 + xlsx 导入（上传→逐行结果）+ 模板下载
import { useEffect, useRef, useState } from 'react'
import { api, download } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { asList, nz, DEVICE_STATUS, devStatusText } from '../utils'
import { Badge, Empty, ErrorTip, Field, Modal, Spinner } from '../components/ui'

function normDevice(d) {
  return {
    id: String(d.id),
    deptId: String(nz(d.deptId, d.dept_id, '')),
    catName: nz(d.catName, d.cat_name, ''),
    code: d.code,
    name: d.name,
    model: nz(d.model, ''),
    location: nz(d.location, ''),
    status: nz(d.status, 'in_use'),
    expiryDate: nz(d.expiryDate, d.expiry_date, ''),
    expiryNote: nz(d.expiryNote, d.expiry_note, ''),
    remindDays: nz(d.remindDays, d.remind_days, 0)
  }
}

/* 有效期状态：与后端 expiry.service 判定一致（默认提前 30 天） */
export function expiryState(expiryDate, remindDays, today) {
  if (!expiryDate || !today) return null
  const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12)
  const days = Math.round((t(expiryDate) - t(today)) / 86400000)
  const win = +remindDays > 0 ? +remindDays : 30
  if (days < 0) return { level: 'expired', days, text: `已过期 ${-days} 天` }
  if (days <= win) return { level: 'soon', days, text: days === 0 ? '今天到期' : `还剩 ${days} 天` }
  return { level: 'ok', days, text: `还剩 ${days} 天` }
}

function DeviceModal({ open, onClose, editing, depts, onSaved, time }) {
  const isNew = !editing?.id
  const [form, setForm] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setErr(null)
      setForm(isNew
        ? { deptId: depts[0]?.id ? String(depts[0].id) : '', catName: '', code: '', name: '', model: '', location: '', status: 'in_use', expiryDate: '', expiryNote: '', remindDays: 0 }
        : { ...editing })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const body = {
      deptId: form.deptId, catName: form.catName.trim(), code: form.code.trim(),
      name: form.name.trim(), model: (form.model || '').trim(), location: (form.location || '').trim(), status: form.status,
      expiryDate: (form.expiryDate || '').trim(),
      expiryNote: (form.expiryNote || '').trim(),
      remindDays: +form.remindDays || 0
    }
    try {
      if (isNew) await api('/admin/devices', { method: 'POST', body })
      else await api(`/admin/devices/${editing.id}`, { method: 'PATCH', body })
      onSaved()
      onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title={isNew ? '新增设备' : `编辑设备：${editing?.code}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorTip error={err} className="mb-3" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="所属科室" required>
            <select className="inp" value={form.deptId || ''} onChange={e => set('deptId', e.target.value)} required>
              <option value="" disabled>请选择</option>
              {depts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="设备品类" required hint="如：除颤仪、心电监护仪">
            <input className="inp" value={form.catName || ''} onChange={e => set('catName', e.target.value)} required />
          </Field>
          <Field label="设备编码" required hint="全院唯一">
            <input className="inp" value={form.code || ''} onChange={e => set('code', e.target.value)} required />
          </Field>
          <Field label="设备名称" required>
            <input className="inp" value={form.name || ''} onChange={e => set('name', e.target.value)} required />
          </Field>
          <Field label="型号">
            <input className="inp" value={form.model || ''} onChange={e => set('model', e.target.value)} />
          </Field>
          <Field label="位置">
            <input className="inp" value={form.location || ''} onChange={e => set('location', e.target.value)} />
          </Field>
        </div>
        <Field label="状态">
          <select className="inp" value={form.status || 'in_use'} onChange={e => set('status', e.target.value)}>
            {DEVICE_STATUS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Field>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
          <div className="mb-2.5 text-sm font-medium text-slate-700">有效期提醒
            <span className="ml-1.5 text-xs font-normal text-slate-600">除颤电极片、急救药品等有保质期的填这里；设备本身没有有效期就留空</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="到期日">
              <input type="date" className="inp" value={form.expiryDate || ''} onChange={e => set('expiryDate', e.target.value)} />
            </Field>
            <Field label="提前提醒" hint="留空按 30 天">
              <input type="number" min="0" max="365" className="inp" placeholder="30"
                value={form.remindDays || ''} onChange={e => set('remindDays', e.target.value)} />
            </Field>
            <Field label="说明" hint="如：电极片">
              <input className="inp" maxLength={60} value={form.expiryNote || ''}
                onChange={e => set('expiryNote', e.target.value)} />
            </Field>
          </div>
          {form.expiryDate && time?.date && (() => {
            const st = expiryState(form.expiryDate, form.remindDays, time.date)
            if (!st) return null
            const cls = st.level === 'expired' ? 'text-red-700' : st.level === 'soon' ? 'text-amber-700' : 'text-slate-600'
            return <div className={`mt-2 text-xs ${cls}`}>按今天（{time.date}）算：{st.text}
              {st.level !== 'ok' && '，会出现在首页提醒里'}</div>
          })()}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ImportModal({ open, onClose, onDone }) {
  const fileRef = useRef(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // {created,updated,errors:[{row,message}]}

  useEffect(() => { if (open) { setErr(null); setResult(null) } }, [open])

  async function submit(e) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return setErr({ message: '请选择 xlsx 文件' })
    if (file.size > 5 * 1024 * 1024) return setErr({ message: '文件超过 5MB 限制' })
    setErr(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api('/admin/devices/import', { method: 'POST', body: fd })
      setResult(res)
      onDone()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title="批量导入设备（xlsx）" onClose={onClose}>
      {!result ? (
        <form onSubmit={submit}>
          <ErrorTip error={err} className="mb-3" />
          <p className="mb-3 text-sm text-slate-500">
            按「设备编码」新增或更新（upsert）；科室名称必须已存在，不会自动创建。
            <button type="button" className="ml-1 text-primary hover:underline"
              onClick={() => download('/admin/devices/import-template', '设备导入模板.xlsx').catch(setErr)}>
              下载模板
            </button>
          </p>
          <Field label="选择文件" required hint="xlsx，≤5MB。列：科室名称 / 设备品类 / 设备编码 / 设备名称 / 型号 / 位置 / 状态">
            <input ref={fileRef} type="file" accept=".xlsx" className="inp !py-1.5" required />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
            <button className="btn-primary" disabled={busy}>{busy ? '导入中…' : '开始导入'}</button>
          </div>
        </form>
      ) : (
        <div>
          <div className="mb-4 flex gap-3">
            <div className="flex-1 rounded-lg bg-emerald-50 p-3 text-center">
              <div className="text-xl font-bold text-emerald-600">{result.created ?? 0}</div>
              <div className="text-xs text-emerald-600">新增</div>
            </div>
            <div className="flex-1 rounded-lg bg-primary-light p-3 text-center">
              <div className="text-xl font-bold text-primary">{result.updated ?? 0}</div>
              <div className="text-xs text-primary">更新</div>
            </div>
            <div className="flex-1 rounded-lg bg-red-50 p-3 text-center">
              <div className="text-xl font-bold text-red-500">{result.errors?.length ?? 0}</div>
              <div className="text-xs text-red-500">失败</div>
            </div>
          </div>
          {result.errors?.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-red-100">
              <table className="tbl">
                <thead><tr><th className="w-16">行号</th><th>错误原因</th></tr></thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}><td className="tabular-nums text-slate-500">{e.row}</td><td className="text-red-600">{e.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" onClick={onClose}>完成</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function Devices() {
  const { onDepts, deptName } = useDepts()
  const time = useServerTime()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  const [kw, setKw] = useState('')
  const [modal, setModal] = useState(null)
  const [importOpen, setImportOpen] = useState(false)

  function load() {
    api('/admin/devices').then(res => setList(asList(res).map(normDevice))).catch(setErr)
  }
  useEffect(load, [])

  async function remove(d) {
    if (!confirm(`确定删除设备「${d.code} ${d.name}」？`)) return
    try {
      await api(`/admin/devices/${d.id}`, { method: 'DELETE' })
      load()
    } catch (e) { setErr(e) }
  }

  const shown = (list || []).filter(d =>
    (!filterDept || d.deptId === filterDept) &&
    (!kw || [d.code, d.name, d.catName, d.model, d.location].join(' ').toLowerCase().includes(kw.toLowerCase()))
  )

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">设备台账</h2>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => download('/admin/devices/import-template', '设备导入模板.xlsx').catch(setErr)}>下载导入模板</button>
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>批量导入</button>
          <button className="btn-primary" onClick={() => setModal({})}>+ 新增设备</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className="inp !w-48" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
          <option value="">全部科室</option>
          {onDepts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
        </select>
        <input className="inp !w-64" placeholder="搜索编码 / 名称 / 品类 / 位置" value={kw} onChange={e => setKw(e.target.value)} />
        <span className="self-center text-sm text-slate-600">共 {shown.length} 台</span>
      </div>
      <ErrorTip error={err} className="mb-4" />

      <div className="card overflow-x-auto">
        {!list ? <Spinner /> : shown.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead>
              <tr><th>编码</th><th>名称</th><th>品类</th><th>科室</th><th>位置</th><th>状态</th><th>有效期</th><th className="text-right">操作</th></tr>
            </thead>
            <tbody>
              {shown.map(d => (
                <tr key={d.id}>
                  <td className="font-mono text-slate-600">{d.code}</td>
                  <td className="font-medium">{d.name}</td>
                  <td>{d.catName}</td>
                  <td>{deptName(d.deptId)}</td>
                  <td className="text-slate-500">{d.location || '—'}</td>
                  <td>{d.status === 'in_use' ? <Badge color="green">在用</Badge> : <Badge color="amber">{devStatusText(d.status)}</Badge>}</td>
                  <td className="whitespace-nowrap">{(() => {
                    if (!d.expiryDate) return <span className="text-slate-500">—</span>
                    const st = expiryState(d.expiryDate, d.remindDays, time?.date)
                    const color = st?.level === 'expired' ? 'red' : st?.level === 'soon' ? 'amber' : 'slate'
                    return (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums text-slate-600">{d.expiryDate}</span>
                        {st && st.level !== 'ok' && <Badge color={color}>{st.text}</Badge>}
                      </span>
                    )
                  })()}</td>
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

      <DeviceModal open={modal !== null} editing={modal} depts={onDepts} onClose={() => setModal(null)} onSaved={load} time={time} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </div>
  )
}
