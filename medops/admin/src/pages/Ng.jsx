// 异常清单：GET /stats/ng + 导出 /export/ng.xlsx
import { useEffect, useState } from 'react'
import { api, download } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { asList, addDays, nz } from '../utils'
import { Empty, ErrorTip, Spinner } from '../components/ui'

function normNg(r) {
  return {
    date: r.date,
    deptId: String(nz(r.deptId, r.dept_id, '')),
    deptName: nz(r.deptName, r.dept_name),
    deviceCode: nz(r.deviceCode, r.device_code, ''),
    deviceName: nz(r.deviceName, r.device_name, ''),
    catName: nz(r.catName, r.cat_name, ''),
    note: nz(r.note, ''),
    inspectorName: nz(r.inspectorName, r.inspector_name, '')
  }
}

export default function Ng() {
  const { onDepts, deptName } = useDepts()
  const time = useServerTime()
  const [deptId, setDeptId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (time?.date && !to) { setTo(time.date); setFrom(addDays(time.date, -29)) }
  }, [time]) // eslint-disable-line react-hooks/exhaustive-deps

  async function query() {
    setErr(null)
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      if (deptId) q.set('deptId', deptId)
      const res = await api(`/stats/ng?${q}`)
      setList(asList(res).map(normNg))
    } catch (e) { setErr(e) } finally { setLoading(false) }
  }
  useEffect(() => { if (from && to) query() }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  function doExport() {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    download(`/export/ng.xlsx?${q}`, `异常清单_${from}_${to}.xlsx`).catch(setErr)
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold">异常清单</h2>
        <button className="btn-ghost" onClick={doExport} disabled={!list?.length}>⤓ 导出 xlsx</button>
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">科室</span>
          <select className="inp !w-44" value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">全部科室</option>
            {onDepts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">起始日期</span>
          <input type="date" className="inp !w-40" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">截止日期</span>
          <input type="date" className="inp !w-40" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <button className="btn-primary" onClick={query} disabled={loading}>{loading ? '查询中…' : '查 询'}</button>
        {list && <span className="pb-2 text-sm text-slate-400">共 {list.length} 条异常</span>}
      </div>
      <ErrorTip error={err} className="mb-4" />

      <div className="card overflow-x-auto">
        {list === null ? <Spinner /> : list.length === 0 ? <Empty text="该时段无异常记录" /> : (
          <table className="tbl">
            <thead>
              <tr><th>日期</th><th>科室</th><th>设备编码</th><th>设备名称</th><th>品类</th><th>异常描述</th><th>巡检人</th></tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i}>
                  <td className="tabular-nums">{r.date}</td>
                  <td className="font-medium">{r.deptName || deptName(r.deptId)}</td>
                  <td className="font-mono text-slate-500">{r.deviceCode}</td>
                  <td>{r.deviceName}</td>
                  <td className="text-slate-500">{r.catName}</td>
                  <td className="max-w-[280px] text-red-600">{r.note || '—'}</td>
                  <td>{r.inspectorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
