// 月报导出：选科室 + 月份 → 下载 monthly.xlsx（设备×日期矩阵 + 异常清单 + 三级签名图）
import { useEffect, useState } from 'react'
import { download } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { ErrorTip } from '../components/ui'

export default function ExportPage() {
  const { onDepts, deptName } = useDepts()
  const time = useServerTime()
  const [deptId, setDeptId] = useState('')
  const [month, setMonth] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => { if (time?.month && !month) setMonth(time.month) }, [time]) // eslint-disable-line react-hooks/exhaustive-deps

  async function doExport(e) {
    e.preventDefault()
    setErr(null)
    setDone('')
    if (!deptId) return setErr({ message: '请选择科室' })
    if (!month) return setErr({ message: '请选择月份' })
    setBusy(true)
    try {
      await download(`/export/monthly.xlsx?deptId=${deptId}&month=${month}`, `巡检月报_${deptName(deptId)}_${month}.xlsx`)
      setDone(`已生成 ${deptName(deptId)} ${month} 月报，请查看浏览器下载`)
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <div>
      <h2 className="mb-5 text-lg font-semibold">月报导出</h2>

      <div className="card max-w-lg p-6">
        <p className="mb-5 text-sm text-slate-500">
          导出指定科室的巡检月报（xlsx）：设备 × 日期巡检矩阵（✓/✗/空）、当月异常清单、日 / 周 / 月三级签名图。
        </p>
        <form onSubmit={doExport}>
          <ErrorTip error={err} className="mb-4" />
          {done && <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-600">{done}</div>}
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-slate-600">科室 <span className="text-red-500">*</span></span>
            <select className="inp" value={deptId} onChange={e => setDeptId(e.target.value)} required>
              <option value="" disabled>请选择科室</option>
              {onDepts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
            </select>
          </label>
          <label className="mb-5 block text-sm">
            <span className="mb-1 block text-slate-600">月份 <span className="text-red-500">*</span></span>
            <input type="month" className="inp" value={month} onChange={e => setMonth(e.target.value)} required />
          </label>
          <button className="btn-primary w-full" disabled={busy}>{busy ? '生成中，请稍候…' : '⤓ 生成并下载月报'}</button>
        </form>
      </div>
    </div>
  )
}
