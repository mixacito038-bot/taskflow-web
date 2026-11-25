// 未签提醒总览：GET /stats/unsigned 三组列表 + 本月完成率概览 GET /stats/completion
import { useEffect, useState } from 'react'
import { api, getUser } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { asList, nz } from '../utils'
import { Bar, Empty, ErrorTip, Spinner, Badge, Modal, Field } from '../components/ui'
import { usePaged } from '../components/Pager'
import { Link } from 'react-router-dom'
import ServerClock from '../components/ServerClock'

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
    monthSigned: nz(r.monthSigned, r.month_signed, false),
    off: r.deptStatus === 'off'
  }
}

/* 某天所在周的周一（YYYY-MM-DD，按日期本身算，不受浏览器时区影响） */
function mondayOf(s) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/* 巡检起算日：设备早就录进系统、真正开始巡检是后来某个周一时，设成那天——以前的不再提醒、不算缺签 */
function StartSetting({ value, today, canEdit, onSaved }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const thisMonday = today ? mondayOf(today) : ''
  function show() { setDate(value || thisMonday); setErr(null); setOpen(true) }
  async function save(v) {
    setErr(null)
    if (v && mondayOf(v) !== v) return setErr({ message: `要选周一（周签按周一到周日算）：${v} 所在周的周一是 ${mondayOf(v)}` })
    setBusy(true)
    try {
      await api('/admin/settings/inspect-start', { method: 'PUT', body: { date: v } })
      setOpen(false)
      onSaved()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return (
    <>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-slate-600">巡检起算日：</span>
        {value
          ? <span><b className="tabular-nums text-slate-800">{value}</b><span className="text-slate-600"> 起（这天以前的不提醒、不算缺签）</span></span>
          : <span className="text-slate-600">未设置（按各科室建立日算）</span>}
        {canEdit && <button type="button" className="text-primary hover:underline" onClick={show}>{value ? '修改' : '设置'}</button>}
      </p>
      <Modal open={open} title="巡检起算日" onClose={() => setOpen(false)}>
        <p className="mb-3 text-sm leading-6 text-slate-600">
          设备早就录进系统、从某个周一才真正开始巡检时，把那天设为起算日：<br />
          · 这天以前的日子、周、月<b>不再提醒、不算缺签</b>（后台和手机端都是）；<br />
          · 这个月的月签只要求起算日所在周及以后的周签；<br />
          · 以前已经签了的照常保留；以前的日子仍然可以补签。
        </p>
        <Field label="起算日（周一）" required hint={thisMonday ? `本周一是 ${thisMonday}` : ''}>
          <input type="date" className="inp" value={date} max={thisMonday || undefined} onChange={e => setDate(e.target.value)} />
        </Field>
        <ErrorTip error={err} className="mb-3" />
        <div className="flex flex-wrap justify-end gap-2">
          {value && <button type="button" className="btn-ghost mr-auto" disabled={busy} onClick={() => save('')}>清除（不限）</button>}
          <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>取消</button>
          <button type="button" className="btn-primary" disabled={busy || !date} onClick={() => save(date)}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </Modal>
    </>
  )
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
  const [expiryErr, setExpiryErr] = useState(null)
  const [completion, setCompletion] = useState(null)
  const [err, setErr] = useState(null)
  const [start, setStart] = useState(undefined)   // 巡检起算日；undefined = 还在加载
  const [reload, setReload] = useState(0)
  const canEdit = ['equip', 'admin'].includes(getUser()?.role)

  useEffect(() => {
    api('/admin/settings').then(r => setStart(r.inspectStart || null)).catch(() => setStart(null))
    api('/stats/unsigned').then(setUnsigned).catch(setErr)
    /* 单独记失败原因：这是安全类提醒，加载失败时界面必须和"全院都在有效期内"区分开，
       否则设备科看到一片干净就以为没事了 */
    api('/stats/expiry').then(res => setExpiry(asList(res)))
      .catch(e => setExpiryErr(e?.message || '加载失败'))
  }, [reload])
  useEffect(() => {
    if (!time?.month) return
    api(`/stats/completion?month=${time.month}`)
      .then(res => setCompletion(asList(res).map(normRow)))
      .catch(setErr)
  }, [time?.month, reload])

  const days = unsigned?.days || []
  const weeks = unsigned?.weeks || []
  const months = unsigned?.months || []

  const { items: expRows, pager: expPager } = usePaged(expiry, 'dash-expiry', { defaultSize: 10 })
  const { items: compRows, pager: compPager } = usePaged(completion, 'dash-completion', { defaultSize: 20 })
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">未签提醒</h2>
          <p className="mt-0.5 text-sm text-slate-600">日签缺失（近 7 天）· 周签缺失（上周及更早）· 月签缺失（最后一周已结束、还没月签的月份）</p>
          {start !== undefined && <StartSetting value={start} today={time?.date} canEdit={canEdit} onSaved={() => { setUnsigned(null); setReload(n => n + 1) }} />}
        </div>
        <ServerClock className="text-sm text-slate-600" />
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

      {expiryErr && (
        <section className="card mb-5 border-red-200 bg-red-50">
          <h2 className="text-sm font-semibold text-red-800">有效期提醒加载失败</h2>
          <p className="mt-1 text-sm text-red-700">
            {expiryErr}。<b>这不代表没有设备过期</b>，请刷新页面；仍失败请检查后端服务。
          </p>
        </section>
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
                {(expRows || []).map(x => (
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
          {expPager}
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
                {(compRows || []).map(r => (
                  <tr key={r.deptId}>
                    <td className="font-medium">{r.deptName || deptName(r.deptId)}{r.off && <span className="ml-1 text-xs text-slate-500">（已停用）</span>}</td>
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
        {completion && completion.length > 0 && compPager}
      </div>
    </div>
  )
}
