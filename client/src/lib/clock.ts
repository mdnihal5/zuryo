// The server's clock is the only one that counts. Every API response carries serverNow;
// we keep the difference to the device clock and add it to Date.now().
let offsetMs = 0;

export function computeOffset(serverNowIso: string, deviceNowMs: number) {
    return Date.parse(serverNowIso) - deviceNowMs;
}

export function recordServerNow(serverNowIso: string) {
    offsetMs = computeOffset(serverNowIso, Date.now());
}

export function serverTime() {
    return Date.now() + offsetMs;
}
