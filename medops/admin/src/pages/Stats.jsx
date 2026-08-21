// 统计分析：completion（完成率）+ signatures（签字人×日/周/月签次数）；Tailwind div 条形，不用图表库
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { asList, nz } from '../utils'
import { Badge, Bar, Empty, ErrorTip, Spinner } from '../components/ui'

function normCompletion(r) {
  return {
    deptId: String(nz(r.deptId, r.dept_id, '')),
    deptName: nz(r.deptName, r.dept_name),
    dueDays: nz(r.dueDays, r.due_days, r.shouldDays, 0),
    signedDays: nz(r.signedDays, r.signed_days, r.doneDays, 0),
    checked: nz(r.checked, r.checkedCount, r.stat_checked, 0),
    ng: nz(r.ng, r.ngCount, r.stat_ng, 0),
    weekSigned: nz(r.weekSigned, r.weeksSigned, r.week_signed, 0),
    weekTotal: nz(r.weekTotal, r.weeks, r.week_total, 0),
    monthSigned: nz(r.monthSigned, r.month_signed, false)
  }
}

function normSignature(r) {
  return {
    deptId: String(nz(r.deptId, r.dept_id, '')),
    deptName: nz(r.deptName, r.dept_name),
    name: nz(r.name, r.signName, r.sign_name, ''),
    title: nz(r.title, ''),
    day: nz(r.daySigns, r.day, r.days, r.dayCount, 0),
    week: nz(r.weekSigns, r.week, r.weeks, r.weekCount, 0),
    month: nz(r.monthSigns, r.month, r.months, r.monthCount, 0)
  }
}

export default function Stats() {
  const { onDepts, deptName } = useDepts()
  const time = useServerTime()
  const [month, setMonth] = useState('')
  const [deptId, setDeptId] = useState('')
  const [completion, setCompletion] = useState(null)
  const [signatures, setSignatures] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { if (time?.month && !month) setMonth(time.month) }, [time]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!month) return
    setErr(null)
    setCompletion(null)
    setSignatures(null)
    const q = deptId ? `&deptId=${deptId}` : ''
    api(`/stats/completion?month=${month}${q}`)
      .then(res => setCompletion(asList(res).map(normCompletion)))
      .catch(setErr)
    api(`/stats/signatures?month=${month}`)
      .then(res => setSignatures(asList(res).map(normSignature)))
      .catch(setErr)
  }, [month, deptId])

  const shownSigs = (signatures || []).filter(s => !deptId || s.deptId === deptId)
  const maxTotal = Math.max(1, ...shownSigs.map(s => s.day + s.week + s.month))

  return (
    <div>
      <h2 className="mb-5 text-lg font-semibold">统计分析</h2>

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">月份</span>
          <input type="month" className="inp !w-44" value={month} onChange={e => setMonth(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">科室</span>
          <select className="inp !w-44" value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">全部科室</option>
            {onDepts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
        </label>
      </div>
      <ErrorTip error={err} className="mb-4" />

      <div className="card mb-5 p-5">
        <h3 className="mb-4 font-medium text-slate-700">巡检完成率 <span className="text-sm font-normal text-slate-500">（应巡天数 / 已日签天数 / 台次 / 周签 / 月签）</span></h3>
        {!completion ? <Spinner /> : completion.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>科室</th><th className="min-w-[220px]">日签进度</th><th>巡检台次</th><th>异常台次</th><th className="min-w-[180px]">周签进度</th><th>月签</th></tr>
              </thead>
              <tbody>
                {completion.map(r => (
                  <tr key={r.deptId}>
                    <td className="font-medium">{r.deptName || deptName(r.deptId)}</td>
                    <td><Bar value={r.signedDays} total={r.dueDays} /></td>
                    <td className="tabular-nums">{r.checked}</td>
                    <td>{r.ng > 0 ? <span className="font-medium text-red-500 tabular-nums">{r.ng}</span> : <span className="text-slate-500">0</span>}</td>
                    <td><Bar value={r.weekSigned} total={r.weekTotal} color="bg-amber-400" /></td>
                    <td>{r.monthSigned ? <Badge color="green">已签</Badge> : <Badge>未签</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h3 className="mb-4 font-medium text-slate-700">签字人工作量 <span className="text-sm font-normal text-slate-500">（{month || '—'} 各签字人 × 日 / 周 / 月签次数）</span></h3>
        {!signatures ? <Spinner /> : shownSigs.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>科室</th><th>签字人</th><th className="min-w-[240px]">签字分布</th><th>日签</th><th>周签</th><th>月签</th><th>合计</th></tr>
              </thead>
              <tbody>
                {shownSigs.map((s, i) => {
                  const total = s.day + s.week + s.month
                  return (
                    <tr key={i}>
                      <td>{s.deptName || deptName(s.deptId)}</td>
                      <td className="font-medium">{s.name}{s.title && <span className="ml-1.5 text-xs text-slate-500">{s.title}</span>}</td>
                      <td>
                        {/* 堆叠条：蓝=日签 琥珀=周签 绿=月签 */}
                        <div className="flex h-3 w-full max-w-[240px] overflow-hidden rounded-full bg-slate-100">
                          <div className="bg-primary" style={{ width: `${(s.day / maxTotal) * 100}%` }} />
                          <div className="bg-amber-400" style={{ width: `${(s.week / maxTotal) * 100}%` }} />
                          <div className="bg-emerald-400" style={{ width: `${(s.month / maxTotal) * 100}%` }} />
                        </div>
                      </td>
                      <td className="tabular-nums text-primary">{s.day}</td>
                      <td className="tabular-nums text-amber-700">{s.week}</td>
                      <td className="tabular-nums text-emerald-700">{s.month}</td>
                      <td className="font-medium tabular-nums">{total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
