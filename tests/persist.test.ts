import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { atomicWrite, createDebouncedSaver } from "../src/lib/persist";

const tmpFiles: string[] = [];
const tmpPath = (name: string): string => {
  const p = path.join(os.tmpdir(), `agri-test-${process.pid}-${name}`);
  tmpFiles.push(p);
  return p;
};

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
});

describe("atomicWrite", () => {
  it("writes the given content to the target path", async () => {
    const p = tmpPath("atomic.txt");
    await atomicWrite(p, "hello");
    expect(fs.readFileSync(p, "utf-8")).toBe("hello");
  });

  it("overwrites existing content", async () => {
    const p = tmpPath("atomic2.txt");
    await atomicWrite(p, "first");
    await atomicWrite(p, "second");
    expect(fs.readFileSync(p, "utf-8")).toBe("second");
  });
});

describe("createDebouncedSaver", () => {
  it("coalesces many schedule() calls into fewer saves", async () => {
    let saves = 0;
    const saver = createDebouncedSaver(async () => {
      saves++;
    }, 20);
    saver.schedule();
    saver.schedule();
    saver.schedule();
    await saver.flush();
    expect(saves).toBe(1);
  });

  it("flush runs a pending save even before the timer fires", async () => {
    let saved = false;
    const saver = createDebouncedSaver(async () => {
      saved = true;
    }, 10_000);
    saver.schedule();
    await saver.flush();
    expect(saved).toBe(true);
  });

  it("flush with nothing pending does not throw", async () => {
    const saver = createDebouncedSaver(async () => {}, 20);
    await expect(saver.flush()).resolves.toBeUndefined();
  });

  it("flush rethrows a save failure (so data loss is not hidden)", async () => {
    const saver = createDebouncedSaver(async () => {
      throw new Error("disk full");
    }, 10);
    saver.schedule();
    await expect(saver.flush()).rejects.toThrow("disk full");
  });

  it("a failed save does not wedge future saves", async () => {
    let attempt = 0;
    const saver = createDebouncedSaver(async () => {
      attempt++;
      if (attempt === 1) throw new Error("transient");
    }, 10);
    saver.schedule();
    await saver.flush().catch(() => {}); // first fails
    saver.schedule();
    await expect(saver.flush()).resolves.toBeUndefined(); // second succeeds
    expect(attempt).toBe(2);
  });

  it("serializes overlapping saves — never runs two at once", async () => {
    let active = 0;
    let maxActive = 0;
    const saver = createDebouncedSaver(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
    }, 5);
    saver.schedule();
    await new Promise((r) => setTimeout(r, 6)); // let first save start
    saver.schedule(); // schedule a second while first may still run
    await saver.flush();
    expect(maxActive).toBe(1);
  });
});
