// 未签提醒总览：GET /stats/unsigned 三组列表 + 本月完成率概览 GET /stats/completion
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { asList, nz } from '../utils'
import { Bar, Empty, ErrorTip, Spinner, Badge } from '../components/ui'
import { Link } from 'react-router-dom'

// 容忍字段命名差异（契约未定 completion 具体字段名）
function normRow(r) {
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

function UnsignedCard({ title, color, items, render }) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-slate-700">{title}</h3>
        <Badge color={items.length ? color : 'green'}>{items.length ? `${items.length} 项` : '全部已签'}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="py-4 text-center text-sm text-slate-600">✓ 无待办</div>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
          {items.map((it, i) => <li key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">{render(it)}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { deptName } = useDepts()
  const time = useServerTime()
  const [unsigned, setUnsigned] = useState(null)
  const [expiry, setExpiry] = useState(null)
  const [completion, setCompletion] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    api('/stats/unsigned').then(setUnsigned).catch(setErr)
    api('/stats/expiry').then(res => setExpiry(asList(res))).catch(() => setExpiry([]))
  }, [])
  useEffect(() => {
    if (!time?.month) return
    api(`/stats/completion?month=${time.month}`)
      .then(res => setCompletion(asList(res).map(normRow)))
      .catch(setErr)
  }, [time?.month])

  const days = unsigned?.days || []
  const weeks = unsigned?.weeks || []
  const months = unsigned?.months || []

  return (
    <div>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">未签提醒</h2>
          <p className="mt-0.5 text-sm text-slate-500">日签缺失（近 7 天）· 周签缺失（上周及更早）· 月签缺失（上月）</p>
        </div>
        {time && <span className="text-sm text-slate-500">服务器时间 {time.now}</span>}
      </div>

      <ErrorTip error={err} className="mb-4" />
      {!unsigned ? (err ? null : <Spinner />) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <UnsignedCard title="日签缺失" color="red" items={days}
            render={it => (<><span className="font-medium text-slate-700">{deptName(it.deptId)}</span><span className="text-slate-500">{it.date}</span></>)} />
          <UnsignedCard title="周签缺失" color="amber" items={weeks}
            render={it => (<><span className="font-medium text-slate-700">{deptName(it.deptId)}</span><span className="text-slate-500">{it.week} 起的一周</span></>)} />
          <UnsignedCard title="月签缺失" color="amber" items={months}
            render={it => (<><span className="font-medium text-slate-700">{deptName(it.deptId)}</span><span className="text-slate-500">{it.month}</span></>)} />
        </div>
      )}

      {expiry && expiry.length > 0 && (
        <div className="card mt-5 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium text-slate-700">有效期提醒</h3>
              <p className="mt-0.5 text-sm text-slate-600">除颤电极片、急救药品等已过期或即将到期的设备</p>
            </div>
            <div className="flex items-center gap-2">
              {expiry.filter(x => x.level === 'expired').length > 0 &&
                <Badge color="red">已过期 {expiry.filter(x => x.level === 'expired').length}</Badge>}
              {expiry.filter(x => x.level === 'soon').length > 0 &&
                <Badge color="amber">即将到期 {expiry.filter(x => x.level === 'soon').length}</Badge>}
              <Link to="/devices" className="text-sm text-primary hover:underline">去处理</Link>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>科室</th><th>设备编码</th><th>设备名称</th><th>说明</th><th>到期日</th><th>状态</th></tr>
              </thead>
              <tbody>
                {expiry.map(x => (
                  <tr key={x.deviceId}>
                    <td className="font-medium">{x.deptName || deptName(x.deptId)}</td>
                    <td className="font-mono text-slate-600">{x.code}</td>
                    <td>{x.name}</td>
                    <td className="text-slate-600">{x.expiryNote || x.catName}</td>
                    <td className="tabular-nums text-slate-600">{x.expiryDate}</td>
                    <td>{x.level === 'expired'
                      ? <Badge color="red">已过期 {-x.days} 天</Badge>
                      : <Badge color="amber">{x.days === 0 ? '今天到期' : `还剩 ${x.days} 天`}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mt-5 p-5">
        <h3 className="mb-4 font-medium text-slate-700">本月完成率概览 {time?.month && <span className="text-sm font-normal text-slate-500">（{time.month}）</span>}</h3>
        {!completion ? (err ? <Empty text="加载失败" /> : <Spinner />) : completion.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>科室</th><th className="min-w-[220px]">日签进度</th><th>巡检台次</th><th>异常台次</th><th className="min-w-[180px]">周签进度</th><th>月签</th>
                </tr>
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
    </div>
  )
}
