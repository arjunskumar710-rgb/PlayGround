/**
 * Tiny synthesised sound design — no external audio assets required.
 * The context is created lazily on the first user gesture so browser autoplay
 * policies are respected.
 */

export class Sound {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    try {
      this.muted = window.localStorage.getItem('laser-chess-muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  async init() {
    if (this.muted) return;
    if (!this.context) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      this.context = new AudioCtor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.2;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      try { await this.context.resume(); } catch { /* ignore */ }
    }
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      window.localStorage.setItem('laser-chess-muted', muted ? '1' : '0');
    } catch { /* ignore */ }
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.2, this.context.currentTime, 0.02);
    }
  }

  tone({
    frequency = 440,
    endFrequency = null,
    type = 'sine',
    duration = 0.12,
    volume = 0.3,
    delay = 0,
    attack = 0.008,
  } = {}) {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(30, frequency), now);
    if (endFrequency !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  noise({ duration = 0.2, volume = 0.2, delay = 0, frequency = 900, q = 0.8 } = {}) {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime + delay;
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const decay = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
  }

  ui() {
    this.tone({ frequency: 620, endFrequency: 760, type: 'sine', duration: 0.055, volume: 0.09 });
  }

  select() {
    this.tone({ frequency: 410, endFrequency: 510, type: 'triangle', duration: 0.07, volume: 0.11 });
  }

  move() {
    this.tone({ frequency: 190, endFrequency: 95, type: 'sawtooth', duration: 0.16, volume: 0.1 });
    this.noise({ duration: 0.1, volume: 0.05, frequency: 700 });
  }

  rotate() {
    this.tone({ frequency: 280, endFrequency: 360, type: 'square', duration: 0.055, volume: 0.05 });
    this.tone({ frequency: 540, endFrequency: 660, type: 'triangle', duration: 0.09, volume: 0.09, delay: 0.05 });
    this.noise({ duration: 0.08, volume: 0.045, frequency: 1800, q: 2 });
  }

  deny() {
    this.tone({ frequency: 150, endFrequency: 110, type: 'square', duration: 0.12, volume: 0.07 });
  }

  charge() {
    this.tone({ frequency: 110, endFrequency: 880, type: 'triangle', duration: 0.42, volume: 0.11, attack: 0.08 });
    this.noise({ duration: 0.4, volume: 0.035, frequency: 2400, q: 1.4 });
  }

  laser() {
    this.tone({ frequency: 880, endFrequency: 320, type: 'sawtooth', duration: 0.24, volume: 0.075 });
    this.tone({ frequency: 1320, endFrequency: 660, type: 'sine', duration: 0.28, volume: 0.055 });
    this.noise({ duration: 0.32, volume: 0.055, frequency: 3000, q: 1.8 });
  }

  impact() {
    this.noise({ duration: 0.24, volume: 0.18, frequency: 420, q: 0.6 });
    this.tone({ frequency: 130, endFrequency: 58, type: 'sine', duration: 0.22, volume: 0.18 });
  }

  destroy() {
    this.noise({ duration: 0.4, volume: 0.22, frequency: 950, q: 0.5 });
    this.tone({ frequency: 330, endFrequency: 90, type: 'square', duration: 0.28, volume: 0.08 });
    this.tone({ frequency: 220, endFrequency: 70, type: 'sawtooth', duration: 0.36, volume: 0.06, delay: 0.03 });
  }

  win() {
    const notes = [261.63, 392.0, 523.25, 783.99];
    notes.forEach((frequency, index) => {
      this.tone({
        frequency,
        type: 'triangle',
        duration: 0.8,
        volume: 0.095,
        delay: index * 0.095,
        attack: 0.02,
      });
    });
    this.tone({ frequency: 130.81, type: 'sine', duration: 1.2, volume: 0.1, delay: 0.02 });
  }

  turn() {
    this.tone({ frequency: 340, endFrequency: 440, type: 'sine', duration: 0.1, volume: 0.075 });
    this.tone({ frequency: 520, endFrequency: 650, type: 'sine', duration: 0.12, volume: 0.055, delay: 0.06 });
  }

  gameStart() {
    this.tone({ frequency: 220, endFrequency: 440, type: 'triangle', duration: 0.4, volume: 0.09 });
    this.tone({ frequency: 440, endFrequency: 880, type: 'sine', duration: 0.45, volume: 0.06, delay: 0.12 });
    this.noise({ duration: 0.5, volume: 0.05, frequency: 1600, q: 1.1 });
  }
}
