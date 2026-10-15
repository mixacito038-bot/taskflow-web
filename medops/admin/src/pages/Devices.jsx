// 设备台账：增删改 + xlsx 导入（上传→逐行结果）+ 模板下载
import { useEffect, useState } from 'react'
import { api, download } from '../api/client'
import { useDepts, useServerTime, deptOptLabel } from '../hooks'
import { asList, nz, DEVICE_STATUS, devStatusText, isDevStatus } from '../utils'
import { Badge, Empty, ErrorTip, Field, Modal, Spinner } from '../components/ui'
import XlsxImportModal from '../components/XlsxImportModal'

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
  /* setUTCFullYear 而非 Date.UTC(y,…)：后者把 0~99 的年份当成 1900+y。
     必须和后端 expiry.service.js 的 daysBetween 逐字对应，否则会出现
     「列表显示还剩 1 天、首页提醒里却没有」这种错位 */
  const t = s => { const d = new Date(0); d.setUTCFullYear(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); d.setUTCHours(12, 0, 0, 0); return d.getTime() }
  const days = Math.round((t(expiryDate) - t(today)) / 86400000)
  const win = +remindDays > 0 ? +remindDays : 30
  if (days < 0) return { level: 'expired', days, text: `已过期 ${-days} 天` }
  if (days <= win) return { level: 'soon', days, text: days === 0 ? '今天到期' : `还剩 ${days} 天` }
  return { level: 'ok', days, text: `还剩 ${days} 天` }
}

function DeviceModal({ open, onClose, editing, depts, formDepts, onSaved, time }) {
  const isNew = !editing?.id
  const [form, setForm] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setErr(null)
      /* 状态无效的旧数据（如 active）：下拉框里没有这一项，浏览器会显示成第一项「在用」，
         看着选好了、保存时却把 active 原样提交上去被拒。这里清空，逼着重新选一次 */
      setForm(isNew
        ? { deptId: depts[0]?.id ? String(depts[0].id) : '', catName: '', code: '', name: '', model: '', location: '', status: 'in_use', expiryDate: '', expiryNote: '', remindDays: 0 }
        : { ...editing, status: isDevStatus(editing.status) ? editing.status : '' })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    /* 日期框只删了一部分（比如删掉「日」）时，浏览器给的值是空串，看起来像「不适用」——
       直接保存会把已录的到期日悄悄清掉，所以先拦下来 */
    if (form.expiryBad) return setErr({ message: '到期日没有填完整（年、月、日都要有），或点日期框右侧清空后再保存' })
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
              {/* 当前所在科室已停用时也要列出来，否则下拉会错显成第一个科室 */}
              {(formDepts ? formDepts(form.deptId) : depts).map(d => <option key={d.id} value={String(d.id)} disabled={d.status === 'off'}>{deptOptLabel(d)}</option>)}
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
        <Field label="状态" required>
          <select className="inp" value={form.status || ''} onChange={e => set('status', e.target.value)} required>
            {!form.status && <option value="" disabled>请选择</option>}
            {DEVICE_STATUS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          {!isNew && !isDevStatus(editing?.status) && (
            <span className="mt-1 block text-xs text-red-600">
              原来的状态「{editing?.status || '空'}」系统不认识（手机端巡检清单里没有这台设备，有效期也不提醒），请重新选择
            </span>
          )}
        </Field>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
          <div className="mb-2.5 text-sm font-medium text-slate-700">有效期提醒
            <span className="ml-1.5 text-xs font-normal text-slate-600">除颤电极片、急救药品等有保质期的填这里；设备本身没有有效期就留空</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="到期日">
              <input type="date" className="inp" value={form.expiryDate || ''}
                onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value, expiryBad: e.target.validity.badInput }))} />
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
            /* 后端 expiry.service 的清单只取 status='in_use' 的设备（科室停用了也照样提醒），
               对停用/维修/报废设备说"会出现在首页提醒里"是假承诺，会让人真的不再管它 */
            const alerts = form.status === 'in_use'
            return <div className={`mt-2 text-xs ${cls}`}>按今天（{time.date}）算：{st.text}
              {st.level !== 'ok' && (alerts ? '，会出现在首页提醒里'
                : `，但本设备状态是「${devStatusText(form.status)}」，不会进首页提醒`)}</div>
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

/* 删除被挡住（设备已有巡检记录）：说明原因，并一键改为「已停用 / 已报废」。
   两者在手机端都不再列出、都不进有效期提醒，历史巡检记录与报表照常保留 */
function DeleteBlockedModal({ blocked, onClose, onDone }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setErr(null) }, [blocked])
  if (!blocked) return null
  const d = blocked.device
  const off = d.status === 'retired' || d.status === 'scrapped'

  async function setStatus(status) {
    setErr(null)
    setBusy(true)
    try {
      await api(`/admin/devices/${d.id}`, { method: 'PATCH', body: { status } })
      onDone()
      onClose()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <Modal open title={`不能删除：${d.code} ${d.name}`} onClose={onClose} width="max-w-md">
      <p className="text-sm leading-relaxed text-slate-700">{blocked.message}</p>
      {off && (
        <p className="mt-2 text-sm text-slate-600">
          这台设备现在已经是「{devStatusText(d.status)}」，手机端不会再列出它，不需要删除。
        </p>
      )}
      <ErrorTip error={err} className="mt-3" />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>{off ? '知道了' : '取消'}</button>
        {d.status !== 'scrapped' && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus('scrapped')}>改为「已报废」</button>
        )}
        {!off && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => setStatus('retired')}>改为「已停用」</button>
        )}
      </div>
    </Modal>
  )
}

/* 批量删除的结果：巡检过的设备删不掉（保留历史），列出来并一键改为「已停用 / 已报废」 */
function BatchDeleteResult({ result, onClose, onDone }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setErr(null) }, [result])
  if (!result) return null
  const { deleted = [], blocked = [] } = result

  async function setStatus(status) {
    setErr(null)
    setBusy(true)
    try {
      await api('/admin/devices/batch', { method: 'POST', body: { ids: blocked.map(b => b.id), action: 'status', status } })
      onDone(`已把 ${blocked.length} 台设备改为「${devStatusText(status)}」`)
      onClose()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <Modal open title="批量删除结果" onClose={onClose}>
      <p className="text-sm leading-relaxed text-slate-700">
        已删除 <b>{deleted.length}</b> 台。下面 <b>{blocked.length}</b> 台有巡检记录，为保留巡检历史不能删除（作废签字也不会删除巡检记录）：
      </p>
      <ul className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 text-sm">
        {blocked.map(b => (
          <li key={b.id} className="flex justify-between gap-3 border-b border-slate-100 px-3 py-1.5 last:border-0">
            <span><span className="font-mono text-slate-600">{b.code}</span> {b.name}</span>
            <span className="whitespace-nowrap text-xs text-slate-500">{b.days} 天记录，最近 {b.last}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-slate-600">不再使用的改为「已停用」或「已报废」即可：手机端不再列出，历史记录和报表照常保留。</p>
      <ErrorTip error={err} className="mt-3" />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>关闭</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus('scrapped')}>这 {blocked.length} 台改为「已报废」</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => setStatus('retired')}>这 {blocked.length} 台改为「已停用」</button>
      </div>
    </Modal>
  )
}

export default function Devices() {
  const { onDepts, filterDepts, formDepts, deptLabel: deptName, error: deptErr } = useDepts()
  const time = useServerTime()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  const [kw, setKw] = useState('')
  const [modal, setModal] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [blocked, setBlocked] = useState(null) // 有巡检记录删不掉：{ device, message }
  const [filterStatus, setFilterStatus] = useState('') // '' 全部 / 四个状态 / bad 状态无效
  const [sel, setSel] = useState(() => new Set())     // 勾选的设备 id
  const [batchResult, setBatchResult] = useState(null) // 批量删除后有删不掉的：{ deleted, blocked }
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    api('/admin/devices').then(res => setList(asList(res).map(normDevice))).catch(setErr)
  }
  useEffect(load, [])

  async function remove(d) {
    if (!confirm(`确定删除设备「${d.code} ${d.name}」？`)) return
    setErr(null)
    try {
      await api(`/admin/devices/${d.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      // 巡检过的设备不能删（保留历史），直接给出「改为停用 / 报废」，不用再去编辑框里找
      if (e.code === 'CONFLICT') setBlocked({ device: d, message: e.message })
      else setErr(e)
    }
  }
  const badCount = (list || []).filter(d => !isDevStatus(d.status)).length

  const shown = (list || []).filter(d =>
    (!filterDept || d.deptId === filterDept) &&
    (!filterStatus || (filterStatus === 'bad' ? !isDevStatus(d.status) : d.status === filterStatus)) &&
    (!kw || [d.code, d.name, d.catName, d.model, d.location].join(' ').toLowerCase().includes(kw.toLowerCase()))
  )

  /* 勾选只对当前列表里看得见的设备生效：换了筛选条件，看不见的自动取消勾选，免得批量操作误伤别的科室 */
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
      ? `删除选中的 ${ids.length} 台设备？\n没有巡检记录的直接删除；巡检过的不能删，会列出来，可以一键改为停用或报废。`
      : `把选中的 ${ids.length} 台设备改为「${devStatusText(status)}」？`
    if (!confirm(ask)) return
    setErr(null)
    setNotice('')
    setBusy(true)
    try {
      const res = await api('/admin/devices/batch', { method: 'POST', body: { ids, action, status } })
      setSel(new Set())
      if (action === 'delete') {
        if (res.blocked?.length) setBatchResult(res)
        else setNotice(`已删除 ${res.deleted.length} 台设备`)
      } else setNotice(`已把 ${res.updated.length} 台设备改为「${devStatusText(status)}」`)
      load()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

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
          {filterDepts.map(d => <option key={d.id} value={String(d.id)}>{deptOptLabel(d)}</option>)}
        </select>
        <select className="inp !w-36" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="按状态筛选">
          <option value="">全部状态</option>
          {DEVICE_STATUS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          <option value="bad">状态无效</option>
        </select>
        <input className="inp !w-64" placeholder="搜索编码 / 名称 / 品类 / 位置" value={kw} onChange={e => setKw(e.target.value)} />
        <span className="self-center text-sm text-slate-600">共 {shown.length} 台</span>
      </div>
      <ErrorTip error={err || deptErr} className="mb-4" />
      {badCount > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          有 {badCount} 台设备的状态无效（下面红色标出）：手机端巡检清单里没有它们，有效期也不会提醒。
          请点「编辑」重新选择状态后保存；多的话
          <button className="mx-1 font-medium underline" onClick={() => { setFilterStatus('bad'); setFilterDept(''); setKw('') }}>只看这些</button>
          ，全选后批量改。
        </div>
      )}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
      {sel.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-light px-3 py-2 text-sm shadow-sm">
          <span className="mr-1 font-medium text-primary">已选 {sel.size} 台</span>
          <span className="text-slate-600">改为</span>
          {DEVICE_STATUS.map(([v, t]) => (
            <button key={v} className="btn-ghost !bg-white !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => batch('status', v)}>{t}</button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-300" aria-hidden="true" />
          <button className="btn-danger !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => batch('delete')}>批量删除</button>
          <button className="ml-auto text-xs text-slate-600 hover:text-slate-800" onClick={() => setSel(new Set())}>取消选择</button>
        </div>
      )}

      <div className="card overflow-x-auto">
        {!list ? <Spinner /> : shown.length === 0 ? <Empty /> : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" aria-label="全选当前列表" checked={allOn} onChange={toggleAll}
                    ref={el => { if (el) el.indeterminate = someOn && !allOn }} />
                </th>
                <th>编码</th><th>名称</th><th>品类</th><th>科室</th><th>位置</th><th>状态</th><th>有效期</th><th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(d => (
                <tr key={d.id} className={sel.has(d.id) ? 'bg-primary-light/60' : ''}>
                  <td><input type="checkbox" aria-label={`选择 ${d.code}`} checked={sel.has(d.id)} onChange={() => toggle(d.id)} /></td>
                  <td className="font-mono text-slate-600">{d.code}</td>
                  <td className="font-medium">{d.name}</td>
                  <td>{d.catName}</td>
                  <td>{deptName(d.deptId)}</td>
                  <td className="text-slate-500">{d.location || '—'}</td>
                  <td className="whitespace-nowrap">{d.status === 'in_use' ? <Badge color="green">在用</Badge>
                    : isDevStatus(d.status) ? <Badge color="amber">{devStatusText(d.status)}</Badge>
                    : <span title="系统不认识这个状态：手机端巡检清单里没有这台设备，有效期也不会提醒。点「编辑」重新选择状态"><Badge color="red">{devStatusText(d.status)}</Badge></span>}</td>
                  <td className="whitespace-nowrap">{(() => {
                    if (!d.expiryDate) return <span className="text-slate-500">—</span>
                    const st = expiryState(d.expiryDate, d.remindDays, time?.date)
                    const color = st?.level === 'expired' ? 'red' : st?.level === 'soon' ? 'amber' : 'slate'
                    /* 只有在用设备才进首页提醒，这里的角标口径必须一致 */
                    const alerts = d.status === 'in_use'
                    return (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums text-slate-600">{d.expiryDate}</span>
                        {st && st.level !== 'ok' && alerts && <Badge color={color}>{st.text}</Badge>}
                        {st && st.level !== 'ok' && !alerts && <span className="text-xs text-slate-500">（不提醒）</span>}
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

      <DeviceModal open={modal !== null} editing={modal} depts={onDepts} formDepts={formDepts} onClose={() => setModal(null)} onSaved={load} time={time} />
      <XlsxImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load}
        title="批量导入设备（xlsx）" uploadPath="/admin/devices/import"
        template={{ path: '/admin/devices/import-template', name: '设备导入模板.xlsx' }}
        intro="按「设备编码」新增或更新（upsert）；科室名称必须已存在，不会自动创建。"
        columns="科室名称 / 设备品类 / 设备编码 / 设备名称 / 型号 / 位置 / 状态 / 有效期 / 提醒提前天数"
        note={<>「有效期」「提醒提前天数」留空表示<b>本次不改动</b>，不会清掉设备上已录的到期日；要清空请在该格填「无」。</>} />
      <DeleteBlockedModal blocked={blocked} onClose={() => setBlocked(null)} onDone={load} />
      <BatchDeleteResult result={batchResult} onClose={() => setBatchResult(null)} onDone={msg => { setNotice(msg); load() }} />
    </div>
  )
}
