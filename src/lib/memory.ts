import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";
import { atomicWrite, createDebouncedSaver, type DebouncedSaver } from "./persist";
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
let embeddingModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;
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
  if (!config.geminiApiKey) return;

  const dir = path.dirname(config.vectorPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  binPath = config.vectorPath + "_entries.json";

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

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

async function getEmbedding(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
}

export async function storeMemory(
  text: string,
  userId: string,
  groupId: string
): Promise<void> {
  if (!embeddingModel) return;

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
  if (!embeddingModel) return [];

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
