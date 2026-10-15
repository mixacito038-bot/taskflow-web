// 通用 Excel 批量导入弹窗（设备台账、科室管理共用）：选文件 → 上传 → 显示 新增 / 更新 / 失败 与逐行原因
import { useEffect, useRef, useState } from 'react'
import { api, download } from '../api/client'
import { ErrorTip, Field, Modal } from './ui'

/**
 * title: 弹窗标题；uploadPath: 上传接口（相对 /api）；template: { path, name } 模板下载
 * intro: 第一段说明（按什么新增或更新）；columns: 列说明；note: 补充提示（可选）
 */
export default function XlsxImportModal({ open, onClose, onDone, title, uploadPath, template, intro, columns, note }) {
  const fileRef = useRef(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // {created,updated,errors:[{row,message}]}

  useEffect(() => { if (open) { setErr(null); setResult(null) } }, [open])

  async function submit(e) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return setErr({ message: '请选择 xlsx 文件' })
    if (file.size > 5 * 1024 * 1024) return setErr({ message: '文件超过 5MB 限制' })
    setErr(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api(uploadPath, { method: 'POST', body: fd })
      setResult(res)
      onDone()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} title={title} onClose={onClose}>
      {!result ? (
        <form onSubmit={submit}>
          <ErrorTip error={err} className="mb-3" />
          <p className="mb-3 text-sm text-slate-500">
            {intro}
            <button type="button" className="ml-1 text-primary hover:underline"
              onClick={() => download(template.path, template.name).catch(setErr)}>
              下载模板
            </button>
          </p>
          <Field label="选择文件" required hint={`xlsx，≤5MB。列：${columns}`}>
            {note && <p className="mb-1.5 text-xs text-slate-600">{note}</p>}
            <input ref={fileRef} type="file" accept=".xlsx" className="inp !py-1.5" required />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
            <button className="btn-primary" disabled={busy}>{busy ? '导入中…' : '开始导入'}</button>
          </div>
        </form>
      ) : (
        <div>
          <div className="mb-4 flex gap-3">
            <div className="flex-1 rounded-lg bg-emerald-50 p-3 text-center">
              <div className="text-xl font-bold text-emerald-600">{result.created ?? 0}</div>
              <div className="text-xs text-emerald-600">新增</div>
            </div>
            <div className="flex-1 rounded-lg bg-primary-light p-3 text-center">
              <div className="text-xl font-bold text-primary">{result.updated ?? 0}</div>
              <div className="text-xs text-primary">更新</div>
            </div>
            <div className="flex-1 rounded-lg bg-red-50 p-3 text-center">
              <div className="text-xl font-bold text-red-500">{result.errors?.length ?? 0}</div>
              <div className="text-xs text-red-500">失败</div>
            </div>
          </div>
          {result.errors?.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-red-100">
              <table className="tbl">
                <thead><tr><th className="w-16">行号</th><th>错误原因</th></tr></thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}><td className="tabular-nums text-slate-500">{e.row}</td><td className="text-red-600">{e.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" onClick={onClose}>完成</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
