/**
 * Simple semaphore to cap concurrent Cursor CLI invocations.
 */
export class RequestSemaphore {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  /**
   * Acquire a slot, waiting if the limit is reached.
   */
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1
      return
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
    this.active += 1
  }

  /**
   * Release a slot and wake the next waiter.
   */
  release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) next()
  }

  /**
   * Run a function while holding a concurrency slot.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
