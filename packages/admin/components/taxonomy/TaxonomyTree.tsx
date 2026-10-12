import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconChevronRight, IconGripDots } from '@tangen/icons'
import { buildTaxonomyTree, flattenTree } from '@/lib/taxonomy-tree'
import type { TaxTreeNode } from '@/lib/taxonomy-tree'

interface TaxRow {
  id: string
  title: string | null
  status: string
  position?: number | null
  [key: string]: unknown
}

interface TaxonomyTreeProps {
  rows: TaxRow[]
  parentField: string         // e.g. 'parent'
  orderable: boolean          // show drag handles and enable reorder
  workspaceId: string
  typeName: string
  onReorder: (updates: { id: string; position: number }[]) => Promise<void>
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'published')
    return <span className="inline-flex items-center gap-1.5 text-ui-xs font-medium text-success-fg"><span className="size-1.5 shrink-0 rounded-full bg-success" />Published</span>
  if (status === 'archived')
    return <span className="inline-flex items-center gap-1.5 text-ui-xs font-medium text-fg-muted"><span className="size-1.5 shrink-0 rounded-full bg-fg-faint" />Archived</span>
  return <span className="inline-flex items-center gap-1.5 text-ui-xs font-medium text-fg-muted"><span className="size-1.5 shrink-0 rounded-full bg-fg-subtle" />Draft</span>
}

interface FlatNode extends TaxTreeNode {
  row: TaxRow
  siblingIds: string[]   // all sibling IDs in current order (for DnD scope)
}

function buildFlatNodes(rows: TaxRow[], parentField: string): FlatNode[] {
  const tree = buildTaxonomyTree(rows as any[], parentField)
  const flat = flattenTree(tree)

  // Build sibling groups: parentId → ordered sibling IDs
  const siblingMap = new Map<string | null, string[]>()
  for (const n of flat) {
    const pid = n.parentId ?? null
    if (!siblingMap.has(pid)) siblingMap.set(pid, [])
    if (!siblingMap.get(pid)!.includes(n.row.id)) siblingMap.get(pid)!.push(n.row.id)
  }

  return flat.map(n => ({
    ...n,
    row: n.row as TaxRow,
    siblingIds: siblingMap.get(n.parentId ?? null) ?? [n.row.id],
  }))
}

interface SortableRowProps {
  node: FlatNode
  orderable: boolean
  expanded: boolean
  hasChildren: boolean
  onToggle: (id: string) => void
  onClick: (id: string) => void
}

function SortableRow({ node, orderable, expanded, hasChildren, onToggle, onClick }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.row.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'group flex h-(--tg-row-h) cursor-pointer items-center gap-2 border-b border-border bg-surface px-3 text-ui transition-colors motion-fast',
        'hover:bg-surface-hover',
        isDragging && 'z-50 rounded-control shadow-popover',
      )}
      onClick={() => onClick(node.row.id)}
    >
      {/* Indent */}
      {node.depth > 0 && (
        <span className="shrink-0" style={{ width: node.depth * 24 }} />
      )}

      {/* Drag handle */}
      {orderable && (
        <span
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-fg-subtle hover:text-fg-muted touch-none"
          title="Drag to reorder"
        >
          <IconGripDots className="size-4" />
        </span>
      )}

      {/* Expand toggle */}
      {hasChildren ? (
        <button
          onClick={e => { e.stopPropagation(); onToggle(node.row.id) }}
          className="shrink-0 text-fg-subtle hover:text-fg-muted transition-colors"
        >
          <IconChevronRight className={clsx('size-4 transition-transform duration-150', expanded && 'rotate-90')} />
        </button>
      ) : (
        <span className="shrink-0 size-4" />
      )}

      {/* Title */}
      <span className="flex-1 truncate font-medium text-fg">
        {node.row.title ?? <span className="text-fg-subtle italic">Untitled</span>}
      </span>

      {/* Status */}
      <StatusBadge status={node.row.status} />
    </div>
  )
}

export function TaxonomyTree({
  rows, parentField, orderable, workspaceId, typeName, onReorder,
}: TaxonomyTreeProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // Local row order — updated optimistically on drag
  const [localRows, setLocalRows] = useState<TaxRow[]>(rows)

  // Rebuild local rows when props change (e.g. after fetch)
  // We use a simple reference equality guard
  if (localRows !== rows && localRows.length !== rows.length) setLocalRows(rows)

  const flatNodes = buildFlatNodes(localRows, parentField)

  // Visible flat list respects expand state
  const visible = flatNodes.filter(n => {
    if (n.parentId === null) return true
    // Walk up — all ancestors must be expanded
    let pid: string | null = n.parentId
    while (pid !== null) {
      if (!expanded.has(pid)) return false
      const ancestor = flatNodes.find(x => x.row.id === pid)
      pid = ancestor?.parentId ?? null
    }
    return true
  })

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeNode = flatNodes.find(n => n.row.id === active.id)
    const overNode   = flatNodes.find(n => n.row.id === over.id)
    if (!activeNode || !overNode) return
    // Only allow reorder within same sibling group
    if (activeNode.parentId !== overNode.parentId) return

    const sibIds = activeNode.siblingIds
    const fromIdx = sibIds.indexOf(active.id as string)
    const toIdx   = sibIds.indexOf(over.id as string)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...sibIds]
    reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, active.id as string)

    // Optimistic local update
    const posMap = new Map(reordered.map((id, i) => [id, i]))
    const nextRows = localRows.map(r => posMap.has(r.id) ? { ...r, position: posMap.get(r.id) } : r)
    setLocalRows(nextRows as TaxRow[])

    // Persist
    const updates = reordered.map((id, i) => ({ id, position: i }))
    try {
      await onReorder(updates)
    } catch {
      setLocalRows(localRows) // rollback on error
    }
  }, [flatNodes, localRows, onReorder])

  if (rows.length === 0) return null

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={visible.map(n => n.row.id)} strategy={verticalListSortingStrategy}>
        <div>
          {visible.map(node => {
            const hasChildren = node.children.length > 0
            return (
              <SortableRow
                key={node.row.id}
                node={node}
                orderable={orderable}
                expanded={expanded.has(node.row.id)}
                hasChildren={hasChildren}
                onToggle={toggleExpand}
                onClick={(id) => navigate(`/${workspaceId}/objects/${typeName}/${id}`)}
              />
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
