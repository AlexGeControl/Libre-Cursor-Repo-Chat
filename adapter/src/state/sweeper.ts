import type { ConvStore } from "./conv-store.ts";

/**
 * Spec: ./sweeper.spec.md
 *
 * Lazy GC for the conv-state SQLite table. Periodically forgets
 * mappings whose `last_used_at` is older than `ttlMs`. We do NOT
 * touch Cursor-side state — that's handled by Cursor's own GC.
 * If a forgotten conversation gets a new message later, the
 * adapter's create-path-with-history (slice 2c rehydration) takes
 * over and the user sees seamless continuity.
 */

export interface SweeperLog {
  info: (obj: object, msg: string) => void;
  warn?: (obj: object, msg: string) => void;
}

export interface IdleSweeperOptions {
  store: ConvStore;
  ttlMs: number;
  intervalMs: number;
  /** Injectable clock for testability. Defaults to Date.now. */
  now?: () => number;
  log?: SweeperLog;
}

export interface IdleSweeperHandle {
  stop: () => void;
  /** Run one sweep synchronously. Returns the deleted convKeys. */
  sweepNow: () => string[];
}

export function startIdleSweeper(opts: IdleSweeperOptions): IdleSweeperHandle {
  const { store, ttlMs, intervalMs, log } = opts;
  const now = opts.now ?? Date.now;

  const sweepNow = (): string[] => {
    const beforeMs = now() - ttlMs;
    const deleted = store.deleteStale(beforeMs);
    if (log) {
      if (deleted.length > 0) {
        log.info(
          {
            deletedCount: deleted.length,
            sample: deleted.slice(0, 3),
            beforeMs,
          },
          "idle sweeper: removed stale conv mappings",
        );
      } else {
        log.info({ beforeMs }, "idle sweeper: no stale mappings");
      }
    }
    return deleted;
  };

  // .unref() so this timer never keeps the process alive on its own —
  // explicit shutdown still calls stop() for symmetry, but a crash or
  // abrupt exit won't hang waiting for the next tick.
  const handle = setInterval(sweepNow, intervalMs);
  handle.unref?.();

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(handle);
  };

  return { stop, sweepNow };
}
