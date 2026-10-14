// 异常清单：GET /stats/ng + 导出 /export/ng.xlsx
import { useEffect, useState } from 'react'
import { api, download } from '../api/client'
import { useDepts, useServerTime, deptOptLabel } from '../hooks'
import { asList, addDays, nz, devStatusText } from '../utils'
import { Badge, Empty, ErrorTip, Spinner } from '../components/ui'

function normNg(r) {
  return {
    date: r.date,
    deptId: String(nz(r.deptId, r.dept_id, '')),
    deptName: nz(r.deptName, r.dept_name),
    deviceCode: nz(r.deviceCode, r.device_code, ''),
    deviceName: nz(r.deviceName, r.device_name, ''),
    catName: nz(r.catName, r.cat_name, ''),
    note: nz(r.note, ''),
    inspectorName: nz(r.inspectorName, r.inspector_name, ''),
    signed: !!r.signed,
    signVoided: !!r.signVoided,
    deviceStatus: nz(r.deviceStatus, 'in_use')
  }
}

/* 当天的日签状态。作废日签只撤销签字、不删巡检结果，所以异常还在清单里——标出来，免得以为没作废成功 */
function SignBadge({ r }) {
  if (r.signed) return <Badge color="green">已日签</Badge>
  if (r.signVoided) return <span title="日签已被作废：巡检员核对、改正结果后重新签字，这里随之更新"><Badge color="amber">签字已作废，待重签</Badge></span>
  return <span title="巡检员已记录结果，还没日签"><Badge>未日签</Badge></span>
}

export default function Ng() {
  const { filterDepts, deptLabel: deptName, error: deptErr } = useDepts()
  const time = useServerTime()
  const [deptId, setDeptId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sign, setSign] = useState('')   // '' 全部 / signed 已日签 / unsigned 未日签（含作废待重签）
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
      if (sign) q.set('sign', sign)
      const res = await api(`/stats/ng?${q}`)
      setList(asList(res).map(normNg))
    } catch (e) { setErr(e) } finally { setLoading(false) }
  }
  useEffect(() => { if (from && to) query() }, [deptId, from, to, sign]) // eslint-disable-line react-hooks/exhaustive-deps

  /* 导出与页面同一套筛选条件（以前漏了科室：页面筛出 3 条，导出却是全院） */
  function doExport() {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (deptId) q.set('deptId', deptId)
    if (sign) q.set('sign', sign)
    download(`/export/ng.xlsx?${q}`, `异常清单_${deptId ? deptName(deptId) + '_' : ''}${from}_${to}.xlsx`).catch(setErr)
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
            {filterDepts.map(d => <option key={d.id} value={String(d.id)}>{deptOptLabel(d)}</option>)}
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
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">当日签字</span>
          <select className="inp !w-48" value={sign} onChange={e => setSign(e.target.value)}>
            <option value="">全部</option>
            <option value="signed">只看已日签的</option>
            <option value="unsigned">只看未日签的（含签字已作废）</option>
          </select>
        </label>
        <button className="btn-primary" onClick={query} disabled={loading}>{loading ? '查询中…' : '查 询'}</button>
        {list && <span className="pb-2 text-sm text-slate-500">共 {list.length} 条异常</span>}
      </div>
      <ErrorTip error={err || deptErr} className="mb-4" />
      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        这里列出巡检员记下的全部「异常」。作废日签只撤销签字、不删除巡检结果：巡检员核对后把结果改正、重新签字，这里随之更新。
        设备停用或报废后，它以前的异常作为历史保留，设备名后面会注明现在的状态。
      </p>

      <div className="card overflow-x-auto">
        {list === null ? (err ? <Empty text="加载失败" /> : <Spinner />) : list.length === 0 ? <Empty text="该时段无异常记录" /> : (
          <table className="tbl">
            <thead>
              <tr><th>日期</th><th>科室</th><th>设备编码</th><th>设备名称</th><th>品类</th><th>异常描述</th><th>巡检人</th><th>当日签字</th></tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i}>
                  <td className="tabular-nums">{r.date}</td>
                  <td className="font-medium">{r.deptName || deptName(r.deptId)}</td>
                  <td className="font-mono text-slate-500">{r.deviceCode}</td>
                  <td>{r.deviceName}
                    {r.deviceStatus !== 'in_use' && <span className="ml-1 whitespace-nowrap text-xs text-slate-500">（现{devStatusText(r.deviceStatus)}）</span>}
                  </td>
                  <td className="text-slate-500">{r.catName}</td>
                  <td className="max-w-[280px] text-red-600">{r.note || '—'}</td>
                  <td>{r.inspectorName}</td>
                  <td className="whitespace-nowrap"><SignBadge r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
