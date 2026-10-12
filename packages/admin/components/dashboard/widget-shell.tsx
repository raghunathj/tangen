import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconGripDots } from '@tangen/icons'
import { clsx } from 'clsx'
import type { ColSpan, RowSpan } from '@/lib/dashboard-prefs'

// Three vertical bars, filled bars = current span. Self-rendering, no icon dep.
function ColumnsBars({ span, size = 'sm' }: { span: ColSpan; size?: 'sm' | 'md' }) {
  const barClass = size === 'md'
    ? 'w-[4px] h-[14px] rounded-[1px]'
    : 'w-[3px] h-[11px] rounded-[1px]'
  return (
    <span className="flex items-center gap-[2px]">
      {([1, 2, 3] as const).map((n) => (
        <span
          key={n}
          className={clsx(barClass, 'block bg-current', n <= span ? 'opacity-100' : 'opacity-20')}
        />
      ))}
    </span>
  )
}

const SPAN_OPTIONS: Array<{ span: ColSpan; label: string; sub: string }> = [
  { span: 1, label: '1 column',          sub: '⅓ width' },
  { span: 2, label: '2 columns',         sub: '⅔ width' },
  { span: 3, label: '3 columns',         sub: 'full width' },
]

function ResizeDropdown({
  id,
  colSpan,
  onResize,
}: {
  id: string
  colSpan: ColSpan
  onResize: (id: string, span: ColSpan) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="absolute top-2 right-2 z-30">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Change column width"
        className={clsx(
          'flex items-center gap-1 rounded-md bg-surface-raised border shadow-xs px-1.5 py-1',
          'text-fg-muted hover:text-fg transition-all',
          'opacity-0 group-hover:opacity-100',
          open
            ? 'opacity-100 border-accent/30 bg-accent-muted text-accent-fg'
            : 'border-border hover:border-border-strong',
        )}
      >
        <ColumnsBars span={colSpan} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-44 rounded-xl border border-border bg-surface shadow-lg overflow-hidden py-1">
          {SPAN_OPTIONS.map((opt) => {
            const active = colSpan === opt.span
            return (
              <button
                key={opt.span}
                onClick={() => { onResize(id, opt.span); setOpen(false) }}
                className={clsx(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                  active
                    ? 'bg-accent-muted text-accent-fg'
                    : 'text-fg hover:bg-surface-sunken',
                )}
              >
                <ColumnsBars span={opt.span} size="md" />
                <span className="flex-1">
                  <span className="block text-sm font-medium leading-tight">{opt.label}</span>
                  <span className="block text-xs text-fg-subtle leading-tight">{opt.sub}</span>
                </span>
                {active && (
                  <span className="text-[10px] font-semibold text-accent uppercase tracking-wide">on</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface Props {
  id: string
  colSpan: ColSpan
  rowSpan?: RowSpan
  editMode: boolean
  onResize: (id: string, span: ColSpan) => void
  children: React.ReactNode
}

export function WidgetShell({ id, colSpan, rowSpan = 1, editMode, onResize, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editMode })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${colSpan}`,
    gridRow: `span ${rowSpan}`,
  }

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={{ gridColumn: `span ${colSpan}`, gridRow: `span ${rowSpan}`, transition }}
        className="rounded-xl border-2 border-dashed border-accent/30 bg-accent-muted/40 min-h-[100px]"
      />
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group h-full min-h-0">
      {editMode && (
        <button
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          className={clsx(
            'absolute top-2 left-2 z-20 flex items-center rounded-md',
            'bg-surface-raised border border-border shadow-xs px-1.5 py-1',
            'cursor-grab active:cursor-grabbing text-fg-subtle hover:text-fg hover:border-border-strong',
          )}
        >
          <IconGripDots className="size-3.5" />
        </button>
      )}

      {editMode && <ResizeDropdown id={id} colSpan={colSpan} onResize={onResize} />}

      {/* Card fills its bento cell - no ragged bottoms inside a row */}
      <div className={clsx('h-full min-h-0 [&>*]:h-full', editMode && 'ring-2 ring-focus/25 rounded-xl')}>
        {children}
      </div>
    </div>
  )
}

export function WidgetDragOverlay({
  colSpan,
  children,
}: {
  colSpan: ColSpan
  children: React.ReactNode
}) {
  return (
    <div
      style={{ gridColumn: `span ${colSpan}`, width: '100%' }}
      className="rounded-xl shadow-2xl ring-2 ring-indigo-400 rotate-[0.75deg] opacity-95 cursor-grabbing"
    >
      {children}
    </div>
  )
}
