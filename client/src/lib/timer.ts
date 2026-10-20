export type SessionTimes = { startedAt: string; endsAt: string; warningAt: string };
export type TimerPhase = "running" | "warning" | "done";

export function timerPhase(session: SessionTimes, nowMs: number): TimerPhase {
    if (nowMs >= Date.parse(session.endsAt)) return "done";
    if (nowMs >= Date.parse(session.warningAt)) return "warning";
    return "running";
}

export function remainingMs(session: SessionTimes, nowMs: number) {
    return Math.max(0, Date.parse(session.endsAt) - nowMs);
}

// 0 to 1, for the progress bar
export function elapsedFraction(session: SessionTimes, nowMs: number) {
    const start = Date.parse(session.startedAt);
    const total = Date.parse(session.endsAt) - start;
    return Math.min(1, Math.max(0, (nowMs - start) / total));
}

export function formatCountdown(ms: number) {
    const totalSeconds = Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// True only on the tick where the clock passes `atIso`, so a page opened late never buzzes for the past.
export function crossed(prevMs: number, nowMs: number, atIso: string) {
    const at = Date.parse(atIso);
    return prevMs < at && at <= nowMs;
}
