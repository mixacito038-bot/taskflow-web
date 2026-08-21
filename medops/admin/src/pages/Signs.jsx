// 周签 / 月签查看：签名图 + stat；admin 可作废（需填 reason）
import { useEffect, useState } from 'react'
import { api, getUser } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { asList, addDays } from '../utils'
import { Empty, ErrorTip, SignCard, Spinner } from '../components/ui'
import VoidSignModal from '../components/VoidSignModal'

function StatChips({ stat, unit }) {
  if (!stat) return null
  return (
    <div className="flex gap-2 text-xs">
      <span className="rounded-full bg-primary-light px-2 py-0.5 text-primary-hover">巡检 {stat.checked ?? 0} 台次</span>
      <span className={`rounded-full px-2 py-0.5 ${stat.ng > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>异常 {stat.ng ?? 0}</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{unit === 'week' ? `覆盖 ${stat.days ?? 0} 天` : `覆盖 ${stat.weeks ?? 0} 周`}</span>
    </div>
  )
}

function SignItem({ title, stat, unit, sign, at, canVoid, onVoid }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-slate-700">{title}</span>
          <StatChips stat={stat} unit={unit} />
        </div>
        {canVoid && <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={onVoid}>作废</button>}
      </div>
      <SignCard sign={sign} title={unit === 'week' ? '护士长签字' : '设备科签字'} />
      {at && <div className="mt-2 text-xs text-slate-500">提交于 {at}</div>}
    </div>
  )
}

export default function Signs() {
  const isAdmin = getUser()?.role === 'admin'
  const { onDepts, deptName } = useDepts()
  const time = useServerTime()
  const [tab, setTab] = useState('week')
  const [deptId, setDeptId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [year, setYear] = useState('')
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [voidTarget, setVoidTarget] = useState(null)

  // 默认：周签查最近 8 周；月签查当年
  useEffect(() => {
    if (!time) return
    if (!to && time.week) { setTo(time.week); setFrom(addDays(time.week, -7 * 7)) }
    if (!year && time.month) setYear(time.month.slice(0, 4))
  }, [time]) // eslint-disable-line react-hooks/exhaustive-deps

  async function query() {
    setErr(null)
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (deptId) q.set('deptId', deptId)
      let res
      if (tab === 'week') {
        if (from) q.set('from', from)
        if (to) q.set('to', to)
        res = await api(`/weeksigns?${q}`)
      } else {
        if (year) q.set('year', year)
        res = await api(`/monthsigns?${q}`)
      }
      setList(asList(res).map(s => ({ ...s, deptId: String(s.deptId) })))
    } catch (e) { setErr(e); setList([]) } finally { setLoading(false) }
  }
  useEffect(() => {
    if (tab === 'week' ? (from && to) : year) query()
  }, [tab, from, to, year]) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = [...(list || [])].sort((a, b) => String(b.week || b.month).localeCompare(String(a.week || a.month)))

  return (
    <div>
      <h2 className="mb-5 text-lg font-semibold">周签 / 月签</h2>

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {[['week', '周签'], ['month', '月签']].map(([v, t]) => (
          <button key={v} onClick={() => { setTab(v); setList(null) }}
            className={`rounded-md px-5 py-1.5 text-sm transition ${tab === v ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">科室</span>
          <select className="inp !w-44" value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">全部科室</option>
            {onDepts.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
        </label>
        {tab === 'week' ? (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">周一（起）</span>
              <input type="date" className="inp !w-40" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">周一（止）</span>
              <input type="date" className="inp !w-40" value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">年份</span>
            <input type="number" className="inp !w-28" value={year} onChange={e => setYear(e.target.value)} min="2020" max="2099" />
          </label>
        )}
        <button className="btn-primary" onClick={query} disabled={loading}>{loading ? '查询中…' : '查 询'}</button>
      </div>
      <ErrorTip error={err} className="mb-4" />

      {list === null ? <Spinner /> : sorted.length === 0 ? (
        <div className="card"><Empty text={`该条件下暂无${tab === 'week' ? '周签' : '月签'}记录`} /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map(s => tab === 'week' ? (
            <SignItem key={s.id} unit="week"
              title={`${deptName(s.deptId)} · ${s.week} 起的一周`}
              stat={s.stat} sign={s.sign} at={s.at}
              canVoid={isAdmin}
              onVoid={() => setVoidTarget({ type: 'week', deptId: s.deptId, key: s.week, label: `${deptName(s.deptId)} ${s.week} 周` })} />
          ) : (
            <SignItem key={s.id} unit="month"
              title={`${deptName(s.deptId)} · ${s.month}`}
              stat={s.stat} sign={s.sign} at={s.at}
              canVoid={isAdmin}
              onVoid={() => setVoidTarget({ type: 'month', deptId: s.deptId, key: s.month, label: `${deptName(s.deptId)} ${s.month} 月` })} />
          ))}
        </div>
      )}

      <VoidSignModal target={voidTarget} onClose={() => setVoidTarget(null)} onDone={query} />
    </div>
  )
}
