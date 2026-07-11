import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";
import type { AuditRecord } from "./types";

/** Every policy decision is auditable. Sinks are pluggable for testing. */
export interface AuditSink {
  record(rec: AuditRecord): void;
}

/** Keeps records in memory — used by tests and available for introspection. */
export class MemoryAuditSink implements AuditSink {
  readonly records: AuditRecord[] = [];
  record(rec: AuditRecord): void {
    this.records.push(rec);
  }
}

/** Appends each decision as one JSON line to an audit file (best-effort). */
export class FileAuditSink implements AuditSink {
  constructor(private readonly filePath: string) {
    // Ensure the directory exists up front so records aren't silently dropped.
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (err) {
      logger.warn({ err }, "Could not create policy audit directory");
    }
  }
  record(rec: AuditRecord): void {
    fs.appendFile(this.filePath, JSON.stringify(rec) + "\n", (err) => {
      if (err) logger.warn({ err }, "Failed to append policy audit record");
    });
  }
}
