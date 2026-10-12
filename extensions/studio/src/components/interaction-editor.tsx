/**
 * File Name: interaction-editor.tsx
 * Purpose: Authoring one Interaction on a class - Tier 1 or Tier 2 under a
 *          single Type control.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Tier 1 (load, enter-view, hover, focus) compiles to
 *          CSS; Tier 2 (scroll scrub, timeline, reverse on leave, count up)
 *          is interpreted by a module the runtime loads only for pages that
 *          declare one. The designer picks a type and never sees the tier -
 *          the cost is the runtime's concern, not theirs.
 *
 *          Every control draws from the schema's closed vocabulary and the
 *          defaults in lib/interaction-defaults.ts, which the test suite runs
 *          through the server's own normaliser. Nothing here can create a
 *          declaration the server then refuses.
 *
 *          Called Interactions - not Experiences, not Animation.
 */
import { clsx } from 'clsx'
import {
  INTERACTION_ACTIONS, EASINGS, DEFAULT_DURATION_MS, MAX_DURATION_MS,
  VIEW_RANGES, SCROLL_AXES, STAGGER_ORIGINS, MAX_TIER2_STEPS,
  type AnyInteraction, type Interaction, type InteractionAction, type Easing,
  type Tier2Scrub, type Tier2Timeline, type Tier2ReverseOnLeave, type Tier2CountUp, type Tier2Keyframe, type Tier2Step,
} from '@tangen/studio-schema'
import { InspectorRow, CONTROL_CLS, CompactSelect } from './inspector-row'
import {
  INTERACTION_TYPES, INTERACTION_TYPE_LABEL, interactionType, defaultInteraction, type InteractionType,
} from '../lib/interaction-defaults'

interface InteractionEditorProps {
  className: string
  value: AnyInteraction | null | undefined
  onChange: (next: AnyInteraction | null) => void
  disabled?: boolean
}

const ACTION_LABEL: Record<InteractionAction, string> = {
  'fade-in': 'Fade in', 'slide-up': 'Slide up', 'slide-down': 'Slide down',
  'slide-left': 'Slide left', 'slide-right': 'Slide right', 'scale-in': 'Scale in',
}

const clampMs = (raw: string, fallback: number, max = MAX_DURATION_MS) => {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : fallback
}
const num = (raw: string, fallback: number) => { const n = Number(raw); return Number.isFinite(n) ? n : fallback }

function Ms({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <InspectorRow label={label} layout="inline">
      <div className="flex items-center gap-1">
        <input type="number" min={0} max={max ?? MAX_DURATION_MS} step={50} value={value}
          onChange={(e) => onChange(clampMs(e.target.value, value, max))} className={CONTROL_CLS} />
        <span className="text-[10px] text-fg-subtle">ms</span>
      </div>
    </InspectorRow>
  )
}

function EasingRow({ value, onChange }: { value: Easing; onChange: (v: Easing) => void }) {
  return (
    <InspectorRow label="Easing" layout="inline">
      <CompactSelect value={value} options={EASINGS.map((e) => ({ label: e, value: e }))} onChange={(v) => onChange(v as Easing)} />
    </InspectorRow>
  )
}

/** Start and end of a movement: opacity and a transform, two stops. */
function Keyframes({ value, onChange }: { value: Tier2Keyframe[]; onChange: (v: Tier2Keyframe[]) => void }) {
  const stops = value.length >= 2 ? value : [value[0] ?? {}, value[1] ?? value[0] ?? {}]
  const set = (i: number, patch: Tier2Keyframe) => {
    const next = stops.map((k, j) => (j === i ? { ...k, ...patch } : k))
    onChange(next)
  }
  return (
    <>
      {(['Start', 'End'] as const).map((label, i) => (
        <InspectorRow key={label} label={label} layout="inline">
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={1} step={0.1} title="Opacity"
              value={stops[i].opacity ?? ''} placeholder="opacity"
              onChange={(e) => set(i, { opacity: e.target.value === '' ? undefined : Math.min(1, Math.max(0, num(e.target.value, 1))) })}
              className={clsx(CONTROL_CLS, 'w-16')} />
            <input type="text" title="Transform, e.g. translateY(24px)"
              value={stops[i].transform ?? ''} placeholder="transform"
              onChange={(e) => set(i, { transform: e.target.value || undefined })}
              className={CONTROL_CLS} />
          </div>
        </InspectorRow>
      ))}
    </>
  )
}

export function InteractionEditor({ className, value, onChange, disabled }: InteractionEditorProps) {
  const type = interactionType(value)

  if (!value || !type) {
    return (
      <button type="button" disabled={disabled}
        onClick={() => onChange(defaultInteraction('enter-view', className) as unknown as AnyInteraction)}
        className={clsx(
          'w-full h-(--tg-control-h) rounded-md border border-dashed border-border text-(length:--tg-text-control) text-fg-muted',
          'hover:border-accent hover:text-fg transition-colors duration-(--tg-motion-fast)',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        Add an interaction
      </button>
    )
  }

  const setType = (t: InteractionType) => {
    if (t !== type) onChange(defaultInteraction(t, className) as unknown as AnyInteraction)
  }
  const patch = (p: Record<string, unknown>) => onChange({ ...(value as unknown as Record<string, unknown>), ...p } as unknown as AnyInteraction)

  return (
    <div className="space-y-1.5">
      <InspectorRow label="Type" layout="inline">
        <CompactSelect value={type}
          options={INTERACTION_TYPES.map((t) => ({ label: INTERACTION_TYPE_LABEL[t], value: t }))}
          onChange={(v) => setType(v as InteractionType)} />
      </InspectorRow>

      {type === 'load' || type === 'enter-view' || type === 'hover' || type === 'focus' ? (() => {
        const v = value as Interaction
        return (
          <>
            <InspectorRow label="Motion" layout="inline">
              <CompactSelect value={v.action}
                options={INTERACTION_ACTIONS.map((a) => ({ label: ACTION_LABEL[a], value: a }))}
                onChange={(a) => patch({ action: a as InteractionAction })} />
            </InspectorRow>
            <Ms label="Duration" value={v.duration} onChange={(d) => patch({ duration: d || DEFAULT_DURATION_MS })} />
            <Ms label="Delay" value={v.delay} onChange={(d) => patch({ delay: d })} />
            <EasingRow value={v.easing} onChange={(e) => patch({ easing: e })} />
          </>
        )
      })() : null}

      {type === 'scrub' ? (() => {
        const v = value as Tier2Scrub
        return (
          <>
            <InspectorRow label="Driven by" layout="inline">
              <CompactSelect value={v.view ? 'view' : 'scroll'}
                options={[{ label: 'This element entering view', value: 'view' }, { label: 'Page scroll', value: 'scroll' }]}
                onChange={(x) => patch({ view: x === 'view' })} />
            </InspectorRow>
            <InspectorRow label="Axis" layout="inline">
              <CompactSelect value={v.axis} options={SCROLL_AXES.map((a) => ({ label: a, value: a }))} onChange={(a) => patch({ axis: a })} />
            </InspectorRow>
            <InspectorRow label="From" layout="inline">
              <CompactSelect value={v.rangeStart} options={VIEW_RANGES.map((r) => ({ label: r, value: r }))} onChange={(r) => patch({ rangeStart: r })} />
            </InspectorRow>
            <InspectorRow label="To" layout="inline">
              <CompactSelect value={v.rangeEnd} options={VIEW_RANGES.map((r) => ({ label: r, value: r }))} onChange={(r) => patch({ rangeEnd: r })} />
            </InspectorRow>
            <Keyframes value={v.keyframes} onChange={(k) => patch({ keyframes: k })} />
            <EasingRow value={v.easing} onChange={(e) => patch({ easing: e })} />
          </>
        )
      })() : null}

      {type === 'reverse-on-leave' ? (() => {
        const v = value as Tier2ReverseOnLeave
        return (
          <>
            <Keyframes value={v.keyframes} onChange={(k) => patch({ keyframes: k })} />
            <Ms label="Duration" value={v.duration} onChange={(d) => patch({ duration: d || DEFAULT_DURATION_MS })} />
            <EasingRow value={v.easing} onChange={(e) => patch({ easing: e })} />
            <InspectorRow label="Visible" layout="inline">
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={1} step={0.1} value={v.threshold}
                  onChange={(e) => patch({ threshold: Math.min(1, Math.max(0, num(e.target.value, v.threshold))) })} className={CONTROL_CLS} />
                <span className="text-[10px] text-fg-subtle">of it</span>
              </div>
            </InspectorRow>
          </>
        )
      })() : null}

      {type === 'count-up' ? (() => {
        const v = value as Tier2CountUp
        return (
          <>
            <InspectorRow label="From" layout="inline">
              <input type="number" value={v.from} onChange={(e) => patch({ from: num(e.target.value, v.from) })} className={CONTROL_CLS} />
            </InspectorRow>
            <InspectorRow label="To" layout="inline">
              <input type="number" value={v.to} onChange={(e) => patch({ to: num(e.target.value, v.to) })} className={CONTROL_CLS} />
            </InspectorRow>
            <Ms label="Duration" value={v.duration} onChange={(d) => patch({ duration: d || 1200 })} max={10_000} />
            <InspectorRow label="Decimals" layout="inline">
              <input type="number" min={0} max={4} value={v.maximumFractionDigits ?? 0}
                onChange={(e) => patch({ maximumFractionDigits: Math.min(4, Math.max(0, Math.round(num(e.target.value, 0)))) })} className={CONTROL_CLS} />
            </InspectorRow>
            <InspectorRow label="Locale" layout="inline">
              <input type="text" value={v.locale ?? ''} placeholder="en-IN" onChange={(e) => patch({ locale: e.target.value || undefined })} className={CONTROL_CLS} />
            </InspectorRow>
          </>
        )
      })() : null}

      {type === 'timeline' ? (() => {
        const v = value as Tier2Timeline
        const setStep = (i: number, p: Partial<Tier2Step>) => patch({ steps: v.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) })
        return (
          <div className="space-y-2">
            {v.steps.map((s, i) => (
              <div key={i} className="rounded-md border border-border p-1.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Step {i + 1}</span>
                  {v.steps.length > 1 && (
                    <button type="button" onClick={() => patch({ steps: v.steps.filter((_, j) => j !== i) })}
                      className="text-[10px] text-fg-subtle hover:text-danger">Remove</button>
                  )}
                </div>
                <InspectorRow label="Target" layout="inline">
                  <input type="text" value={s.className} placeholder={className}
                    onChange={(e) => setStep(i, { className: e.target.value || className })} className={CONTROL_CLS} />
                </InspectorRow>
                <Keyframes value={s.keyframes} onChange={(k) => setStep(i, { keyframes: k })} />
                <Ms label="Duration" value={s.duration} onChange={(d) => setStep(i, { duration: d || DEFAULT_DURATION_MS })} />
                <InspectorRow label="Starts" layout="inline">
                  <CompactSelect value={s.at === undefined ? 'after' : String(s.at)}
                    options={[{ label: 'After previous', value: 'after' }, { label: 'With previous', value: '<' }, { label: 'At previous end', value: '>' }]}
                    onChange={(x) => setStep(i, { at: x === 'after' ? undefined : (x as '<' | '>') })} />
                </InspectorRow>
                <Ms label="Stagger" value={s.stagger ?? 0} onChange={(d) => setStep(i, { stagger: d || undefined })} max={1000} />
                {s.stagger ? (
                  <InspectorRow label="From" layout="inline">
                    <CompactSelect value={s.staggerFrom ?? 'first'} options={STAGGER_ORIGINS.map((o) => ({ label: o, value: o }))}
                      onChange={(o) => setStep(i, { staggerFrom: o as Tier2Step['staggerFrom'] })} />
                  </InspectorRow>
                ) : null}
                <EasingRow value={s.easing} onChange={(e) => setStep(i, { easing: e })} />
              </div>
            ))}
            {v.steps.length < MAX_TIER2_STEPS && (
              <button type="button"
                onClick={() => patch({ steps: [...v.steps, { className, keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: DEFAULT_DURATION_MS, easing: EASINGS[0] }] })}
                className="w-full h-6 rounded-md border border-dashed border-border text-[11px] text-fg-muted hover:border-accent hover:text-fg transition-colors duration-(--tg-motion-fast)">
                Add step
              </button>
            )}
          </div>
        )
      })() : null}

      <button type="button" disabled={disabled} onClick={() => onChange(null)}
        className="text-[11px] text-fg-subtle hover:text-danger transition-colors duration-(--tg-motion-fast)">
        Remove interaction
      </button>
    </div>
  )
}
