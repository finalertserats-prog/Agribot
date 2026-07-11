import type { OutboundCandidate } from "../policy/types";
import type { Trigger, TriggerContext, FarmerRecord } from "./types";

const templateId = (type: string, lang: string): string => `${type}.${lang}.v1`;

// Tiny agronomy lookups (a real build reads a proper knowledge base / expert content).
const SEASONAL_TIP: Record<string, string> = {
  tomato: "water early morning and watch for leaf curl",
  chilli: "mulch to keep soil moisture steady",
};
const STAGE_STEP: Record<string, string> = {
  seedling: "keep soil moist and protect from strong sun",
  flowering: "ensure steady water and check for pests",
  fruiting: "support heavy branches and harvest ripe fruit",
};

/** Seasonal tip for farmers with a known crop. Skips incomplete profiles. */
export const seasonalTipTrigger: Trigger = {
  name: "seasonal_tip",
  produce(ctx: TriggerContext): OutboundCandidate[] {
    return ctx.farmers
      .filter((f) => f.name && f.crop) // data-quality gate
      .map((f) => ({
        tenantId: f.tenantId,
        farmerId: f.farmerId,
        messageType: "seasonal_tip" as const,
        language: f.language,
        templateId: templateId("seasonal_tip", f.language),
        vars: {
          name: f.name,
          crop: f.crop!,
          tip: SEASONAL_TIP[f.crop!.toLowerCase()] ?? "keep an eye on soil moisture and pests",
        },
      }));
  },
};

/** Crop-stage reminder for farmers with a known crop AND stage. */
export const cropStageTrigger: Trigger = {
  name: "crop_stage_reminder",
  produce(ctx: TriggerContext): OutboundCandidate[] {
    return ctx.farmers
      .filter((f) => f.name && f.crop && f.cropStage)
      .map((f) => ({
        tenantId: f.tenantId,
        farmerId: f.farmerId,
        messageType: "crop_stage_reminder" as const,
        language: f.language,
        templateId: templateId("crop_stage_reminder", f.language),
        vars: {
          name: f.name,
          crop: f.crop!,
          stage: f.cropStage!,
          step: STAGE_STEP[f.cropStage!.toLowerCase()] ?? "follow good practice for this stage",
        },
      }));
  },
};

/** Weather alert for farmers in an affected area. */
export const weatherAlertTrigger: Trigger = {
  name: "weather_alert",
  produce(ctx: TriggerContext): OutboundCandidate[] {
    const byArea = new Map<string, FarmerRecord[]>();
    for (const f of ctx.farmers) {
      if (!f.area) continue;
      const key = f.area.toLowerCase();
      (byArea.get(key) ?? byArea.set(key, []).get(key)!).push(f);
    }
    const out: OutboundCandidate[] = [];
    for (const w of ctx.weather) {
      for (const f of byArea.get(w.area.toLowerCase()) ?? []) {
        out.push({
          tenantId: f.tenantId,
          farmerId: f.farmerId,
          messageType: "weather_alert",
          language: f.language,
          templateId: templateId("weather_alert", f.language),
          vars: { area: w.area, alert: w.alert, action: w.action },
        });
      }
    }
    return out;
  },
};

export const DEFAULT_TRIGGERS: Trigger[] = [
  seasonalTipTrigger,
  cropStageTrigger,
  weatherAlertTrigger,
];
