// 历史数据导入（仅 admin）：粘贴 / 上传 H5 导出 JSON → 先检查（不写数据）→ POST /admin/import/legacy（事务导入）
import { useRef, useState } from 'react'
import { api } from '../api/client'
import { ErrorTip } from '../components/ui'

const KEYS = ['depts', 'devices', 'members', 'users', 'records', 'weeksigns', 'monthsigns']
const KEY_TEXT = { depts: '科室', devices: '设备', members: '签字人', users: '账号', records: '日巡检记录', weeksigns: '周签', monthsigns: '月签' }

/* 导入 / 检查结果：条数、新账号初始密码、跳过的、需要留意的 */
function ResultPanel({ result, onImport, busy }) {
  const dry = !!result.dryRun
  const imported = result.imported || {}
  const pw = Object.entries(result.passwords || {})
  const errors = result.errors || []
  const warnings = result.warnings || []
  const [copied, setCopied] = useState(false)

  function copyPw() {
    const text = pw.map(([u, p]) => `${u}\t${p}`).join('\n')
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <div className="mt-4">
      <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${dry ? 'border-primary/30 bg-primary-light text-primary' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
        {dry ? '检查完成（还没有导入，系统里的数据没有任何改动）。如果现在导入，结果如下：' : '导入完成。'}
        {errors.length > 0 && <>有 <b>{errors.length}</b> 条{dry ? '会被' : '已'}跳过，</>}
        {warnings.length > 0 && <>有 <b>{warnings.length}</b> 条需要留意，</>}
        {(errors.length > 0 || warnings.length > 0) ? '见下方说明。' : '没有发现问题。'}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {KEYS.map(k => (
          <span key={k} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
            {dry ? '将新增' : '新增'}{KEY_TEXT[k]} <b className="tabular-nums">{imported[k] ?? 0}</b>
          </span>
        ))}
      </div>

      {pw.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-amber-800">新账号的初始密码（只显示这一次，请抄下来或截图）</span>
            <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={copyPw}>{copied ? '已复制' : '复制全部'}</button>
          </div>
          <table className="tbl bg-white">
            <thead><tr><th>账号</th><th>初始密码</th></tr></thead>
            <tbody>
              {pw.map(([u, p]) => <tr key={u}><td className="font-mono">{u}</td><td className="font-mono">{p}</td></tr>)}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-amber-800">本人首次登录后必须改密码。忘了抄也没关系，可以在「账号管理」里重置。</p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-sm font-medium text-red-700">{dry ? '会被跳过的' : '已跳过的'}（{errors.length}）</div>
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-red-100 bg-red-50/50 text-sm">
            {errors.map((e, i) => (
              <li key={i} className="border-b border-red-100 px-3 py-1.5 last:border-0">
                <span className="font-medium text-slate-800">{e.where}</span>
                <span className="text-slate-600">：{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-sm font-medium text-amber-800">需要留意的（{warnings.length}）</div>
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-amber-100 bg-amber-50/50 text-sm">
            {warnings.map((e, i) => (
              <li key={i} className="border-b border-amber-100 px-3 py-1.5 last:border-0">
                <span className="font-medium text-slate-800">{e.where}</span>
                <span className="text-slate-600">：{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dry && (
        <button className="btn-primary" onClick={onImport} disabled={busy}>{busy ? '导入中，请稍候…' : '确认无误，开始导入'}</button>
      )}
    </div>
  )
}

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

  async function run(dryRun) {
    if (!parsed) return
    if (!dryRun && !confirm('确认导入？导入的账号密码会被重置为随机值，并要求首次登录改密。')) return
    setErr(null)
    setBusy(true)
    try {
      const res = await api(`/admin/import/legacy${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body: parsed })
      setResult(res || { imported: {} })
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">历史数据导入</h2>
      <p className="mb-5 text-sm text-slate-500">将旧版 H5「导出数据」生成的 JSON 一次性导入服务端（含科室 / 设备 / 签字人 / 账号 / 巡检与签字记录）。</p>

      <div className="card max-w-3xl p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-slate-600">粘贴 JSON，或
            <button className="ml-1 text-primary hover:underline" onClick={() => fileRef.current?.click()}>选择 .json 文件</button>
          </span>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          {text && <button className="text-sm text-slate-500 hover:text-slate-600" onClick={() => { setText(''); setParsed(null); setErr(null); setResult(null) }}>清空</button>}
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
                <span key={k} className={`rounded-full px-3 py-1 text-xs ${Array.isArray(parsed[k]) && parsed[k].length ? 'bg-primary-light text-primary' : 'bg-slate-100 text-slate-500'}`}>
                  {KEY_TEXT[k]} {Array.isArray(parsed[k]) ? parsed[k].length : 0}
                </span>
              ))}
            </div>
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              建议先点「先检查」：会把整份数据完整过一遍，列出哪些会被跳过、哪些要留意，但不写入任何数据。
              今天以后的记录、还没结束的周 / 月的签字不会导入（导进来会锁住本周 / 本月，巡检员就录不进去了）。
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => run(true)} disabled={busy}>{busy ? '检查中…' : '先检查（不导入）'}</button>
              <button className="btn-primary" onClick={() => run(false)} disabled={busy}>{busy ? '导入中，请稍候…' : '直接导入'}</button>
            </div>
          </div>
        )}

        {result && <ResultPanel result={result} busy={busy} onImport={() => run(false)} />}
      </div>
    </div>
  )
}
