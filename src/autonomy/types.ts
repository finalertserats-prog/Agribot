import type { OutboundCandidate } from "../policy/types";

/** The autonomy view of a farmer — the facts triggers personalize from. */
export interface FarmerRecord {
  farmerId: string;
  tenantId: string;
  name: string;
  language: string; // e.g. "en", "hi"
  tzOffsetMinutes?: number;
  crop?: string;
  cropStage?: string; // e.g. "flowering"
  area?: string; // for weather targeting
  pastIssues?: string;
}

export interface WeatherAlert {
  area: string;
  alert: string; // e.g. "heavy rain expected tomorrow"
  action: string; // e.g. "delay spraying"
}

/** Everything a trigger needs for one run. */
export interface TriggerContext {
  now: number;
  farmers: FarmerRecord[];
  weather: WeatherAlert[];
}

/** A rule that turns current state into proactive message candidates. */
export interface Trigger {
  name: string;
  produce(ctx: TriggerContext): OutboundCandidate[];
}

/** Sources the engine reads each run (in-memory for the scaffold; DB/API in prod). */
export interface FarmerSource {
  list(): FarmerRecord[];
}
export interface WeatherSource {
  alerts(): WeatherAlert[];
}

export interface RunSummary {
  candidates: number;
  sent: number;
  needsApproval: number;
  suppressed: number;
  failed: number;
}
