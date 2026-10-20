import { istParts } from "./ist.js";

export type PeakWindow = { start: string; end: string }; // "HH:MM"
export type PricingRules = {
    normalPricePaise: number;
    peakPricePaise: number;
    commissionBps: number;
    peakWindows: PeakWindow[];
};
export type Price = { isPeak: boolean; sessionPricePaise: number; commissionPaise: number; totalPaise: number };

const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

// A slot is peak when its START time falls in a window. Start inclusive, end exclusive:
// 06:00 is peak, 09:00 is not.
export function isPeak(startsAt: Date, windows: PeakWindow[]): boolean {
    const minute = istParts(startsAt).minutesOfDay;
    return windows.some((w) => minute >= toMinutes(w.start) && minute < toMinutes(w.end));
}

// All money is integer paise. Commission is rounded half up, in integer arithmetic (no floats).
export function computePrice(rules: PricingRules, startsAt: Date): Price {
    const peak = isPeak(startsAt, rules.peakWindows);
    return { isPeak: peak, ...withCommission(rules, peak ? rules.peakPricePaise : rules.normalPricePaise) };
}

function withCommission(rules: PricingRules, sessionPricePaise: number) {
    const commissionPaise = Math.floor((sessionPricePaise * rules.commissionBps + 5000) / 10_000);
    return { sessionPricePaise, commissionPaise, totalPaise: sessionPricePaise + commissionPaise };
}

// A package is sold at the normal (not peak) all-in price per session, with no bulk discount.
export const computePackageTotal = (rules: PricingRules, sessions: number) =>
    withCommission(rules, rules.normalPricePaise).totalPaise * sessions;
