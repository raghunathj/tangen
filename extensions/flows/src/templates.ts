/**
 * File Name: templates.ts
 * Purpose: Starter flow templates - the "don't start from a blank canvas"
 *          lever that makes automation approachable for non-developers.
 *          Each is a complete FlowDef minus enabled (users review first).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FlowDef } from './engine/types'

export interface FlowTemplate {
  id: string
  title: string
  summary: string
  flow: Omit<FlowDef, 'updatedBy' | 'updatedAt'>
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'daily-draft-report',
    title: 'Daily draft report',
    summary: 'Every weekday morning, count the posts still in draft and email a reminder. Schedule → query/count → email.',
    flow: {
      version: 2, name: 'Daily draft report', enabled: false,
      nodes: [
        { id: 't', kind: 'trigger', position: { x: 260, y: 40 }, data: { type: 'schedule', schedule: { frequency: 'weekly', daysOfWeek: [1, 2, 3, 4, 5], hour: 9, minute: 0, timezone: 'UTC' } } },
        { id: 'q', kind: 'action', position: { x: 260, y: 190 }, data: { action: 'query', config: { typeName: 'post', status: 'draft', limit: 100 } } },
        { id: 'c', kind: 'condition', position: { x: 260, y: 340 }, data: { conditions: [{ path: 'steps.q.output.count', op: 'gt', value: 0 }] } },
        { id: 'e', kind: 'action', position: { x: 160, y: 490 }, data: { action: 'email', config: { to: '', subject: '{{steps.q.output.count}} posts in draft', html: '<p><strong>{{steps.q.output.count}}</strong> posts are still in draft.</p>' } } },
      ],
      edges: [
        { id: 'e1', from: 't', to: 'q' },
        { id: 'e2', from: 'q', to: 'c' },
        { id: 'e3', from: 'c', to: 'e', outlet: 'yes' },
      ],
    } as never,
  },
  {
    id: 'first-publish-once',
    title: 'Do something once, on first publish',
    summary: 'Runs an action the first time an item is published, then tags it so it never runs again - the run-once pattern with labels.',
    flow: {
      version: 2, name: 'First-publish action', enabled: false,
      nodes: [
        { id: 't', kind: 'trigger', position: { x: 260, y: 40 }, data: { type: 'object.published', conditions: [{ path: 'trigger.labels', op: 'not_contains', value: 'flow-done' }] } },
        { id: 'a', kind: 'action', position: { x: 260, y: 200 }, data: { action: 'log', config: { message: 'First publish of {{trigger.data.title}}' } } },
        { id: 'tag', kind: 'action', position: { x: 260, y: 350 }, data: { action: 'label', config: { entityKind: 'content', typeName: '{{trigger.typeName}}', entityId: '{{trigger.objectId}}', addLabels: ['flow-done'] } } },
      ],
      edges: [
        { id: 'e1', from: 't', to: 'a' },
        { id: 'e2', from: 'a', to: 'tag' },
      ],
    } as never,
  },
  {
    id: 'triage-by-switch',
    title: 'Triage by switch (branched)',
    summary: 'Routes published content by a field value - gold gets a webhook, everything else a log line. Opens on the canvas.',
    flow: {
      version: 2, name: 'Triage by switch', enabled: false,
      description: 'Switch on trigger.data.tier - case gold vs default.',
      nodes: [
        { id: 'start', kind: 'trigger', position: { x: 220, y: 40 }, data: { type: 'object.published' } },
        { id: 'sw', kind: 'switch', position: { x: 220, y: 180 }, data: { path: 'trigger.data.tier', cases: ['gold'] } },
        { id: 'gold', kind: 'action', position: { x: 60, y: 330 }, data: { action: 'http', config: { method: 'POST', url: 'https://hooks.example.com/replace-me', body: { vip: '{{trigger.payload.title}}' } } } },
        { id: 'rest', kind: 'action', position: { x: 400, y: 330 }, data: { action: 'log', config: { message: 'Not gold: {{trigger.payload.title}}' } } },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'sw' },
        { id: 'e2', from: 'sw', to: 'gold', outlet: 'case:gold' },
        { id: 'e3', from: 'sw', to: 'rest', outlet: 'default' },
      ],
    } as never,
  },
  {
    id: 'notify-on-publish',
    title: 'Notify a webhook when content publishes',
    summary: 'POSTs title + link data to any URL (Slack webhook, Zapier hook, your API) each time content goes live.',
    flow: {
      version: 1, name: 'Notify on publish', enabled: false,
      description: 'Sends every publish to an external webhook.',
      trigger: { type: 'object.published' },
      conditions: [],
      steps: [{
        id: 'step_1', action: 'http',
        config: {
          method: 'POST', url: 'https://hooks.example.com/replace-me',
          body: { event: 'published', title: '{{trigger.payload.title}}', type: '{{trigger.typeName}}', id: '{{trigger.objectId}}' },
        },
      }],
    },
  },
  {
    id: 'feature-big-ticket',
    title: 'Auto-feature high-value items',
    summary: 'When published content has a price above a threshold, set its featured field - the VIP-tagging pattern.',
    flow: {
      version: 1, name: 'Feature big-ticket items', enabled: false,
      description: 'Marks expensive items featured on publish.',
      trigger: { type: 'object.published' },
      conditions: [{ path: 'trigger.data.price', op: 'gt', value: 500 }],
      steps: [{
        id: 'step_1', action: 'content',
        config: { typeName: '{{trigger.typeName}}', objectId: '{{trigger.objectId}}', fields: { featured: true } },
      }],
    },
  },
  {
    id: 'log-media-uploads',
    title: 'Keep a note of media uploads',
    summary: 'Writes a run-log entry per upload - the simplest flow; a safe first automation to try.',
    flow: {
      version: 1, name: 'Log media uploads', enabled: false,
      description: 'One log line per uploaded asset.',
      trigger: { type: 'media.uploaded' },
      conditions: [],
      steps: [{ id: 'step_1', action: 'log', config: { message: 'Media uploaded: {{trigger.payload.filename}}' } }],
    },
  },
]
