export const RENDER_QUEUE_FULL_MESSAGE = '当前图片生成繁忙，请稍后重试'

export type SemaphoreRelease = () => void

interface Waiter {
  resolve: (release: SemaphoreRelease) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

function abortReason(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error(signal.reason === undefined ? 'The operation was aborted' : String(signal.reason))
  error.name = 'AbortError'
  return error
}

export class Semaphore {
  private activeCount = 0
  private readonly waiters: Waiter[] = []

  constructor(
    readonly capacity: number,
    readonly queueLimit: number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Semaphore capacity must be a positive integer')
    }
    if (!Number.isInteger(queueLimit) || queueLimit < 0) {
      throw new RangeError('Semaphore queue limit must be a non-negative integer')
    }
  }

  get active() {
    return this.activeCount
  }

  get pending() {
    return this.waiters.length
  }

  acquire(signal?: AbortSignal): Promise<SemaphoreRelease> {
    if (signal?.aborted) return Promise.reject(abortReason(signal))
    if (this.activeCount < this.capacity) {
      this.activeCount++
      return Promise.resolve(this.createRelease())
    }
    if (this.waiters.length >= this.queueLimit) {
      return Promise.reject(new Error(RENDER_QUEUE_FULL_MESSAGE))
    }

    return new Promise<SemaphoreRelease>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index === -1) return
          this.waiters.splice(index, 1)
          this.removeAbortListener(waiter)
          reject(abortReason(signal))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  clear(reason: unknown = new Error('Semaphore queue cleared')) {
    for (const waiter of this.waiters.splice(0)) {
      this.removeAbortListener(waiter)
      waiter.reject(reason)
    }
  }

  private removeAbortListener(waiter: Waiter) {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
    }
  }

  private createRelease(): SemaphoreRelease {
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeCount--
      this.dispatch()
    }
  }

  private dispatch() {
    while (this.activeCount < this.capacity) {
      const waiter = this.waiters.shift()
      if (!waiter) return
      this.removeAbortListener(waiter)
      this.activeCount++
      waiter.resolve(this.createRelease())
    }
  }
}
