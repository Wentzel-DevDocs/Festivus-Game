/**
 * Sound stings, synthesized with the Web Audio API — no audio files to
 * host, nothing to download, works offline.
 *
 * Usage: call `sound.unlock()` once inside any user gesture (browsers
 * require it), then `sound.play("thunk")` wherever a sting fits.
 * `sound.setMuted(true)` silences everything (persisted by the caller).
 */

export type Sting =
  | "thunk" // a mash landing
  | "murmur" // crowd reaction
  | "splash" // swim sprint dunk
  | "slip" // greased pole slide
  | "bell" // pin count 1…2…3
  | "crank" // jack-in-the-box winding up
  | "pop" // the lid bursts
  | "win"
  | "lose";

class SoundBoard {
  private ctx: AudioContext | null = null;
  private muted = false;

  /** Must be called from a user gesture (tap/click) before sounds play. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  play(sting: Sting): void {
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    switch (sting) {
      case "thunk":
        // Short low knock: sine drop 160→60 Hz over 80 ms.
        this.tone(120, 60, 0.08, "sine", 0.25);
        break;
      case "murmur":
        this.noise(0.35, 400, 0.06);
        break;
      case "splash":
        this.noise(0.4, 1200, 0.18);
        this.tone(300, 80, 0.3, "sine", 0.12);
        break;
      case "slip":
        this.tone(600, 120, 0.35, "sawtooth", 0.08);
        break;
      case "bell":
        this.tone(880, 880, 0.25, "triangle", 0.2);
        this.tone(1320, 1320, 0.18, "sine", 0.08, t + 0.02);
        break;
      case "crank":
        // Three quick ratchet clicks.
        for (let i = 0; i < 3; i++) this.noise(0.04, 2500, 0.1, t + i * 0.09);
        break;
      case "pop":
        this.noise(0.12, 900, 0.3);
        this.tone(200, 900, 0.25, "square", 0.12);
        break;
      case "win":
        [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.18, "triangle", 0.15, t + i * 0.11));
        break;
      case "lose":
        [392, 330, 262].forEach((f, i) => this.tone(f, f, 0.22, "sawtooth", 0.1, t + i * 0.13));
        break;
    }
  }

  /** One enveloped oscillator sweeping from → to Hz. */
  private tone(
    from: number,
    to: number,
    dur: number,
    type: OscillatorType,
    gainMax: number,
    when?: number,
  ): void {
    if (!this.ctx) return;
    const t0 = when ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    gain.gain.setValueAtTime(gainMax, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered white-noise burst (splashes, ratchets, crowd). */
  private noise(dur: number, filterHz: number, gainMax: number, when?: number): void {
    if (!this.ctx) return;
    const t0 = when ?? this.ctx.currentTime;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterHz;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainMax, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t0);
  }
}

/** App-wide singleton. */
export const sound = new SoundBoard();
