'use client'
import React from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { cx } from './utils'

const Accordion = AccordionPrimitive.Root

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item ref={ref} className={cx('border-b border-border', className)} {...props} />
))
AccordionItem.displayName = 'AccordionItem'

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cx(
        // Radix sets data-state="open"|"closed" on this element
        'group flex flex-1 items-center gap-2 w-full px-4 py-3 text-xs font-medium transition-colors text-left',
        'text-fg-muted hover:text-fg hover:bg-surface-hover',
        'data-[state=open]:text-fg data-[state=open]:bg-surface-selected data-[state=open]:border-b data-[state=open]:border-border-subtle',
        className,
      )}
      {...props}
    >
      <span className="flex-1">{children}</span>
      {/* ▾ mirrors sidebar accordion chevron exactly - rotate + recolour when open */}
      <span className="text-xs transition-transform duration-150 text-fg-subtle group-data-[state=open]:rotate-180 group-data-[state=open]:text-accent">▾</span>
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
))
AccordionTrigger.displayName = 'AccordionTrigger'

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="overflow-hidden data-[state=open]:animate-[accordion-down_150ms_ease-out] data-[state=closed]:animate-[accordion-up_150ms_ease-out]"
    {...props}
  >
    <div className={cx('px-4 pt-3 pb-4', className)}>{children}</div>
  </AccordionPrimitive.Content>
))
AccordionContent.displayName = 'AccordionContent'

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
