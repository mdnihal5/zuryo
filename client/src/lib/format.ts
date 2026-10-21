const IST = "Asia/Kolkata";

export function formatPaise(paise: number) {
    const rupees = (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `₹${rupees}`;
}

export function formatTime(iso: string) {
    return new Date(iso)
        .toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true })
        .toUpperCase();
}

export function formatTimeSeconds(iso: string) {
    return new Date(iso)
        .toLocaleTimeString("en-IN", {
            timeZone: IST,
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        })
        .toUpperCase();
}

export function formatDay(iso: string) {
    return new Date(iso).toLocaleDateString("en-IN", {
        timeZone: IST,
        weekday: "short",
        day: "numeric",
        month: "short",
    });
}

export function formatDayTime(iso: string) {
    return `${formatDay(iso)}, ${formatTime(iso)}`;
}

// YYYY-MM-DD of the Kolkata calendar day that contains this instant
export function istDate(ms: number) {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: IST });
}

export function addDays(date: string, days: number) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// ISO instant for a Kolkata wall-clock time, e.g. ("2026-10-21", "06:30")
export function istToIso(date: string, hhmm: string) {
    return new Date(`${date}T${hhmm}:00+05:30`).toISOString();
}

// value of an <input type="datetime-local"> ("2026-10-21T06:30") typed as Kolkata time
export function istInputToIso(value: string) {
    return new Date(`${value}:00+05:30`).toISOString();
}

export function dayParts(date: string) {
    const d = new Date(`${date}T00:00:00Z`);
    return {
        weekday: d.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short" }),
        day: d.getUTCDate(),
        month: d.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short" }),
    };
}

export function initials(name: string) {
    return name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
}
