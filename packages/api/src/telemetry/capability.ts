/**
 * File Name: capability.ts
 * Purpose: Telemetry as a normal Phase 3 capability (closure plan Phase 9C,
 *          Units 21 and 27), so the Phase 8A descriptor reports it like every
 *          other one and no second truth about "is telemetry on" exists.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `kind: 'demand'` and `required()` reading the same
 *          enablement the collector does: when telemetry is off nothing
 *          starts, nothing subscribes, and the bus stays on its free path.
 *          `/health` does not consult it - health answers "can this run now",
 *          telemetry answers "what has been happening", and making the first
 *          depend on the second would be the tail wagging the dog.
 */
import { runtimeRegistry, type RuntimeRegistry } from '../runtime/registry'
import { startTelemetry, stopTelemetry, telemetryEnabled } from './collector'

export function registerTelemetryCapability(registry: RuntimeRegistry = runtimeRegistry): void {
  registry.register({
    id: 'telemetry',
    label: 'Telemetry (recent operational events and metrics, in memory)',
    kind: 'demand',
    required: () => telemetryEnabled(),
    start: () => { startTelemetry() },
    stop: () => { stopTelemetry() },
  })
}
