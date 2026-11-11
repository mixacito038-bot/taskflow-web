// 通用分页：共 N 条 · 每页 10/20/50/100/全部 · 上一页 / 页码 / 下一页 / 跳到第几页
// 每个列表记住自己选的「每页条数」（存在本机浏览器里，下次打开还是这个）
import { useEffect, useMemo, useState } from 'react'

export const PAGE_SIZES = [10, 20, 50, 100, 0] // 0 = 全部
const sizeText = n => (n === 0 ? '全部' : `${n} 条/页`)

function readSize(key, def) {
  try {
    const raw = localStorage.getItem('pager:' + key)
    if (raw == null || raw === '') return def   // 没选过：Number(null) 是 0，会被当成「全部」
    const v = Number(raw)
    return PAGE_SIZES.includes(v) ? v : def
  } catch { return def }
}
function saveSize(key, v) { try { localStorage.setItem('pager:' + key, String(v)) } catch { /* 隐私模式等存不了也没关系 */ } }

/* 页码按钮：首页、末页、当前页前后各 2 页，中间用 … 省略 */
function pageList(cur, last) {
  const out = []
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || Math.abs(p - cur) <= 2) out.push(p)
    else if (out[out.length - 1] !== '…') out.push('…')
  }
  return out
}

export function Pager({ total, page, size, onPage, onSize, className = '' }) {
  const last = size ? Math.max(1, Math.ceil(total / size)) : 1
  const [jump, setJump] = useState('')
  const go = p => { const n = Math.min(Math.max(1, p), last); if (n !== page) onPage(n) }
  const from = total === 0 ? 0 : size ? (page - 1) * size + 1 : 1
  const to = size ? Math.min(total, page * size) : total
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-slate-600 ${className}`}>
      <div className="tabular-nums">
        共 <b className="text-slate-800">{total}</b> 条{total > 0 && <span className="text-slate-500">，当前第 {from}–{to} 条</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="inp !w-auto !py-1 !text-xs" value={size} aria-label="每页条数"
          onChange={e => onSize(Number(e.target.value))}>
          {PAGE_SIZES.map(n => <option key={n} value={n}>{sizeText(n)}</option>)}
        </select>
        {size > 0 && last > 1 && (<>
          <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={page <= 1} onClick={() => go(page - 1)}>上一页</button>
          {pageList(page, last).map((p, i) => p === '…'
            ? <span key={'e' + i} className="px-1 text-slate-400">…</span>
            : <button key={p} onClick={() => go(p)} aria-current={p === page ? 'page' : undefined}
                className={`min-w-[2rem] rounded-lg px-2 py-1 text-xs tabular-nums ${p === page ? 'bg-primary text-white' : 'border border-slate-300 bg-white hover:bg-slate-50'}`}>{p}</button>)}
          <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={page >= last} onClick={() => go(page + 1)}>下一页</button>
          <form className="flex items-center gap-1 text-xs" onSubmit={e => { e.preventDefault(); if (jump) go(Number(jump)); setJump('') }}>
            <span>跳到</span>
            <input className="inp !w-14 !px-2 !py-1 !text-xs tabular-nums" inputMode="numeric" value={jump}
              onChange={e => setJump(e.target.value.replace(/\D/g, ''))} aria-label="跳到第几页" />
            <span>页</span>
          </form>
        </>)}
      </div>
    </div>
  )
}

/* 前端分页：传入整张列表，拿回这一页的数据和分页条。
   key：用来记住每页条数；resetOn：筛选条件变了就回到第 1 页 */
export function usePaged(list, key, { defaultSize = 20, resetOn = [] } = {}) {
  const [size, setSizeState] = useState(() => readSize(key, defaultSize))
  const [page, setPage] = useState(1)
  const total = list ? list.length : 0
  const last = size ? Math.max(1, Math.ceil(total / size)) : 1
  useEffect(() => { setPage(1) }, resetOn) // eslint-disable-line react-hooks/exhaustive-deps
  // 删掉几条以后当前页可能超出范围：退回最后一页
  useEffect(() => { if (page > last) setPage(last) }, [page, last])
  const items = useMemo(() => (!list ? list : size ? list.slice((page - 1) * size, page * size) : list), [list, page, size])
  const setSize = v => { setSizeState(v); saveSize(key, v); setPage(1) }
  const pager = <Pager total={total} page={Math.min(page, last)} size={size} onPage={setPage} onSize={setSize} />
  return { items, pager, page, size, setPage }
}

/* 后端分页（操作日志这种可能很多的）：只管页码和每页条数，数据由调用方按 page/size 去取 */
export function usePageState(key, defaultSize = 20) {
  const [size, setSizeState] = useState(() => readSize(key, defaultSize))
  const [page, setPage] = useState(1)
  const setSize = v => { setSizeState(v); saveSize(key, v); setPage(1) }
  return { page, size, setPage, setSize }
}
