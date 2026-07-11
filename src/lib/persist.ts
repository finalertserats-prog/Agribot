import fs from "fs";
import path from "path";
import { logger } from "./logger";

let tmpCounter = 0;

/**
 * Atomically write bytes to `filePath`: write to a unique temp file in the same
 * directory, then rename over the target. Rename is atomic on the same volume,
 * so a reader/crash mid-write never sees a torn (half-written) file. Note: this
 * does not fsync, so a power-loss immediately after write can still lose the
 * newest data — it guarantees consistency, not durability. The temp name
 * includes a per-process monotonic counter so overlapping writes to the same
 * target never share a temp path.
 */
export async function atomicWrite(
  filePath: string,
  data: Uint8Array | string
): Promise<void> {
  const dir = path.dirname(filePath);
  const unique = `${process.pid}.${tmpCounter++}`;
  const tmp = path.join(dir, `.${path.basename(filePath)}.${unique}.tmp`);
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, filePath);
}

export interface DebouncedSaver {
  /** Request a save; coalesces rapid calls into one write after `delayMs`. */
  schedule(): void;
  /** Force any pending save to run now and await completion. */
  flush(): Promise<void>;
}

/**
 * Coalesce frequent save requests into at most one async write per `delayMs`,
 * and serialize writes so only one `save()` runs at a time (chained onto a
 * single promise). Avoids the original pattern of a full synchronous file
 * rewrite on every message, and prevents overlapping writes to the same file.
 */
export function createDebouncedSaver(
  save: () => Promise<void>,
  delayMs: number
): DebouncedSaver {
  let timer: NodeJS.Timeout | null = null;
  let pending = false;
  let chain: Promise<void> = Promise.resolve();
  let lastError: unknown = null;

  // Enqueue the pending save onto the serialized chain (if any is pending).
  // Errors are caught so one failure never wedges future saves, but they are
  // recorded so flush() can surface them — a failed write must not look like a
  // successful flush (that would mask data loss on shutdown).
  const trigger = (): void => {
    timer = null;
    if (!pending) return;
    pending = false;
    chain = chain.then(async () => {
      try {
        await save();
        lastError = null;
      } catch (err) {
        lastError = err;
        logger.error({ err }, "Debounced save failed");
      }
    });
  };

  return {
    schedule(): void {
      pending = true;
      if (timer) return;
      timer = setTimeout(trigger, delayMs);
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        trigger();
      }
      await chain;
      if (lastError !== null) {
        const err = lastError;
        lastError = null;
        throw err;
      }
    },
  };
}
