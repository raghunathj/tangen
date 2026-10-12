import React from 'react'
import { cx } from './utils'

const TableRoot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className="flex min-h-0 flex-col">
      {/* The table's own viewport (calibration, "Lists"): as tall as its rows,
          and no taller than the column a flex parent leaves it, when it scrolls
          alone under a sticky header. So what follows (pagination) sits right
          under a short table and at the window's edge under a long one. */}
      <div className={cx('min-h-0 w-full overflow-auto whitespace-nowrap', className)} {...props}>
        {children}
      </div>
    </div>
  ),
)
TableRoot.displayName = 'TableRoot'

const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cx('w-full caption-bottom text-ui-sm', className)} {...props} />
  ),
)
Table.displayName = 'Table'

const TableHead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cx('sticky top-0 z-[1]', className)} {...props} />,
)
TableHead.displayName = 'TableHead'

const TableHeaderCell = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cx('h-(--tg-row-h) bg-surface px-3 text-left align-middle text-ui-sm font-normal text-fg-muted whitespace-nowrap shadow-[inset_0_-1px_0_0_var(--color-border)] border-r border-border-subtle last:border-r-0', className)}
      {...props}
    />
  ),
)
TableHeaderCell.displayName = 'TableHeaderCell'

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cx('divide-y divide-border', className)} {...props} />
  ),
)
TableBody.displayName = 'TableBody'

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cx('group/row bg-surface transition-colors motion-fast [&_td:last-child]:pr-[var(--tg-table-inset,1rem)] [&_th:last-child]:pr-[var(--tg-table-inset,1rem)] [&_td:first-child]:pl-[var(--tg-table-inset,1rem)] [&_th:first-child]:pl-[var(--tg-table-inset,1rem)]', className)}
      {...props}
    />
  ),
)
TableRow.displayName = 'TableRow'

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cx('h-(--tg-row-h) px-3 py-0 align-middle text-ui-sm text-fg-muted border-r border-border-subtle last:border-r-0', className)} {...props} />
  ),
)
TableCell.displayName = 'TableCell'

const TableFoot = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cx('border-t border-border-subtle text-left font-medium text-fg', className)} {...props} />
  ),
)
TableFoot.displayName = 'TableFoot'

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cx('mt-3 px-3 text-center text-ui-sm text-fg-muted', className)} {...props} />
  ),
)
TableCaption.displayName = 'TableCaption'

export { Table, TableRoot, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, TableFoot, TableCaption }
