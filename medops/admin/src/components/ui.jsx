// 轻量 UI 件（无组件库）：Modal / Badge / Empty / Spinner / Bar / SignCard
import { useEffect } from 'react'

export function Spinner({ text = '加载中…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-sm">
      <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      {text}
    </div>
  )
}

export function Empty({ text = '暂无数据' }) {
  return <div className="py-10 text-center text-sm text-slate-500">{text}</div>
}

export function ErrorTip({ error, className = '' }) {
  if (!error) return null
  return (
    <div className={`rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600 ${className}`}>
      {error.message || String(error)}
    </div>
  )
}

export function Badge({ color = 'slate', children }) {
  const map = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-primary-light text-primary',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700'
  }
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[color] || map.slate}`}>{children}</span>
}

export function Modal({ open, title, onClose, children, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return
    const fn = e => { if (e.key === 'Escape') onClose && onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose && onClose() }}>
      <div className={`card w-full ${width} shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="text-slate-500 hover:text-slate-600 text-xl leading-none" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, required, children, hint }) {
  return (
    <label className="block mb-3">
      <span className="mb-1 block text-sm text-slate-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

/** 纯 Tailwind 条形（统计用，不引图表库） */
export function Bar({ value, total, color = 'bg-primary', showText = true }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 min-w-[60px] rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {showText && <span className="w-20 shrink-0 text-xs text-slate-500 tabular-nums">{value}/{total} ({pct}%)</span>}
    </div>
  )
}

/** 签名展示：签名图 <img src=/api/files/...> 依赖 sid cookie 鉴权 */
export function SignCard({ sign, title = '签名' }) {
  if (!sign) return <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">未签字</div>
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-slate-700">{title}：{sign.name}</span>
        {sign.title && <span className="text-slate-500">{sign.title}</span>}
        {sign.at && <span className="text-xs text-slate-500">{sign.at}</span>}
      </div>
      {sign.opinion && <div className="mb-2 text-sm text-slate-600">意见：{sign.opinion}</div>}
      {sign.url && (
        <img src={sign.url} alt={`${sign.name} 签名`} className="max-h-24 rounded bg-white border border-slate-200 p-1" />
      )}
    </div>
  )
}
