// 账号批量导入：下载模板 → 选文件 → 上传。整张表先检查，有问题一个都不导入、逐行列出原因；
// 全部通过则列出新账号和初始密码（只显示这一次），可复制或下载成表格发给本人
import { useEffect, useRef, useState } from 'react'
import { api, download } from '../api/client'
import { ROLE_TEXT } from '../utils'
import { ErrorTip, Field, Modal } from './ui'

/* 下载成 CSV（带 BOM，Excel 双击打开中文不乱码）。账号、密码写成 ="…"：
   否则 Excel 会把 001 吃掉开头的 0、把 12E34 这样的随机密码当成科学计数法 */
function saveCsv(accounts) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [['登录账号', '姓名', '角色', '科室', '初始密码', '状态'].map(q).join(',')]
  for (const a of accounts) {
    const txt = v => `="${String(v).replace(/"/g, '""')}"`
    lines.push([txt(a.username), a.displayName, ROLE_TEXT[a.role] || a.role, a.role === 'equip' ? '全院' : a.depts.join('、'),
      txt(a.password), a.status === 'off' ? '停用' : '启用'].map(q).join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const el = document.createElement('a')
  el.href = url
  el.download = `新账号初始密码-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(el); el.click(); el.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function AccountImportModal({ open, onClose, onDone }) {
  const fileRef = useRef(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // {created, errors, warnings, accounts}
  const [copied, setCopied] = useState(false)

  useEffect(() => { if (open) { setErr(null); setResult(null); setCopied(false) } }, [open])

  async function submit(e) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return setErr({ message: '请选择 xlsx 文件' })
    if (!/\.xlsx$/i.test(file.name)) return setErr({ message: '只支持 .xlsx 文件：请用下载的模板填写，或在 Excel 里「另存为 .xlsx」' })
    if (file.size > 5 * 1024 * 1024) return setErr({ message: '文件超过 5MB 限制' })
    setErr(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api('/admin/users/import', { method: 'POST', body: fd })
      setResult(res)
      if (res.created) onDone()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }

  function copyAll() {
    const text = ['登录账号\t姓名\t初始密码', ...result.accounts.map(a => `${a.username}\t${a.displayName}\t${a.password}`)].join('\n')
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})
  }

  // 导入成功后关闭前提醒一下：密码只显示这一次
  function close() {
    if (result?.created && !copied && !confirm('初始密码只显示这一次。确定已经复制或下载了吗？')) return
    onClose()
  }

  const failed = result && result.errors?.length > 0

  return (
    <Modal open={open} title="批量导入账号" onClose={close} width={result?.created ? 'max-w-3xl' : 'max-w-lg'}>
      {!result ? (
        <form onSubmit={submit}>
          <ErrorTip error={err} className="mb-3" />
          <div className="mb-3 space-y-1.5 text-sm text-slate-600">
            <p>
              先
              <button type="button" className="mx-1 text-primary hover:underline"
                onClick={() => download('/admin/users/import-template', 'accounts-template.xlsx').catch(setErr)}>
                下载模板
              </button>
              ，照第 2 张表的说明填好再上传。只能新增账号，已有账号请在列表里编辑。
            </p>
            <p className="text-slate-500">导入前会检查整张表：账号不能重复（和系统里已有的、表里其他行都比，不区分大小写）、角色和科室要对得上。有一行不对就一个都不导入，改好后重新上传即可。</p>
          </div>
          <Field label="选择文件" required hint="xlsx，≤5MB，最多 500 个账号。列：登录账号、姓名、角色、科室、初始密码（选填）、状态（选填）">
            <input ref={fileRef} type="file" accept=".xlsx" className="inp !py-1.5" required />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
            <button className="btn-primary" disabled={busy}>{busy ? '检查并导入中…' : '开始导入'}</button>
          </div>
        </form>
      ) : failed ? (
        <div>
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
            表里有 <b>{result.errors.length}</b> 行不符合要求，<b>这次一个账号都没有导入</b>。请按下面的提示改好 Excel，再重新导入整张表。
          </p>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-red-100">
            <table className="tbl">
              <thead><tr><th className="w-16">行号</th><th>问题</th></tr></thead>
              <tbody>
                {result.errors.map((e, i) => (
                  <tr key={i}><td className="tabular-nums text-slate-500">{e.row}</td><td className="text-red-600">{e.message}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>关闭</button>
            <button className="btn-primary" onClick={() => { setResult(null); setErr(null) }}>改好了，重新选择文件</button>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            已导入 <b>{result.created}</b> 个账号。下面的初始密码<b>只显示这一次</b>，请复制或下载后发给本人；第一次登录必须改密码。
          </p>
          {result.warnings?.length > 0 && (
            <ul className="mb-3 list-disc space-y-0.5 rounded-lg bg-amber-50 py-2 pl-8 pr-3 text-xs text-amber-800">
              {result.warnings.map((w, i) => <li key={i}>第 {w.row} 行：{w.message}</li>)}
            </ul>
          )}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            <table className="tbl">
              <thead><tr><th>登录账号</th><th>姓名</th><th>角色</th><th>科室</th><th>初始密码</th></tr></thead>
              <tbody>
                {result.accounts.map(a => (
                  <tr key={a.username}>
                    <td className="font-mono">{a.username}</td>
                    <td>{a.displayName}{a.status === 'off' && <span className="ml-1 text-xs text-red-500">（停用）</span>}</td>
                    <td>{ROLE_TEXT[a.role] || a.role}</td>
                    <td className="max-w-[220px] text-slate-600">{a.role === 'equip' ? '全院' : a.depts.join('、')}</td>
                    <td className="font-mono font-semibold">{a.password}{a.generated && <span className="ml-1 text-xs font-normal text-slate-500">随机</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={copyAll}>{copied ? '已复制' : '复制全部'}</button>
            <button className="btn-ghost" onClick={() => { saveCsv(result.accounts); setCopied(true) }}>下载表格</button>
            <button className="btn-primary" onClick={close}>完成</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
