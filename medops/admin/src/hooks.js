// 公共数据 hooks：科室列表、服务端时间（业务日期只信 /api/time）
import { useEffect, useState } from 'react'
import { api } from './api/client'
import { asList } from './utils'

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
  useEffect(() => { api('/time').then(setTime).catch(() => setTime(null)) }, [])
  return time
}
