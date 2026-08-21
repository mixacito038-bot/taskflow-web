// 巡检记录：按科室+日期范围查询；详情看勾选明细/异常/签名图；admin 可作废日签
import { useEffect, useState } from 'react'
import { api, getUser } from '../api/client'
import { useDepts, useServerTime } from '../hooks'
import { asList, addDays } from '../utils'
import { Badge, Empty, ErrorTip, Modal, SignCard, Spinner } from '../components/ui'
import VoidSignModal from '../components/VoidSignModal'

function RecordDetail({ rec, deptName, onClose, onVoid }) {
  const isAdmin = getUser()?.role === 'admin'
  const [devices, setDevices] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!rec) return
    setDevices(null)
    api(`/devices?deptId=${rec.deptId}`).then(res => setDevices(asList(res))).catch(setErr)
  }, [rec])

  if (!rec) return null
  const checks = rec.checks || {}
  const notes = rec.notes || {}
  // 记录里出现但台账已删的设备也要能显示
  const knownIds = new Set((devices || []).map(d => String(d.id)))
  const orphanIds = Object.keys(checks).filter(id => !knownIds.has(String(id)))
  const ngCount = Object.values(checks).filter(v => v === 'ng').length

  return (
    <Modal open title={`巡检明细 · ${deptName(rec.deptId)} · ${rec.date}`} onClose={onClose} width="max-w-2xl">
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
        <span>巡检人：<b className="text-slate-700">{rec.inspectorName || '—'}</b></span>
        <span>勾选 {Object.keys(checks).length} 台</span>
        <span>异常 {ngCount > 0 ? <b className="text-red-500">{ngCount}</b> : 0} 台</span>
        {rec.updatedAt && <span>更新于 {rec.updatedAt}</span>}
      </div>
      <ErrorTip error={err} className="mb-3" />

      {!devices ? <Spinner /> : (
        <div className="mb-4 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
          <table className="tbl">
            <thead><tr><th>编码</th><th>设备</th><th>品类</th><th>结果</th><th>备注</th></tr></thead>
            <tbody>
              {devices.map(d => {
                const id = String(d.id)
                const v = checks[id]
                return (
                  <tr key={id}>
                    <td className="font-mono text-slate-500">{d.code}</td>
                    <td>{d.name}</td>
                    <td className="text-slate-500">{d.catName}</td>
                    <td>
                      {v === 'ok' && <Badge color="green">✓ 正常</Badge>}
                      {v === 'ng' && <Badge color="red">✗ 异常</Badge>}
                      {!v && <span className="text-slate-400">未查</span>}
                    </td>
                    <td className="max-w-[200px] text-red-600">{notes[id] || ''}</td>
                  </tr>
                )
              })}
              {orphanIds.map(id => (
                <tr key={id}>
                  <td className="font-mono text-slate-500" colSpan={2}>设备#{id}（已移出台账）</td>
                  <td />
                  <td>{checks[id] === 'ok' ? <Badge color="green">✓ 正常</Badge> : <Badge color="red">✗ 异常</Badge>}</td>
                  <td className="text-red-600">{notes[id] || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SignCard sign={rec.sign} title="巡检签字" />

      {isAdmin && rec.sign && (
        <div className="mt-4 flex justify-end">
          <button className="btn-danger" onClick={() => onVoid({ type: 'day', deptId: rec.deptId, key: rec.date, label: `${deptName(rec.deptId)} ${rec.date}` })}>
            作废该日签字
          </button>
        </div>
      )}
    </Modal>
  )
}

export default function Records() {
  const { onDepts, deptName } = useDepts()
  const time = useServerTime()
  const [deptId, setDeptId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)

  // 默认查最近 7 天（以服务端日期为准）
  useEffect(() => {
    if (time?.date && !to) { setTo(time.date); setFrom(addDays(time.date, -6)) }
  }, [time]) // eslint-disable-line react-hooks/exhaustive-deps

  async function query() {
    setErr(null)
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (deptId) q.set('deptId', deptId)
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      const res = await api(`/records?${q}`)
      setList(asList(res).map(r => ({ ...r, deptId: String(r.deptId) })))
    } catch (e) { setErr(e) } finally { setLoading(false) }
  }
  useEffect(() => { if (from && to) query() }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(r) {
    try {
      setDetail(await api(`/records/${r.deptId}/${r.date}`))
    } catch (e) { setErr(e) }
  }

  const sorted = [...(list || [])].sort((a, b) => b.date.localeCompare(a.date) || a.deptId.localeCompare(b.deptId))

  return (
    <div>
      <h2 className="mb-5 text-lg font-semibold">巡检记录</h2>

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
      </div>
      <ErrorTip error={err} className="mb-4" />

      <div className="card overflow-x-auto">
        {list === null ? <Spinner /> : sorted.length === 0 ? <Empty text="该条件下暂无巡检记录" /> : (
          <table className="tbl">
            <thead>
              <tr><th>日期</th><th>科室</th><th>巡检人</th><th>勾选台数</th><th>异常台数</th><th>签字</th><th className="text-right">操作</th></tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const checks = r.checks || {}
                const ng = Object.values(checks).filter(v => v === 'ng').length
                return (
                  <tr key={`${r.deptId}-${r.date}`}>
                    <td className="tabular-nums">{r.date}</td>
                    <td className="font-medium">{deptName(r.deptId)}</td>
                    <td>{r.inspectorName || '—'}</td>
                    <td className="tabular-nums">{Object.keys(checks).length}</td>
                    <td>{ng > 0 ? <span className="font-medium text-red-500 tabular-nums">{ng}</span> : <span className="text-slate-500">0</span>}</td>
                    <td>{r.sign ? <Badge color="green">已签 · {r.sign.name}</Badge> : <Badge>未签</Badge>}</td>
                    <td className="text-right">
                      <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => openDetail(r)}>查看明细</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <RecordDetail rec={detail} deptName={deptName}
          onClose={() => setDetail(null)}
          onVoid={t => { setDetail(null); setVoidTarget(t) }} />
      )}
      <VoidSignModal target={voidTarget} onClose={() => setVoidTarget(null)} onDone={query} />
    </div>
  )
}
