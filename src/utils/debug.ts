export type DebugValue = string | number | boolean | null

export interface DebugLogSink {
  info(message: string): void
}

export class DebugTracer {
  constructor(
    readonly enabled: boolean,
    private readonly logger: DebugLogSink,
  ) {}

  event(name: string, details: Record<string, DebugValue> = {}) {
    if (!this.enabled) return
    const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''
    this.logger.info(`[mai-plugin:debug] ${name}${suffix}`)
  }

  failure(name: string, error: unknown, details: Record<string, DebugValue> = {}) {
    this.event(name, {
      ...details,
      errorType: error instanceof Error ? error.name : typeof error,
    })
  }
}
