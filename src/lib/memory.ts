import { config } from "../config";
import { atomicWrite, createDebouncedSaver, type DebouncedSaver } from "./persist";
import { getProvider, withRetry } from "./llm";
import { logger } from "./logger";
import path from "path";
import fs from "fs";

interface VectorEntry {
  text: string;
  userId: string;
  groupId: string;
  timestamp: string;
  embedding: number[];
}

let entries: VectorEntry[] = [];
let ready = false;
let binPath: string;
let saver: DebouncedSaver;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function initMemory(): void {
  const dir = path.dirname(config.vectorPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Namespace the store by provider: embedding dimensions differ between
  // backends (e.g. Gemini text-embedding-004 vs OpenAI text-embedding-3), so a
  // provider switch must not compare vectors against another backend's memories.
  binPath = `${config.vectorPath}_${config.llm.provider}_entries.json`;
  ready = true;

  if (fs.existsSync(binPath)) {
    try {
      entries = JSON.parse(fs.readFileSync(binPath, "utf-8"));
    } catch (err) {
      logger.warn({ err }, "Failed to parse vector store; starting empty");
      entries = [];
    }
  }

  saver = createDebouncedSaver(async () => {
    // Compact JSON (no indentation) keeps the file small as it grows.
    await atomicWrite(binPath, JSON.stringify(entries));
  }, config.persistDebounceMs);
}

/** Flush any pending vector-store write to disk. Call on graceful shutdown. */
export async function flushMemory(): Promise<void> {
  if (saver) await saver.flush();
}

/** Erase all vector memories for a farmer (part of the DELETE / erasure flow). */
export async function deleteUserMemories(userId: string): Promise<void> {
  // Active (in-memory) provider's store.
  const before = entries.length;
  entries = entries.filter((e) => e.userId !== userId);
  if (entries.length !== before && saver) {
    saver.schedule();
    await saver.flush();
  }

  // Also purge any OTHER provider's on-disk vector store — stores are namespaced
  // per provider, so erasure must be complete even if the bot ran under a
  // different provider before. Best-effort; never throws out of an erasure.
  try {
    const dir = path.dirname(config.vectorPath);
    const base = path.basename(config.vectorPath); // "vectors"
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.startsWith(`${base}_`) || !file.endsWith("_entries.json")) continue;
      const full = path.join(dir, file);
      if (full === binPath) continue; // active store already handled above
      try {
        const raw = JSON.parse(fs.readFileSync(full, "utf-8"));
        if (!Array.isArray(raw)) continue;
        const kept = raw.filter((e: VectorEntry) => e && e.userId !== userId);
        if (kept.length !== raw.length) await atomicWrite(full, JSON.stringify(kept));
      } catch (err) {
        logger.warn({ err, file }, "Failed to purge user from a sibling vector store");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to scan vector dir during erasure");
  }
}

async function getEmbedding(text: string): Promise<number[]> {
  // Retry on transient 429s so a rate-limit blip doesn't silently drop a memory.
  // Provider-agnostic: whichever backend is configured supplies the vector.
  return withRetry(() => getProvider().embed(text));
}

export async function storeMemory(
  text: string,
  userId: string,
  groupId: string
): Promise<void> {
  if (!ready) return;

  const embedding = await getEmbedding(text);

  entries.push({
    text,
    userId,
    groupId,
    timestamp: new Date().toISOString(),
    embedding,
  });

  pruneUser(userId);
  saver.schedule();
}

/**
 * Keep only the most recent `maxMemoriesPerUser` entries per user so the store
 * (and the per-query scan) stay bounded regardless of how long a user chats.
 */
function pruneUser(userId: string): void {
  const userIdxs = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.userId === userId);

  if (userIdxs.length <= config.maxMemoriesPerUser) return;

  // Oldest first; drop everything beyond the cap.
  userIdxs.sort((a, b) => a.e.timestamp.localeCompare(b.e.timestamp));
  const dropCount = userIdxs.length - config.maxMemoriesPerUser;
  const dropIdxs = new Set(userIdxs.slice(0, dropCount).map((x) => x.i));
  entries = entries.filter((_, i) => !dropIdxs.has(i));
}

export async function queryMemory(
  query: string,
  userId: string,
  limit = 3
): Promise<string[]> {
  if (!ready) return [];

  // Filter to THIS user first — never embed the query or score other users'
  // memories. Also skip the (paid) embedding call entirely when the user has
  // too few memories for retrieval to add value over recent-history context.
  const userEntries = entries.filter((e) => e.userId === userId);
  if (userEntries.length < config.memoryQueryMinEntries) return [];

  const queryEmbedding = await getEmbedding(query);

  return userEntries
    .map((entry) => ({
      text: entry.text,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.text);
}
