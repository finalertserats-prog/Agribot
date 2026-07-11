import pino from "pino";
import { config } from "../config";

/**
 * Shared structured logger. All modules log through this so PM2 output is
 * consistent and greppable (replaces scattered console.log/console.error).
 */
export const logger = pino({
  level: config.logLevel,
  base: undefined, // omit pid/hostname noise in single-process VPS logs
});

export type Logger = typeof logger;
