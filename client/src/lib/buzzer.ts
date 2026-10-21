// Browsers only allow sound after a tap, so unlockAudio() is called from a button.
let ctx: AudioContext | null = null;

export function unlockAudio() {
    ctx ??= new AudioContext();
    void ctx.resume();
}

export function audioReady() {
    return ctx?.state === "running";
}

export function buzz(beeps: number) {
    if (!ctx || ctx.state !== "running") return;
    for (let i = 0; i < beeps; i++) {
        const start = ctx.currentTime + i * 0.4;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.setValueAtTime(0, start + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
    }
}
