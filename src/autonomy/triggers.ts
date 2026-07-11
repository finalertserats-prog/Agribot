import type { MessageType, OutboundCandidate } from "../policy/types";
import { isApprovedTemplate } from "../policy/templates";
import type { Trigger, TriggerContext, FarmerRecord } from "./types";

const templateId = (type: string, lang: string): string => `${type}.${lang}.v1`;

/** Only emit a candidate if an approved template exists for this type+language. */
function hasTemplate(type: MessageType, lang: string): boolean {
  return isApprovedTemplate(templateId(type, lang), type, lang);
}

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
      .filter((f) => f.name && f.crop && hasTemplate("seasonal_tip", f.language))
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
      .filter((f) => f.name && f.crop && f.cropStage && hasTemplate("crop_stage_reminder", f.language))
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

function farmersByArea(farmers: FarmerRecord[]): Map<string, FarmerRecord[]> {
  const byArea = new Map<string, FarmerRecord[]>();
  for (const f of farmers) {
    if (!f.area) continue;
    const key = f.area.toLowerCase();
    const list = byArea.get(key) ?? [];
    list.push(f);
    byArea.set(key, list);
  }
  return byArea;
}

/** Weather alert for farmers in an affected area. Crisis alerts get priority. */
export const weatherAlertTrigger: Trigger = {
  name: "weather_alert",
  produce(ctx: TriggerContext): OutboundCandidate[] {
    const byArea = farmersByArea(ctx.farmers);
    const out: OutboundCandidate[] = [];
    for (const w of ctx.weather) {
      for (const f of byArea.get(w.area.toLowerCase()) ?? []) {
        if (!hasTemplate("weather_alert", f.language)) continue;
        out.push({
          tenantId: f.tenantId,
          farmerId: f.farmerId,
          messageType: "weather_alert",
          language: f.language,
          templateId: templateId("weather_alert", f.language),
          vars: { area: w.area, alert: w.alert, action: w.action },
          priority: w.crisis ? "crisis" : "normal",
        });
      }
    }
    return out;
  },
};

/**
 * Market-price update for farmers growing the priced crop. Indexed by crop
 * (one price per crop, first wins) so each farmer gets at most one price message
 * per run; gated by template availability.
 */
export const marketPriceTrigger: Trigger = {
  name: "market_price",
  produce(ctx: TriggerContext): OutboundCandidate[] {
    const priceByCrop = new Map<string, (typeof ctx.market)[number]>();
    for (const p of ctx.market) {
      const key = p.crop.toLowerCase();
      if (!priceByCrop.has(key)) priceByCrop.set(key, p); // first wins
    }
    const out: OutboundCandidate[] = [];
    for (const f of ctx.farmers) {
      if (!f.crop) continue;
      const p = priceByCrop.get(f.crop.toLowerCase());
      if (!p || !hasTemplate("market_price", f.language)) continue;
      out.push({
        tenantId: f.tenantId,
        farmerId: f.farmerId,
        messageType: "market_price",
        language: f.language,
        templateId: templateId("market_price", f.language),
        vars: { crop: p.crop, market: p.market, price: p.price, note: p.note ?? "" },
      });
    }
    return out;
  },
};

export const DEFAULT_TRIGGERS: Trigger[] = [
  seasonalTipTrigger,
  cropStageTrigger,
  weatherAlertTrigger,
  marketPriceTrigger,
];
