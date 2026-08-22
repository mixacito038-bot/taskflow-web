// 公共数据 hooks：科室列表、服务端时间（业务日期只信 /api/time）
import { useEffect, useState } from 'react'
import { api } from './api/client'
import { asList, ymd } from './utils'

export function useDepts() {
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    api('/depts')
      .then(res => setDepts(asList(res)))
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])
  const deptName = id => depts.find(d => String(d.id) === String(id))?.name || `科室#${id}`
  const onDepts = depts.filter(d => d.status !== 'off')
  return { depts, onDepts, deptName, loading, error }
}

/** { now, date, week, month }（Asia/Shanghai，服务端计算） */
export function useServerTime() {
  const [time, setTime] = useState(null)
  useEffect(() => {
    let alive = true
    const load = (retry = 0) => api('/time')
      .then(t => { if (alive) setTime(t) })
      .catch(() => {
        if (!alive) return
        if (retry < 2) return setTimeout(() => load(retry + 1), 800 * (retry + 1))
        /* 兜底用浏览器本地日期。有效期角标宁可按本机时钟算（差最多一天），
           也好过 time 为 null 时整页角标全部消失、过期设备看起来和正常设备一样。
           fallback 标记出来，界面据此提示这一栏可能不准。 */
        setTime({ date: ymd(new Date()), fallback: true })
      })
    load()
    return () => { alive = false }
  }, [])
  return time
}
