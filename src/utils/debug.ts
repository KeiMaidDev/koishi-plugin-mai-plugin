import { inspect } from 'node:util'

export type DebugValue = unknown

export interface DebugLogSink {
  info(message: string): void
}

const inspectOptions = {
  depth: null,
  maxArrayLength: null,
  maxStringLength: null,
  breakLength: 120,
  compact: false,
} as const

export class DebugTracer {
  constructor(
    readonly enabled: boolean,
    private readonly logger: DebugLogSink,
  ) {}

  event(name: string, details?: DebugValue) {
    if (!this.enabled) return
    const suffix = details === undefined ? '' : ` ${inspect(details, inspectOptions)}`
    this.logger.info(`[mai-plugin:debug] ${name}${suffix}`)
  }

  failure(name: string, error: unknown, details: Record<string, DebugValue> = {}) {
    this.event(name, {
      ...details,
      error,
    })
  }
}
