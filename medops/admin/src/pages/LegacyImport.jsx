// 历史数据导入（仅 admin）：粘贴 / 上传 H5 导出 JSON → POST /admin/import/legacy（事务导入）
import { useRef, useState } from 'react'
import { api } from '../api/client'
import { ErrorTip } from '../components/ui'

const KEYS = ['depts', 'devices', 'members', 'users', 'records', 'weeksigns', 'monthsigns']
const KEY_TEXT = { depts: '科室', devices: '设备', members: '签字人', users: '账号', records: '日巡检记录', weeksigns: '周签', monthsigns: '月签' }

export default function LegacyImport() {
  const fileRef = useRef(null)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  function tryParse(raw) {
    setErr(null)
    setParsed(null)
    setResult(null)
    if (!raw.trim()) return
    try {
      const j = JSON.parse(raw)
      if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('顶层应为对象')
      if (!KEYS.some(k => Array.isArray(j[k]))) throw new Error(`未发现有效数据键（${KEYS.join(' / ')}）`)
      setParsed(j)
    } catch (e) {
      setErr({ message: 'JSON 解析失败：' + e.message })
    }
  }

  function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result)); tryParse(String(reader.result)) }
    reader.onerror = () => setErr({ message: '文件读取失败' })
    reader.readAsText(f)
  }

  async function submit() {
    if (!parsed) return
    if (!confirm('确认导入？该操作为事务导入，导入的账号密码将被重置为随机值并要求首次改密。')) return
    setErr(null)
    setBusy(true)
    try {
      const res = await api('/admin/import/legacy', { method: 'POST', body: parsed })
      setResult(res || { ok: true })
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">历史数据导入</h2>
      <p className="mb-5 text-sm text-slate-400">将旧版 H5「导出数据」生成的 JSON 一次性导入服务端（含科室 / 设备 / 签字人 / 账号 / 巡检与签字记录）。</p>

      <div className="card max-w-3xl p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-slate-600">粘贴 JSON，或
            <button className="ml-1 text-primary hover:underline" onClick={() => fileRef.current?.click()}>选择 .json 文件</button>
          </span>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          {text && <button className="text-sm text-slate-400 hover:text-slate-600" onClick={() => { setText(''); setParsed(null); setErr(null); setResult(null) }}>清空</button>}
        </div>

        <textarea
          className="inp h-56 font-mono text-xs"
          placeholder='{"depts":[...],"devices":[...],"members":[...],"users":[...],"records":[...],"weeksigns":[...],"monthsigns":[...]}'
          value={text}
          onChange={e => { setText(e.target.value); tryParse(e.target.value) }}
        />

        <ErrorTip error={err} className="mt-3" />

        {parsed && !result && (
          <div className="mt-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {KEYS.map(k => (
                <span key={k} className={`rounded-full px-3 py-1 text-xs ${Array.isArray(parsed[k]) && parsed[k].length ? 'bg-primary-light text-primary' : 'bg-slate-100 text-slate-400'}`}>
                  {KEY_TEXT[k]} {Array.isArray(parsed[k]) ? parsed[k].length : 0}
                </span>
              ))}
            </div>
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              注意：导入的账号密码会被重置为随机值并置「首次登录改密」，导入完成后请在「账号管理」逐个重置密码下发。
            </div>
            <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? '导入中，请稍候…' : '开始导入'}</button>
          </div>
        )}

        {result && (
          <div className="mt-4">
            <div className="mb-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-600">导入完成</div>
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
