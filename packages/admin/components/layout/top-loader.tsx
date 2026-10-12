import { useEffect, useRef } from 'react'
import { useNavigation } from 'react-router-dom'

export function TopLoader() {
  const navigation = useNavigation()
  const loading = navigation.state !== 'idle'
  const barRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    if (loading) {
      bar.style.width = '0%'
      bar.style.opacity = '1'
      timerRef.current = setTimeout(() => { bar.style.width = '80%' }, 10)
    } else {
      bar.style.width = '100%'
      timerRef.current = setTimeout(() => { bar.style.opacity = '0'; bar.style.width = '0%' }, 200)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [loading])

  return (
    <div
      ref={barRef}
      style={{
        position: 'fixed', top: 0, left: 0, height: '2px',
        background: '#2563eb', zIndex: 9999, opacity: 0, width: '0%',
        transition: 'width 0.3s ease, opacity 0.2s ease',
        pointerEvents: 'none',
      }}
    />
  )
}
