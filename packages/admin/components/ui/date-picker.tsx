

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import { format, parseISO, isValid, setMonth, setYear, addMonths } from 'date-fns'
import { IconCalendar, IconClock, IconChevronLeft, IconChevronRight, IconCloseCircle } from '@tangen/icons'
import { clsx } from 'clsx'
import 'react-day-picker/style.css'

interface DatePickerProps {
  value?: string        // 'YYYY-MM-DD', or 'YYYY-MM-DDTHH:mm' when withTime
  onChange: (v: string | undefined) => void
  placeholder?: string
  className?: string
  /** Adds a time row — value becomes 'YYYY-MM-DDTHH:mm'. */
  withTime?: boolean
  /** Time used when a day is picked before any time is typed (withTime only). */
  defaultTime?: string
  /** 'sm' = compact (filters); 'md' matches form inputs (h-9 text-sm). */
  size?: 'sm' | 'md'
  disabled?: boolean
  /** Earliest selectable date ('YYYY-MM-DD') — days before it are disabled. */
  minDate?: string
}

export function DatePicker({
  value, onChange, placeholder = 'Pick a date', className,
  withTime = false, defaultTime = '00:00', size = 'md', disabled, minDate,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [jumpOpen, setJumpOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const datePart = value?.split('T')[0] ?? ''
  const timePart = value?.split('T')[1]?.slice(0, 5) ?? ''
  const selected = datePart && isValid(parseISO(datePart)) ? parseISO(datePart) : undefined
  // The month on show follows the selection, then the arrows and the month / year jump.
  const [month, setMonthOnShow] = useState<Date>(() => selected ?? new Date())
  useEffect(() => { if (open) { setMonthOnShow(selected ?? new Date()); setJumpOpen(false) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // The calendar renders in a body portal with fixed positioning so it can
  // never be clipped by an overflow-hidden ancestor (DataList toolbars, cards,
  // sheets). Flips above the trigger when there's no room below.
  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const height = popRef.current?.offsetHeight ?? (330 + (withTime ? 44 : 0) + 28)
    const width = popRef.current?.offsetWidth ?? 280
    const top = r.bottom + height + 8 > window.innerHeight && r.top - height - 8 > 0
      ? r.top - height - 4
      : r.bottom + 4
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos({ top, left })
  }, [withTime])

  useEffect(() => {
    if (!open) { setPos(null); return }
    place()
    // Re-measure once the popover has real dimensions, then track viewport moves.
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, place])

  function handleSelect(day: Date | undefined) {
    if (!day) { onChange(undefined); setOpen(false); return }
    const d = format(day, 'yyyy-MM-dd')
    onChange(withTime ? `${d}T${timePart || defaultTime}` : d)
    if (!withTime) setOpen(false)
  }

  // What the header reads: the benchmark's MM/DD/YYYY hh:mm AM, or the placeholder.
  const heading = selected
    ? `${format(selected, 'MM/dd/yyyy')}${withTime && timePart ? ` ${format(parseISO(`${datePart}T${timePart}`), 'hh:mm a')}` : ''}`
    : placeholder
  const years = useMemo(() => { const y = month.getFullYear(); return Array.from({ length: 21 }, (_, i) => y - 10 + i) }, [month])
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const iconBtn = 'flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center gap-2 w-full border rounded-md transition-colors text-left bg-surface',
          size === 'md' ? 'text-sm px-2.5 h-9 border-border-strong shadow-xs' : 'text-xs px-2.5 py-1.5 border-border',
          open ? 'border-accent ring-1 ring-indigo-400' : size === 'md' ? 'hover:border-gray-400' : 'hover:border-border-strong',
          selected ? 'text-fg' : 'text-fg-subtle',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <IconCalendar className={clsx('text-fg-subtle shrink-0', size === 'md' ? 'size-4' : 'size-3.5')} />
        {selected ? heading : placeholder}
      </button>

      {open && createPortal(
        <div ref={popRef} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          data-datepicker-pop=""
          className="fixed z-[10000] w-[300px] pointer-events-auto overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          {/* The benchmark's picker (2026-09-08): what is chosen, then the time, the
              month / year jump and the arrows, the days, and Clear at the bottom. */}
          <div className={clsx('border-b border-border-subtle px-3 py-2.5 text-sm', selected ? 'text-fg' : 'text-fg-subtle')} data-testid="datepicker-heading">{heading}</div>
          <div className="relative flex items-center gap-1 border-b border-border-subtle px-2 py-2">
            {withTime ? (
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-surface-sunken px-2.5 text-sm text-fg transition-colors motion-fast focus-within:border-focus-border focus-within:ring-[3px] focus-within:ring-focus/25">
                <button type="button" aria-label="Pick a time" onClick={() => { const el = timeRef.current as (HTMLInputElement & { showPicker?: () => void }) | null; try { el?.showPicker?.() } catch { el?.focus() } }} className="flex shrink-0 items-center text-fg-subtle hover:text-fg">
                  <IconClock className="size-4" aria-hidden />
                </button>
                <input
                  ref={timeRef}
                  type="time"
                  value={timePart}
                  aria-label="Time"
                  onChange={(e) => {
                    const d = selected ? format(selected, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
                    onChange(`${d}T${e.currentTarget.value || '00:00'}`)
                  }}
                  className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none [accent-color:var(--tg-accent)] [&::-webkit-calendar-picker-indicator]:hidden"
                />
              </div>
            ) : (
              <span className="flex-1 pl-1 text-sm font-medium text-fg">{format(month, 'MMMM yyyy')}</span>
            )}
            <button type="button" onClick={() => setJumpOpen((o) => !o)} aria-label="Choose month and year" aria-expanded={jumpOpen} className={clsx(iconBtn, jumpOpen && 'bg-surface-selected text-fg')}>
              <IconCalendar className="size-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setMonthOnShow((m) => addMonths(m, -1))} aria-label="Previous month" className={iconBtn}><IconChevronLeft className="size-4" aria-hidden /></button>
            <button type="button" onClick={() => setMonthOnShow((m) => addMonths(m, 1))} aria-label="Next month" className={iconBtn}><IconChevronRight className="size-4" aria-hidden /></button>
            {jumpOpen && (
              <div className="absolute right-2 top-full z-10 mt-1 flex w-44 flex-col gap-1.5 rounded-xl border border-border bg-surface p-2 shadow-lg" data-testid="datepicker-jump">
                <select
                  value={month.getMonth()}
                  aria-label="Month"
                  // Read the event before the updater runs: React clears it by then.
                  onChange={(e) => { const v = Number(e.currentTarget.value); setMonthOnShow((m) => setMonth(m, v)) }}
                  className="h-8 w-full rounded-control border border-border bg-surface-sunken px-2 text-sm text-fg outline-none focus-visible:border-focus-border"
                >
                  {MONTHS.map((name, i) => <option key={name} value={i}>{name}</option>)}
                </select>
                <select
                  value={month.getFullYear()}
                  aria-label="Year"
                  onChange={(e) => { const v = Number(e.currentTarget.value); setMonthOnShow((m) => setYear(m, v)); setJumpOpen(false) }}
                  className="h-8 w-full rounded-control border border-border bg-surface-sunken px-2 text-sm text-fg outline-none focus-visible:border-focus-border"
                >
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="px-2 pb-1 pt-2">
            <DayPicker
              mode="single"
              month={month}
              onMonthChange={setMonthOnShow}
              selected={selected}
              onSelect={handleSelect}
              showOutsideDays
              hideNavigation
              disabled={minDate && isValid(parseISO(minDate)) ? { before: parseISO(minDate) } : undefined}
              formatters={{ formatWeekdayName: (d) => format(d, 'EEEEEE') }}
              classNames={{ root: 'rdp-custom', month_caption: 'rdp-custom-caption' }}
            />
          </div>
          <button
            type="button"
            onClick={() => { onChange(undefined); setOpen(false) }}
            disabled={!selected}
            className="flex h-11 w-full items-center gap-2 border-t border-border-subtle px-3 text-sm text-fg transition-colors motion-fast hover:bg-surface-hover disabled:cursor-default disabled:text-fg-faint disabled:hover:bg-transparent"
          >
            <IconCloseCircle className="size-4 text-fg-subtle" aria-hidden />
            Clear
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
