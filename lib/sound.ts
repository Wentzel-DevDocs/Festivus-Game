/**
 * Original Web Audio stings and an adaptive, synthesized office-raid score.
 * There are no audio files to download and no franchise music is imitated.
 *
 * Usage: call `sound.unlock()` once inside a user gesture (browsers require
 * it), then `sound.play("thunk")` for one-shots and `sound.setScoreState(...)`
 * whenever the public game phase changes. Passing `null` stops the score.
 */

import type { Phase } from "./game/engine/session";

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

/** Minimal public information needed to adapt the soundtrack. */
export interface ScoreState {
  phase: Phase;
  /** Current event id; each event receives a subtly different tonal color. */
  eventId?: string | null;
  /** 0..1 action level, e.g. elapsed round progress or recent tap pressure. */
  intensity?: number;
  /** Optional result color for event_outcome/finale/splash. */
  outcome?:
    | "support"
    | "hinder"
    | "beloved"
    | "greased"
    | "divided"
    | null;
}

interface NormalizedScoreState {
  phase: Phase;
  eventId: string;
  intensity: number;
  outcome: "support" | "hinder" | "divided";
}

const SCORE_LOOKAHEAD_SEC = 0.22;
const SCORE_SCHEDULER_MS = 90;
const MAX_SCORE_VOICES = 48;
const SILENCE = 0.0001;

function clamp01(value: number | undefined): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? (value ?? 0) : 0));
}

function midi(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function normalizeScoreState(state: ScoreState): NormalizedScoreState {
  const outcome =
    state.outcome === "beloved" ? "support" :
    state.outcome === "greased" ? "hinder" :
    state.outcome ?? "divided";
  return {
    phase: state.phase,
    eventId: state.eventId ?? "",
    intensity: clamp01(state.intensity),
    outcome,
  };
}

class SoundBoard {
  private ctx: AudioContext | null = null;
  private muted = false;
  private scoreState: NormalizedScoreState | null = null;
  private scoreMaster: GainNode | null = null;
  private scoreFilter: BiquadFilterNode | null = null;
  private scoreCompressor: DynamicsCompressorNode | null = null;
  private droneOscillators: OscillatorNode[] = [];
  private droneGain: GainNode | null = null;
  private airSource: AudioBufferSourceNode | null = null;
  private airGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private scoreVoices = new Set<AudioScheduledSourceNode>();
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private nextStepTime = 0;
  private scoreStep = 0;
  private visibilityInstalled = false;

  /** Must be called from a user gesture (tap/click) before sounds play. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.installVisibilityHandler();
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume().then(() => this.syncScorePlayback());
    } else {
      this.syncScorePlayback();
    }
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    this.syncScorePlayback();
  }

  /**
   * Start or adapt the background score. This is safe to call on every
   * snapshot: intensity updates do not restart the pattern. `null` performs
   * a short click-free fade and releases all score nodes/timers.
   */
  setScoreState(state: ScoreState | null): void {
    if (!state) {
      this.scoreState = null;
      this.stopScore();
      return;
    }

    const next = normalizeScoreState(state);
    const previousKey = this.scoreState
      ? `${this.scoreState.phase}:${this.scoreState.eventId}:${this.scoreState.outcome}`
      : "";
    const nextKey = `${next.phase}:${next.eventId}:${next.outcome}`;
    this.scoreState = next;

    if (previousKey !== nextKey) {
      this.scoreStep = 0;
      this.nextStepTime = this.ctx ? this.ctx.currentTime + 0.06 : 0;
    }
    this.syncScorePlayback();
  }

  play(sting: Sting): void {
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    switch (sting) {
      case "thunk":
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
        for (let i = 0; i < 3; i++)
          this.noise(0.04, 2500, 0.1, t + i * 0.09);
        break;
      case "pop":
        this.noise(0.12, 900, 0.3);
        this.tone(200, 900, 0.25, "square", 0.12);
        break;
      case "win":
        [523, 659, 784].forEach((f, i) =>
          this.tone(f, f, 0.18, "triangle", 0.15, t + i * 0.11),
        );
        break;
      case "lose":
        [392, 330, 262].forEach((f, i) =>
          this.tone(f, f, 0.22, "sawtooth", 0.1, t + i * 0.13),
        );
        break;
    }
  }

  /** Release all Web Audio resources; useful for tests and full app teardown. */
  dispose(): void {
    this.scoreState = null;
    this.stopScheduler();
    this.destroyScoreGraph();
    if (typeof document !== "undefined" && this.visibilityInstalled) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.visibilityInstalled = false;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.noiseBuffer = null;
  }

  private syncScorePlayback(): void {
    if (!this.ctx || !this.scoreState) return;
    const hidden = typeof document !== "undefined" && document.hidden;

    if (this.muted || hidden || this.ctx.state !== "running") {
      this.stopScheduler();
      this.fadeScoreTo(SILENCE, 0.08);
      return;
    }

    this.ensureScoreGraph();
    this.applyScoreColor();
    this.fadeScoreTo(this.scoreLevel(), 0.35);
    if (!this.scheduler) {
      this.nextStepTime = Math.max(
        this.nextStepTime,
        this.ctx.currentTime + 0.04,
      );
      this.scheduler = setInterval(
        () => this.scheduleScore(),
        SCORE_SCHEDULER_MS,
      );
      this.scheduleScore();
    }
  }

  private ensureScoreGraph(): void {
    if (!this.ctx) return;
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.scoreMaster) return;

    const master = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const compressor = this.ctx.createDynamicsCompressor();
    master.gain.setValueAtTime(SILENCE, this.ctx.currentTime);
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    filter.Q.value = 0.45;
    compressor.threshold.value = -24;
    compressor.knee.value = 20;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;
    master.connect(filter).connect(compressor).connect(this.ctx.destination);
    this.scoreMaster = master;
    this.scoreFilter = filter;
    this.scoreCompressor = compressor;

    // Two long-lived oscillators and one looping air bed keep ambience rich
    // without constructing new nodes every frame.
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.018;
    droneGain.connect(master);
    this.droneGain = droneGain;
    ["sine", "triangle"].forEach((type, index) => {
      const oscillator = this.ctx!.createOscillator();
      oscillator.type = type as OscillatorType;
      oscillator.frequency.value = index === 0 ? midi(38) : midi(45);
      oscillator.detune.value = index === 0 ? -4 : 5;
      oscillator.connect(droneGain);
      oscillator.start();
      this.droneOscillators.push(oscillator);
    });

    const air = this.ctx.createBufferSource();
    const airFilter = this.ctx.createBiquadFilter();
    const airGain = this.ctx.createGain();
    air.buffer = this.getNoiseBuffer();
    air.loop = true;
    airFilter.type = "bandpass";
    airFilter.frequency.value = 540;
    airFilter.Q.value = 0.65;
    airGain.gain.value = 0.008;
    air.connect(airFilter).connect(airGain).connect(master);
    air.start();
    this.airSource = air;
    this.airGain = airGain;
  }

  private applyScoreColor(): void {
    if (!this.ctx || !this.scoreState) return;
    const { phase, intensity } = this.scoreState;
    const t = this.ctx.currentTime;
    const activeLift = phase === "event_active" || phase === "finale";
    this.scoreFilter?.frequency.cancelScheduledValues(t);
    this.scoreFilter?.frequency.setTargetAtTime(
      activeLift ? 2600 + intensity * 3000 : 1700 + intensity * 1000,
      t,
      0.16,
    );
    this.droneGain?.gain.cancelScheduledValues(t);
    this.droneGain?.gain.setTargetAtTime(
      phase === "grievance_write" ? 0.026 : activeLift ? 0.013 : 0.018,
      t,
      0.25,
    );
    this.airGain?.gain.cancelScheduledValues(t);
    this.airGain?.gain.setTargetAtTime(
      phase === "grievance_reveal" ? 0.014 : 0.006 + intensity * 0.005,
      t,
      0.2,
    );

    const root = this.rootMidi(this.scoreState);
    this.droneOscillators[0]?.frequency.setTargetAtTime(midi(root - 12), t, 0.3);
    this.droneOscillators[1]?.frequency.setTargetAtTime(midi(root - 5), t, 0.3);
  }

  private scoreLevel(): number {
    if (!this.scoreState) return SILENCE;
    const base =
      this.scoreState.phase === "grievance_write" ? 0.34 :
      this.scoreState.phase === "lobby" ? 0.38 :
      this.scoreState.phase === "event_active" ? 0.42 :
      0.4;
    return base + this.scoreState.intensity * 0.05;
  }

  private fadeScoreTo(value: number, seconds: number): void {
    if (!this.ctx || !this.scoreMaster) return;
    const gain = this.scoreMaster.gain;
    const t = this.ctx.currentTime;
    gain.cancelScheduledValues(t);
    gain.setTargetAtTime(Math.max(SILENCE, value), t, Math.max(0.01, seconds / 4));
  }

  private scheduleScore(): void {
    if (
      !this.ctx ||
      !this.scoreState ||
      this.muted ||
      (typeof document !== "undefined" && document.hidden)
    ) return;

    const horizon = this.ctx.currentTime + SCORE_LOOKAHEAD_SEC;
    let guard = 0;
    while (this.nextStepTime < horizon && guard++ < 12) {
      this.schedulePatternStep(this.scoreStep, this.nextStepTime, this.scoreState);
      this.scoreStep = (this.scoreStep + 1) % 32;
      this.nextStepTime += this.secondsPerStep(this.scoreState);
    }
  }

  private secondsPerStep(state: NormalizedScoreState): number {
    const bpm =
      state.phase === "lobby" ? 76 :
      state.phase === "grievance_write" ? 68 :
      state.phase === "grievance_reveal" ? 84 :
      state.phase === "event_countdown" ? 112 :
      state.phase === "event_active" ? 116 + state.intensity * 24 :
      state.phase === "event_outcome" ? 88 :
      state.phase === "finale" ? 126 + state.intensity * 12 :
      92;
    return 30 / bpm; // eighth notes
  }

  private schedulePatternStep(
    step: number,
    when: number,
    state: NormalizedScoreState,
  ): void {
    const barStep = step % 8;
    const root = this.rootMidi(state);
    const energetic = state.intensity > 0.48;

    switch (state.phase) {
      case "lobby":
        if (barStep === 0 || barStep === 5)
          this.scoreNote(root - 12, 0.52, "triangle", 0.045, when);
        if (barStep === 2 || barStep === 6)
          this.scoreChord([root, root + 3, root + 7], 0.7, 0.022, when);
        break;
      case "grievance_write":
        if (barStep === 0)
          this.scoreNote(root - 12, 1.15, "sine", 0.04, when);
        if (barStep === 3 || barStep === 7)
          this.scoreNote(root + (barStep === 3 ? 2 : 7), 0.18, "triangle", 0.022, when);
        break;
      case "grievance_reveal": {
        const notes = [0, 3, 7, 2, 0, 8, 7, 3];
        this.scoreNote(root + notes[barStep], 0.2, "triangle", 0.03, when);
        if (barStep === 0 || barStep === 4)
          this.scoreNoise(0.09, 620, 0.022, when);
        break;
      }
      case "event_countdown": {
        const rise = [0, 0, 3, 3, 7, 7, 10, 12];
        this.scoreNote(root + rise[barStep], 0.16, "square", 0.028, when);
        if (barStep % 2 === 0)
          this.scoreNoise(0.045, 1100, 0.035, when);
        break;
      }
      case "event_active": {
        const eventPattern = this.eventPattern(state.eventId);
        if (barStep % 2 === 0)
          this.scoreNote(
            root - 12 + (barStep === 6 ? 3 : 0),
            0.24,
            "sawtooth",
            0.042,
            when,
          );
        this.scoreNote(
          root + eventPattern[barStep],
          energetic ? 0.14 : 0.2,
          state.eventId === "swimSprint" ? "sine" : "triangle",
          energetic ? 0.034 : 0.026,
          when,
        );
        if (barStep % 2 === 0)
          this.scoreNoise(0.055, barStep === 0 ? 180 : 1800, 0.042, when);
        if (energetic && (barStep === 3 || barStep === 7))
          this.scoreNoise(0.035, 3200, 0.026, when);
        break;
      }
      case "event_outcome": {
        const contour =
          state.outcome === "support" ? [0, 3, 7, 10] :
          state.outcome === "hinder" ? [7, 3, 1, -2] :
          [0, 7, 3, 0];
        if (barStep < 4)
          this.scoreNote(root + contour[barStep], 0.48, "triangle", 0.043, when);
        if (barStep === 0)
          this.scoreChord(
            [root - 12, root, root + (state.outcome === "hinder" ? 1 : 7)],
            0.85,
            0.021,
            when,
          );
        break;
      }
      case "finale": {
        const climb = [0, 3, 7, 8, 10, 11, 13, 15];
        this.scoreNote(root + climb[barStep], 0.16, "sawtooth", 0.032, when);
        this.scoreNote(root - 12, 0.2, "triangle", 0.04, when);
        if (barStep % 2 === 0)
          this.scoreNoise(0.06, barStep === 0 ? 160 : 2300, 0.05, when);
        break;
      }
      case "splash":
        if (barStep === 0)
          this.scoreChord(
            state.outcome === "hinder"
              ? [root - 12, root, root + 3, root + 7]
              : [root - 12, root, root + 5, root + 10],
            1.3,
            0.026,
            when,
          );
        if (barStep === 4)
          this.scoreNote(root + 12, 0.65, "triangle", 0.03, when);
        break;
    }
  }

  private rootMidi(state: NormalizedScoreState): number {
    const eventShift: Record<string, number> = {
      poleRaise: 0,
      swimSprint: 2,
      greasedClimb: -2,
      tugOfWar: 3,
      pinTheBoss: 1,
    };
    return 50 + (eventShift[state.eventId] ?? 0);
  }

  private eventPattern(eventId: string): readonly number[] {
    const patterns: Record<string, readonly number[]> = {
      poleRaise: [0, 3, 7, 3, 8, 7, 3, 10],
      swimSprint: [0, 2, 7, 9, 7, 2, 10, 9],
      greasedClimb: [0, 3, 1, 7, 0, 8, 6, 3],
      tugOfWar: [0, 0, 7, 3, 0, 10, 7, 3],
      pinTheBoss: [0, 1, 7, 8, 3, 10, 11, 7],
    };
    return patterns[eventId] ?? [0, 3, 7, 3, 8, 7, 10, 3];
  }

  private scoreChord(
    notes: readonly number[],
    duration: number,
    gain: number,
    when: number,
  ): void {
    notes.forEach((note, index) =>
      this.scoreNote(note, duration, "triangle", gain, when + index * 0.008),
    );
  }

  private scoreNote(
    note: number,
    duration: number,
    type: OscillatorType,
    gainMax: number,
    when: number,
  ): void {
    if (!this.ctx || !this.scoreMaster || this.scoreVoices.size >= MAX_SCORE_VOICES)
      return;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t0 = Math.max(this.ctx.currentTime, when);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(midi(note), t0);
    gain.gain.setValueAtTime(SILENCE, t0);
    gain.gain.exponentialRampToValueAtTime(gainMax, t0 + 0.018);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t0 + duration);
    oscillator.connect(gain).connect(this.scoreMaster);
    this.trackScoreVoice(oscillator, [gain]);
    oscillator.start(t0);
    oscillator.stop(t0 + duration + 0.025);
  }

  private scoreNoise(
    duration: number,
    filterHz: number,
    gainMax: number,
    when: number,
  ): void {
    if (!this.ctx || !this.scoreMaster || this.scoreVoices.size >= MAX_SCORE_VOICES)
      return;
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const t0 = Math.max(this.ctx.currentTime, when);
    source.buffer = this.getNoiseBuffer();
    filter.type = filterHz < 300 ? "lowpass" : "bandpass";
    filter.frequency.value = filterHz;
    filter.Q.value = filterHz < 300 ? 0.7 : 1.2;
    gain.gain.setValueAtTime(SILENCE, t0);
    gain.gain.exponentialRampToValueAtTime(gainMax, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t0 + duration);
    source.connect(filter).connect(gain).connect(this.scoreMaster);
    this.trackScoreVoice(source, [filter, gain]);
    source.start(t0, 0, Math.min(duration + 0.01, 0.95));
  }

  private trackScoreVoice(
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
  ): void {
    this.scoreVoices.add(source);
    source.onended = () => {
      this.scoreVoices.delete(source);
      source.disconnect();
      nodes.forEach((node) => node.disconnect());
    };
  }

  private getNoiseBuffer(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    if (!this.ctx) throw new Error("AudioContext is not initialized");
    const frames = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private stopScore(): void {
    this.stopScheduler();
    if (!this.ctx || !this.scoreMaster) return;
    this.fadeScoreTo(SILENCE, 0.06);
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      if (!this.scoreState) this.destroyScoreGraph();
    }, 160);
  }

  private stopScheduler(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }

  private destroyScoreGraph(): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    this.stopScheduler();
    for (const source of this.scoreVoices) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // It may already have ended between iteration and stop().
      }
      source.disconnect();
    }
    this.scoreVoices.clear();
    this.droneOscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // Already stopped.
      }
      oscillator.disconnect();
    });
    this.droneOscillators = [];
    if (this.airSource) {
      try {
        this.airSource.stop();
      } catch {
        // Already stopped.
      }
      this.airSource.disconnect();
    }
    this.airSource = null;
    this.airGain?.disconnect();
    this.airGain = null;
    this.droneGain?.disconnect();
    this.droneGain = null;
    this.scoreMaster?.disconnect();
    this.scoreFilter?.disconnect();
    this.scoreCompressor?.disconnect();
    this.scoreMaster = null;
    this.scoreFilter = null;
    this.scoreCompressor = null;
  }

  private installVisibilityHandler(): void {
    if (typeof document === "undefined" || this.visibilityInstalled) return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.visibilityInstalled = true;
  }

  private readonly onVisibilityChange = (): void => {
    if (!this.ctx) return;
    if (document.hidden) {
      this.stopScheduler();
      this.fadeScoreTo(SILENCE, 0.06);
      return;
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().then(() => this.syncScorePlayback());
    } else {
      this.nextStepTime = this.ctx.currentTime + 0.05;
      this.syncScorePlayback();
    }
  };

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
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered white-noise burst (splashes, ratchets, crowd). */
  private noise(dur: number, filterHz: number, gainMax: number, when?: number): void {
    if (!this.ctx) return;
    const t0 = when ?? this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterHz;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainMax, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(t0, 0, Math.min(dur, 0.95));
  }
}

/** App-wide singleton. */
export const sound = new SoundBoard();
