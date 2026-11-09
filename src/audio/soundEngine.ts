export type MusicMood = 'WHIMSICAL' | 'MYSTERIOUS' | 'FESTIVE';

interface SoundSettings {
  musicVolume: number; // 0 to 1
  sfxVolume: number; // 0 to 1
  isMuted: boolean;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private currentMood: MusicMood = 'WHIMSICAL';
  private isPlayingMusic = false;
  private musicTimer: number | null = null;
  private stepIndex = 0;

  private settings: SoundSettings = {
    musicVolume: 0.35,
    sfxVolume: 0.65,
    isMuted: false,
  };

  constructor() {
    try {
      const saved = localStorage.getItem('dixcard_audio_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = { ...this.settings, ...parsed };
      }
    } catch {
      // Ignore storage error
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      this.syncGainNodes();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private syncGainNodes() {
    if (!this.ctx || !this.musicGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const targetMusic = this.settings.isMuted ? 0 : this.settings.musicVolume * 0.22;
    const targetSfx = this.settings.isMuted ? 0 : this.settings.sfxVolume;
    this.musicGain.gain.setTargetAtTime(targetMusic, now, 0.08);
    this.sfxGain.gain.setTargetAtTime(targetSfx, now, 0.05);
  }

  public getSettings(): SoundSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...partial };
    try {
      localStorage.setItem('dixcard_audio_settings', JSON.stringify(this.settings));
    } catch {
      // Ignore
    }
    this.ensureContext();
    this.syncGainNodes();
    if (!this.isPlayingMusic && !this.settings.isMuted && this.settings.musicVolume > 0) {
      this.startAmbientLoop();
    }
  }

  public unlockAndStart(mood?: MusicMood) {
    this.ensureContext();
    if (mood) {
      this.currentMood = mood;
    }
    if (!this.isPlayingMusic) {
      this.startAmbientLoop();
    }
  }

  public setMood(mood: MusicMood) {
    if (this.currentMood === mood && this.isPlayingMusic) return;
    this.currentMood = mood;
    this.stepIndex = 0;
    if (!this.isPlayingMusic) {
      this.startAmbientLoop();
    }
  }

  private startAmbientLoop() {
    if (typeof window === 'undefined') return;
    if (this.musicTimer) {
      window.clearInterval(this.musicTimer);
    }
    this.isPlayingMusic = true;

    const tick = () => {
      if (this.settings.isMuted || this.settings.musicVolume <= 0.01) return;
      const ctx = this.ensureContext();
      if (!ctx || !this.musicGain || ctx.state !== 'running') return;

      const now = ctx.currentTime;

      if (this.currentMood === 'WHIMSICAL') {
        const scale = [349.23, 440.0, 523.25, 493.88, 587.33, 659.25, 783.99, 659.25];
        const padRoots = [174.61, 196.0, 220.0, 174.61];
        const note = scale[this.stepIndex % scale.length];
        this.playAmbientTone(note, 'sine', 1.8, 0.32, now);
        if (this.stepIndex % 4 === 0) {
          const root = padRoots[Math.floor(this.stepIndex / 4) % padRoots.length];
          this.playAmbientTone(root, 'triangle', 3.4, 0.22, now);
          this.playAmbientTone(root * 1.5, 'sine', 3.2, 0.14, now);
        }
      } else if (this.currentMood === 'MYSTERIOUS') {
        const scale = [293.66, 349.23, 440.0, 523.25, 659.25, 440.0, 392.0, 329.63];
        const bassRoots = [146.83, 130.81, 174.61, 164.81];
        const note = scale[this.stepIndex % scale.length];
        this.playAmbientTone(note, 'sine', 2.2, 0.26, now);
        if (this.stepIndex % 2 === 0) {
          const sub = bassRoots[Math.floor(this.stepIndex / 2) % bassRoots.length];
          this.playAmbientTone(sub, 'triangle', 2.8, 0.24, now);
        }
      } else if (this.currentMood === 'FESTIVE') {
        const scale = [523.25, 659.25, 783.99, 987.77, 1046.5, 783.99, 659.25, 587.33];
        const chords = [261.63, 329.63, 392.0, 523.25];
        const note = scale[this.stepIndex % scale.length];
        this.playAmbientTone(note, 'triangle', 1.1, 0.36, now);
        if (this.stepIndex % 2 === 0) {
          const chordTone = chords[(this.stepIndex / 2) % chords.length];
          this.playAmbientTone(chordTone * 0.5, 'sine', 2.0, 0.28, now);
        }
      }

      this.stepIndex++;
    };

    tick();
    this.musicTimer = window.setInterval(tick, 950);
  }

  private playAmbientTone(
    freq: number,
    type: OscillatorType,
    duration: number,
    amplitude: number,
    startTime: number
  ) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, startTime);

    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(amplitude, startTime + 0.18);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.musicGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  private playSfxNote(
    freqStart: number,
    freqEnd: number,
    type: OscillatorType,
    duration: number,
    peakGain: number,
    delayOffset = 0
  ) {
    if (this.settings.isMuted) return;
    const ctx = this.ensureContext();
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;

    const t = ctx.currentTime + delayOffset;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration * 0.85);
    }

    env.gain.setValueAtTime(0.001, t);
    env.gain.linearRampToValueAtTime(peakGain, t + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(env);
    env.connect(sfx);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  public playHover() {
    this.playSfxNote(640, 820, 'sine', 0.05, 0.08, 0);
  }

  public playClick() {
    this.playSfxNote(420, 680, 'triangle', 0.085, 0.22, 0);
  }

  public playSoftPop() {
    this.playSfxNote(310, 590, 'sine', 0.11, 0.28, 0);
  }

  public playCardSelect() {
    this.playSfxNote(523.25, 523.25, 'sine', 0.16, 0.2, 0);
    this.playSfxNote(659.25, 659.25, 'sine', 0.18, 0.2, 0.055);
  }

  public playLockIn() {
    const notes = [440, 554.37, 659.25, 880];
    for (let i = 0; i < notes.length; i++) {
      this.playSfxNote(notes[i], notes[i], 'triangle', 0.34, 0.22, i * 0.06);
    }
  }

  public playStoneHop(stepNumber: number) {
    const baseFreq = 330 * Math.pow(1.032, stepNumber % 31);
    this.playSfxNote(baseFreq, baseFreq * 1.25, 'sine', 0.14, 0.26, 0);
  }

  public playNudgeChime() {
    const notes = [783.99, 1046.5, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      this.playSfxNote(notes[i], notes[i], 'sine', 0.22, 0.25, i * 0.11);
    }
  }

  public playVictoryFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5];
    const times = [0, 0.12, 0.24, 0.38, 0.56, 0.72];
    for (let i = 0; i < notes.length; i++) {
      this.playSfxNote(notes[i], notes[i], 'triangle', 0.55, 0.28, times[i]);
    }
  }
}

export const soundEngine = new SoundEngine();
