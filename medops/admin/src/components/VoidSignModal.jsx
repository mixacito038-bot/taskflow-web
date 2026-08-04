// 作废签字（仅 admin）：POST /admin/signs/void {type,deptId,key,reason}，记录退回未签态
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { ErrorTip, Field, Modal } from './ui'

const TYPE_TEXT = { day: '日签', week: '周签', month: '月签' }

/** target: {type:'day'|'week'|'month', deptId, key, label} */
export default function VoidSignModal({ target, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (target) { setReason(''); setErr(null) } }, [target])

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) return setErr({ message: '请填写作废原因' })
    setErr(null)
    setBusy(true)
    try {
      await api('/admin/signs/void', {
        method: 'POST',
        body: { type: target.type, deptId: target.deptId, key: target.key, reason: reason.trim() }
      })
      onDone()
      onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  return (
    <Modal open={!!target} title={`作废${TYPE_TEXT[target?.type] || '签字'}`} onClose={onClose} width="max-w-sm">
      {target && (
        <form onSubmit={submit}>
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            将作废 <b>{target.label}</b> 的{TYPE_TEXT[target.type]}，记录退回未签状态，操作会写入审计日志。
          </div>
          <ErrorTip error={err} className="mb-3" />
          <Field label="作废原因" required>
            <textarea className="inp" rows={3} value={reason} onChange={e => setReason(e.target.value)} required placeholder="如：签错人 / 数据填错需重签" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
            <button className="btn-danger !bg-red-500 !text-white !border-red-500 hover:!bg-red-600" disabled={busy}>{busy ? '提交中…' : '确认作废'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
