// 操作日志：谁、什么时候、在哪台设备上、对什么、做了什么、改前改后。只能看和导出，不能改、不能删
import { useEffect, useState } from 'react'
import { api, download } from '../api/client'
import { addDays, ROLE_TEXT, ymd } from '../utils'
import { Badge, Empty, ErrorTip, Modal, Spinner } from '../components/ui'
import { Pager, usePageState } from '../components/Pager'

/* 库里存 UTC，页面一律显示上海时间 */
function shTime(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600e3)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}
const MOD_COLOR = { 账号: 'blue', 科室: 'slate', 设备: 'slate', 签字人: 'slate', 签字: 'green', 登录: 'slate', 导入: 'amber', 导出: 'slate', 系统: 'red' }
const DANGER = /删除|作废|停用|清空|重置密码|还原/

function who(x) {
  // 登录失败时还没登录上：被试的那个账号是「对象」，不是操作人
  if (x.op === '登录失败') return <span className="text-slate-400">（未登录）</span>
  if (!x.username && !x.userName) return <span className="text-slate-400">（系统 / 服务器命令）</span>
  return (
    <span>
      <span className="font-medium text-slate-800">{x.userName || x.username}</span>
      {x.username && x.userName && x.userName !== x.username && <span className="ml-1 font-mono text-xs text-slate-500">{x.username}</span>}
    </span>
  )
}

function Detail({ item, onClose }) {
  if (!item) return null
  const rows = [
    ['时间', shTime(item.createdAt)],
    ['操作人', item.op === '登录失败' ? '（未登录：有人用对象里的账号尝试登录）' : item.username || item.userName ? `${item.userName || ''}${item.username ? `（账号 ${item.username}）` : ''}${item.userRole ? ' · ' + (ROLE_TEXT[item.userRole] || item.userRole) : ''}` : '系统 / 服务器命令'],
    ['操作', `${item.module} · ${item.op}`],
    ['对象', item.target || '—'],
    ['结果', item.result === 'fail' ? '失败 / 被拒绝' : '成功'],
    ['说明', item.summary || '—'],
    ['IP', item.ip || '—'],
    ['设备号', item.device || '—'],
    ['浏览器 / 手机', item.ua || '—'],
  ]
  return (
    <Modal open title="操作日志详情" onClose={onClose} width="max-w-2xl">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-slate-100 last:border-0">
              <td className="w-28 py-2 pr-3 align-top text-slate-500">{k}</td>
              <td className="break-all py-2 text-slate-800">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {item.changes.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-sm font-medium text-slate-700">改了哪些地方</div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
            <table className="tbl">
              <thead><tr><th className="w-32">字段</th><th>改前</th><th>改后</th></tr></thead>
              <tbody>
                {item.changes.map((c, i) => (
                  <tr key={i}>
                    <td className="font-medium">{c.f}</td>
                    <td className="break-all text-slate-500">{c.from || '—'}</td>
                    <td className="break-all text-slate-800">{c.to || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {item.detail && item.detail !== item.summary && (
        <details className="mt-4 text-xs text-slate-500">
          <summary className="cursor-pointer select-none">原始信息（给技术人员看）</summary>
          <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2.5 font-mono">{item.detail}</pre>
        </details>
      )}
    </Modal>
  )
}

export default function OpLog() {
  const today = ymd(new Date())
  const empty = { from: addDays(today, -29), to: today, module: '', op: '', userId: '', result: '', q: '' }
  const [form, setForm] = useState(empty)   // 正在填的筛选条件
  const [query, setQuery] = useState(empty) // 已生效的筛选条件
  const [meta, setMeta] = useState({ modules: [], ops: [], users: [] })
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(null)
  const { page, size, setPage, setSize } = usePageState('oplog', 20)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v, ...(k === 'module' ? { op: '' } : {}) }))

  useEffect(() => { api('/admin/oplog/meta').then(setMeta).catch(setErr) }, [])

  const qs = (q, extra = {}) => new URLSearchParams(Object.entries({ ...q, ...extra }).filter(([, v]) => v !== '' && v != null)).toString()

  useEffect(() => {
    let alive = true
    setBusy(true)
    api('/admin/oplog?' + qs(query, { page, size }))
      .then(res => { if (alive) { setData(res); setErr(null) } })
      .catch(e => { if (alive) setErr(e) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [query, page, size]) // eslint-disable-line react-hooks/exhaustive-deps

  function search(e) {
    e && e.preventDefault()
    if (form.from && form.to && form.from > form.to) return setErr({ message: '起始日期不能晚于截止日期' })
    setPage(1)
    setQuery({ ...form })
  }
  function reset() { setForm(empty); setPage(1); setQuery(empty) }
  const ops = meta.ops.filter(o => !form.module || o.module === form.module)
  const total = data?.total ?? 0

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">操作日志</h2>
          <p className="mt-0.5 text-xs text-slate-500">后台和手机上的新增、修改、删除、作废、签字、导入导出、登录都记在这里；只能查看和导出，不能修改或删除。</p>
        </div>
        <button className="btn-ghost" onClick={() => download('/admin/oplog/export.xlsx?' + qs(query), '操作日志.xlsx').catch(setErr)}>导出 Excel</button>
      </div>

      <form onSubmit={search} className="card mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-8">
        <label className="block text-xs text-slate-500">起始日期
          <input type="date" className="inp mt-1" value={form.from} onChange={e => set('from', e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">截止日期
          <input type="date" className="inp mt-1" value={form.to} onChange={e => set('to', e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">模块
          <select className="inp mt-1" value={form.module} onChange={e => set('module', e.target.value)}>
            <option value="">全部</option>
            {meta.modules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-500">操作
          <select className="inp mt-1" value={form.op} onChange={e => set('op', e.target.value)}>
            <option value="">全部</option>
            {[...new Set(ops.map(o => o.op))].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-500">操作人
          <select className="inp mt-1" value={form.userId} onChange={e => set('userId', e.target.value)}>
            <option value="">全部</option>
            {meta.users.map(u => <option key={u.id} value={u.id}>{u.name || u.username}{u.username && u.name !== u.username ? `（${u.username}）` : ''}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-500">结果
          <select className="inp mt-1" value={form.result} onChange={e => set('result', e.target.value)}>
            <option value="">全部</option>
            <option value="ok">成功</option>
            <option value="fail">失败 / 被拒绝</option>
          </select>
        </label>
        <label className="col-span-2 block text-xs text-slate-500">关键词
          <input className="inp mt-1" placeholder="账号、科室、设备编码、姓名、IP…" value={form.q} onChange={e => set('q', e.target.value)} />
        </label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-8">
          <button className="btn-primary">查询</button>
          <button type="button" className="btn-ghost" onClick={reset}>重置</button>
          {busy && data && <span className="text-xs text-slate-500">正在加载…</span>}
        </div>
      </form>

      <ErrorTip error={err} className="mb-4" />
      {data?.capped && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          符合条件的有 {total} 条，「全部」最多显示最近的 {data.items.length} 条；请缩小时间范围，或换成按页查看。
        </div>
      )}

      <div className="card overflow-x-auto">
        {!data ? <Spinner /> : data.items.length === 0 ? <Empty text="这段时间没有符合条件的操作" /> : (
          <table className="tbl">
            <thead>
              <tr><th className="w-40">时间</th><th>操作人</th><th className="w-20">模块</th><th>操作</th><th>对象</th><th>说明</th><th className="w-16 whitespace-nowrap">结果</th><th className="w-16 text-right"></th></tr>
            </thead>
            <tbody>
              {data.items.map(x => (
                <tr key={x.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetail(x)}>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{shTime(x.createdAt)}</td>
                  <td className="whitespace-nowrap">{who(x)}</td>
                  <td><Badge color={MOD_COLOR[x.module] || 'slate'}>{x.module}</Badge></td>
                  <td className={`whitespace-nowrap font-medium ${DANGER.test(x.op) ? 'text-red-600' : ''}`}>{x.op}</td>
                  <td className="max-w-[240px] truncate" title={x.target}>{x.target || '—'}</td>
                  <td className="max-w-[360px] truncate text-slate-600" title={x.summary}>
                    {x.summary || '—'}
                    {x.changes.length > 0 && <span className="ml-1 text-xs text-primary">（{x.changes.length} 处改动）</span>}
                  </td>
                  <td className="whitespace-nowrap">{x.result === 'fail' ? <Badge color="red">失败</Badge> : <span className="text-xs text-emerald-600">成功</span>}</td>
                  <td className="text-right"><button className="text-xs text-primary hover:underline" onClick={e => { e.stopPropagation(); setDetail(x) }}>详情</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <Pager total={total} page={data.page || page} size={size} onPage={setPage} onSize={setSize} className="border-t border-slate-100" />}
      </div>

      <Detail item={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
