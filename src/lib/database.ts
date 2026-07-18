import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import { config } from "../config";
import { atomicWrite, createDebouncedSaver, type DebouncedSaver } from "./persist";
import { logger } from "./logger";
import path from "path";
import fs from "fs";

export interface UserRecord {
  id: string;
  name: string;
  groupId: string;
  plants: string;
  issues: string;
  location: string;
  firstSeen: string;
  lastSeen: string;
  phone: string;
}

export interface Interaction {
  id: number;
  userId: string;
  groupId: string;
  userName: string;
  message: string;
  response: string;
  hasImage: boolean;
  timestamp: string;
}

let db: SqlJsDatabase;
let dbPath: string;
let saver: DebouncedSaver;

export async function initDB(): Promise<void> {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  dbPath = config.dbPath;
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      groupId TEXT NOT NULL,
      plants TEXT DEFAULT '',
      issues TEXT DEFAULT '',
      location TEXT DEFAULT '',
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL,
      phone TEXT DEFAULT ''
    );
  `);

  // Migration: add the phone column to DBs created before it existed. ALTER
  // throws if the column is already present (fresh DBs), so ignore that.
  try {
    db.run("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");
  } catch {
    /* column already exists — nothing to do */
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      groupId TEXT NOT NULL,
      userName TEXT NOT NULL,
      message TEXT NOT NULL,
      response TEXT NOT NULL,
      hasImage INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL
    );
  `);

  // Durable opt-out ledger for the reactive path. A farmer who texts "STOP"
  // must stop receiving replies — and that decision has to survive a restart,
  // so it lives on disk, not in an in-memory Set that a crash would wipe.
  db.run(`
    CREATE TABLE IF NOT EXISTS optouts (
      userId TEXT PRIMARY KEY,
      at TEXT NOT NULL
    );
  `);

  saver = createDebouncedSaver(async () => {
    const data = db.export();
    await atomicWrite(dbPath, data);
  }, config.persistDebounceMs);

  // First write is immediate so the schema is on disk even if we crash early.
  await atomicWrite(dbPath, db.export());
}

function saveDB(): void {
  saver.schedule();
}

/** Flush any pending DB write to disk. Call on graceful shutdown. */
export async function flushDB(): Promise<void> {
  if (saver) await saver.flush();
}

export function upsertUser(
  id: string,
  name: string,
  groupId: string,
  extra?: Partial<Pick<UserRecord, "plants" | "issues" | "location">>
): void {
  const now = new Date().toISOString();
  const existing = db.exec("SELECT * FROM users WHERE id = ?", [id]);

  if (existing.length > 0 && existing[0].values.length > 0) {
    const row = existing[0].values[0];
    const plants = extra?.plants ?? (row[3] as string);
    const issues = extra?.issues ?? (row[4] as string);
    const location = extra?.location ?? (row[5] as string);
    // Don't clobber a real, model-captured name with the WhatsApp pushName (or
    // the "Farmer" fallback) on every message — keep the stored name unless we
    // still only have a placeholder.
    const currentName = row[1] as string;
    const keptName = currentName && currentName !== "Farmer" ? currentName : name;
    db.run("UPDATE users SET name = ?, plants = ?, issues = ?, location = ?, lastSeen = ? WHERE id = ?", [
      keptName, plants, issues, location, now, id,
    ]);
  } else {
    db.run(
      "INSERT INTO users (id, name, groupId, plants, issues, location, firstSeen, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, name, groupId, extra?.plants || "", extra?.issues || "", extra?.location || "", now, now]
    );
  }

  saveDB();
}

const MAX_PROFILE_FIELD = 120;

/**
 * Profile fields are model-extracted from untrusted user text and later
 * injected back into LLM prompts. Sanitize to blunt stored prompt-injection:
 * strip control chars/newlines, collapse whitespace, and cap length.
 */
export function sanitizeProfileField(value: string | undefined): string {
  if (!value) return "";
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROFILE_FIELD);
}

/**
 * Union new comma-separated facts into the existing set, de-duplicated
 * case-insensitively and length-capped. Used for multi-valued fields
 * (plants, issues) so opportunistic extraction accumulates rather than
 * overwrites — a later "chilli" must not erase an earlier "tomatoes, okra".
 */
export function mergeFacts(existing: string, incoming: string | undefined): string {
  const clean = sanitizeProfileField(incoming);
  if (!clean) return existing;

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const tok of `${existing}, ${clean}`.split(",").map((t) => t.trim())) {
    if (!tok) continue;
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(tok);
  }
  return tokens.join(", ").slice(0, MAX_PROFILE_FIELD);
}

/**
 * Merge extracted profile facts into an existing user. Multi-valued fields
 * (plants, issues) accumulate; location is single-valued so the most recent
 * stated value wins. Blank/undefined fields leave stored values untouched so
 * we never erase known context with an empty extraction.
 */
export function updateUserProfile(
  id: string,
  profile: Partial<Pick<UserRecord, "name" | "phone" | "plants" | "issues" | "location">>
): void {
  const existing = getUser(id);
  if (!existing) return;

  const plants = mergeFacts(existing.plants, profile.plants);
  const issues = mergeFacts(existing.issues, profile.issues);
  const location = sanitizeProfileField(profile.location) || existing.location;
  // Name and phone are single-valued; a freshly-stated value wins, but never
  // overwrite a known value with an empty extraction.
  const name = sanitizeProfileField(profile.name) || existing.name;
  const phone = sanitizeProfileField(profile.phone) || existing.phone;

  if (
    name === existing.name &&
    phone === existing.phone &&
    plants === existing.plants &&
    issues === existing.issues &&
    location === existing.location
  ) {
    return; // nothing changed — skip the write
  }

  db.run("UPDATE users SET name = ?, phone = ?, plants = ?, issues = ?, location = ? WHERE id = ?", [
    name,
    phone,
    plants,
    issues,
    location,
    id,
  ]);
  saveDB();
}

/**
 * Erase everything we hold about a farmer (DELETE command / DPDP request):
 * their profile row, all interactions, and any opt-out record. Vector memories
 * are cleared separately via the memory module. Flushed immediately so the
 * erasure is durable before we confirm it.
 */
export async function deleteUserData(userId: string): Promise<void> {
  db.run("DELETE FROM users WHERE id = ?", [userId]);
  db.run("DELETE FROM interactions WHERE userId = ?", [userId]);
  db.run("DELETE FROM optouts WHERE userId = ?", [userId]);
  saveDB();
  await flushDB();
}

export function getUser(id: string): UserRecord | undefined {
  const result = db.exec("SELECT * FROM users WHERE id = ?", [id]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;

  const row = result[0].values[0];
  return {
    id: row[0] as string,
    name: row[1] as string,
    groupId: row[2] as string,
    plants: row[3] as string,
    issues: row[4] as string,
    location: row[5] as string,
    firstSeen: row[6] as string,
    lastSeen: row[7] as string,
    phone: (row[8] as string) ?? "",
  };
}

/**
 * Record an inbound opt-out. Idempotent — re-opting-out just refreshes the
 * timestamp. Flushed to disk synchronously (not via the debounced saver) before
 * resolving, so we never confirm "you're unsubscribed" to a farmer and then lose
 * that opt-out to a crash inside the debounce window. Losing a STOP is the one
 * failure this feature exists to prevent.
 */
export async function setOptOut(
  userId: string,
  now: string = new Date().toISOString()
): Promise<void> {
  db.run("INSERT OR REPLACE INTO optouts (userId, at) VALUES (?, ?)", [userId, now]);
  saveDB(); // schedule the write, then force it to disk now (don't wait for debounce)
  await flushDB();
}

/** Re-subscribe a farmer who previously opted out. Also flushed immediately so
 *  the welcome-back and the durable state can't disagree after a restart. */
export async function clearOptOut(userId: string): Promise<void> {
  db.run("DELETE FROM optouts WHERE userId = ?", [userId]);
  saveDB();
  await flushDB();
}

/** True if this farmer has an active opt-out on record. */
export function isOptedOut(userId: string): boolean {
  const result = db.exec("SELECT 1 FROM optouts WHERE userId = ?", [userId]);
  return result.length > 0 && result[0].values.length > 0;
}

export function saveInteraction(
  userId: string,
  groupId: string,
  userName: string,
  message: string,
  response: string,
  hasImage: boolean
): void {
  db.run(
    "INSERT INTO interactions (userId, groupId, userName, message, response, hasImage, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, groupId, userName, message, response, hasImage ? 1 : 0, new Date().toISOString()]
  );
  saveDB();
}

export function getRecentInteractions(userId: string, limit = 5): Interaction[] {
  // Order by id (autoincrement) rather than timestamp: rapid messages can share
  // a millisecond timestamp, and SQLite leaves ties in undefined order.
  const result = db.exec(
    "SELECT * FROM interactions WHERE userId = ? ORDER BY id DESC LIMIT ?",
    [userId, limit]
  );

  if (result.length === 0) return [];

  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    userId: row[1] as string,
    groupId: row[2] as string,
    userName: row[3] as string,
    message: row[4] as string,
    response: row[5] as string,
    hasImage: (row[6] as number) === 1,
    timestamp: row[7] as string,
  }));
}
