// 服务器时间（北京时间），按秒走动。
// 只在加载、每 5 分钟、切回本页时向服务器校时一次；其余时间用「本机时钟 + 偏差」推算，
// 偏差里扣除一半网络往返时间。校时失败时继续按上次偏差走，并标 ⚠ 提示可能不准。
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

const SH = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
})
function fmtShanghai(ms) {
  const p = {}
  for (const it of SH.formatToParts(new Date(ms))) p[it.type] = it.value
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`
}

export default function ServerClock({ className = '' }) {
  const offset = useRef(null)
  const [text, setText] = useState('')
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let alive = true
    const show = () => {
      if (offset.current == null) return
      const s = fmtShanghai(Date.now() + offset.current)
      setText(prev => (prev === s ? prev : s))
    }
    async function sync() {
      const t0 = Date.now()
      try {
        const t = await api('/time')
        const t1 = Date.now()
        if (!alive || typeof t.epochMs !== 'number') return
        offset.current = t.epochMs + (t1 - t0) / 2 - t1
        setStale(false)
        show()
      } catch {
        if (alive) setStale(true)
      }
    }
    sync()
    const tick = setInterval(show, 250)           // 250ms 检查一次，秒数变了才重绘
    const resync = setInterval(sync, 5 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(tick)
      clearInterval(resync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!text) return null
  return (
    <span className={className}
      title={stale ? '与服务器校时失败，当前显示的是按上次校准推算的时间' : '业务日期一律以服务器时间（北京时间）为准'}>
      服务器时间 <span className="tabular-nums">{text}</span>{stale && <span className="ml-1 text-amber-600">⚠</span>}
    </span>
  )
}
