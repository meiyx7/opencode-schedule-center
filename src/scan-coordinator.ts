/**
 * Result of one scan attempt. A failed background refresh is reported as such
 * so the view can keep the last good rows instead of treating it as a first
 * load failure.
 */
export type ScanOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: unknown; firstLoad: boolean }

/**
 * Coalesces every refresh entry point (initial load, timer, manual button,
 * post-mutation reconcile) into one in-flight scan. Deliberately pure logic —
 * no Solid signals, no DOM — so it can be tested with a controlled scan.
 */
export function createScanCoordinator<T>(scan: () => Promise<T>) {
  let inFlight: Promise<ScanOutcome<T>> | undefined
  let primed = false

  return {
    get busy(): boolean {
      return inFlight !== undefined
    },
    refresh(): Promise<ScanOutcome<T>> {
      // A second caller waits for the running scan instead of starting another
      // sweep, which also means no older request can overwrite a newer one.
      if (inFlight) return inFlight
      const firstLoad = !primed
      const attempt = scan().then(
        (data): ScanOutcome<T> => {
          primed = true
          inFlight = undefined
          return { ok: true, data }
        },
        (error): ScanOutcome<T> => {
          inFlight = undefined
          return { ok: false, error, firstLoad }
        },
      )
      inFlight = attempt
      return attempt
    },
  }
}
