import { config } from "../config";
import { logger } from "../lib/logger";
import { createPolicyEngine } from "../policy";
import { AutonomyEngine } from "./engine";
import { DEFAULT_TRIGGERS } from "./triggers";
import { ApprovalQueue } from "./approvalQueue";
import { DeliveryStore } from "./delivery";
import { LoggingTransport, type Transport } from "./transport";
import type { FarmerRecord, FarmerSource, WeatherAlert, WeatherSource } from "./types";

export * from "./types";
export { AutonomyEngine } from "./engine";
export { DEFAULT_TRIGGERS, seasonalTipTrigger, cropStageTrigger, weatherAlertTrigger } from "./triggers";
export { ApprovalQueue } from "./approvalQueue";
export { DeliveryStore } from "./delivery";
export { LoggingTransport, WhatsAppCloudTransport } from "./transport";

/** Simple in-memory sources for the scaffold; production reads the DB / weather API. */
export class InMemoryFarmerSource implements FarmerSource {
  constructor(private readonly farmers: FarmerRecord[] = []) {}
  list(): FarmerRecord[] {
    return this.farmers;
  }
}
export class StaticWeatherSource implements WeatherSource {
  constructor(private readonly current: WeatherAlert[] = []) {}
  alerts(): WeatherAlert[] {
    return this.current;
  }
}

export interface AutonomySources {
  farmers: FarmerSource;
  weather: WeatherSource;
  transport?: Transport;
}

/** Wire a full Autonomy Engine (proactive pipeline + policy gate). */
export function createAutonomyEngine(sources: AutonomySources) {
  // Memoize a farmerId -> tz map, rebuilt only when the source's list changes.
  let tzList: FarmerRecord[] | null = null;
  let tzMap = new Map<string, number>();
  const tzOffsetFor = (farmerId: string): number => {
    const current = sources.farmers.list();
    if (current !== tzList) {
      tzList = current;
      tzMap = new Map(
        current.filter((f) => f.tzOffsetMinutes != null).map((f) => [f.farmerId, f.tzOffsetMinutes!])
      );
    }
    return tzMap.get(farmerId) ?? config.policy.defaultTzOffsetMinutes;
  };

  const { engine: policy, consent, frequency, idempotency, audit } = createPolicyEngine({
    tzOffsetFor,
  });
  const queue = new ApprovalQueue();
  const delivery = new DeliveryStore();
  const engine = new AutonomyEngine({
    policy,
    triggers: DEFAULT_TRIGGERS,
    transport: sources.transport ?? new LoggingTransport(),
    queue,
    delivery,
    farmers: sources.farmers,
    weather: sources.weather,
  });
  return { engine, policy, queue, delivery, consent, frequency, idempotency, audit };
}

// Standalone entry: start the proactive scheduler. A real deployment injects a
// DB/API-backed FarmerSource + WeatherSource here; the scaffold starts empty.
if (require.main === module) {
  const { engine, consent } = createAutonomyEngine({
    farmers: new InMemoryFarmerSource([]),
    weather: new StaticWeatherSource([]),
  });
  void consent; // (production: seed consent from the DB)
  logger.info(
    { intervalMs: config.autonomy.schedulerIntervalMs },
    "Autonomy Engine started — proactive scheduler (every candidate passes the Policy Engine)"
  );
  engine.start(config.autonomy.schedulerIntervalMs);
  const stop = (): void => {
    engine.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
