// 公共数据 hooks：科室列表、服务端时间（业务日期只信 /api/time）
import { useEffect, useState } from 'react'
import { api } from './api/client'
import { asList, ymd } from './utils'

/* 科室列表。停用科室不能从筛选和导出里消失：停用而不删除，就是为了历史数据还能查、能导出。
   - onDepts：启用中的科室（新建设备/签字人/账号时可选的）
   - filterDepts：筛选、导出用，启用在前、停用在后（显示时加「已停用」）
   - formDepts(当前值)：编辑表单用，启用科室 + 当前值所在的停用科室（否则下拉会错显成第一个科室）
   - error：加载失败要让页面显示出来，不能让下拉悄悄变空 */
export function useDepts() {
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    let alive = true
    const load = (retry = 0) => api('/depts')
      .then(res => { if (alive) { setDepts(asList(res)); setError(null); setLoading(false) } })
      .catch(e => {
        if (!alive) return
        if (retry < 2) return setTimeout(() => load(retry + 1), 800 * (retry + 1))
        setError({ message: `科室列表加载失败（${e.message || '网络异常'}），请刷新页面` })
        setLoading(false)
      })
    load()
    return () => { alive = false }
  }, [])
  const byId = id => depts.find(d => String(d.id) === String(id))
  const deptName = id => byId(id)?.name || `科室#${id}`
  const deptLabel = id => { const d = byId(id); return d ? deptOptLabel(d) : `科室#${id}` }
  const onDepts = depts.filter(d => d.status !== 'off')
  const filterDepts = [...onDepts, ...depts.filter(d => d.status === 'off')]
  const formDepts = currentId => {
    const cur = byId(currentId)
    return cur && cur.status === 'off' ? [...onDepts, cur] : onDepts
  }
  return { depts, onDepts, filterDepts, formDepts, deptName, deptLabel, loading, error }
}

/** 下拉选项文字：停用科室加标记 */
export const deptOptLabel = d => d.name + (d.status === 'off' ? '（已停用）' : '')

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
