// BALKU Sound Engine — Web Audio API で生成するゲーム内SEシステム
// client/public/sounds/ 配下に実際の .mp3 / .wav を配置する場合は
// playUrl() を使用してください。ここではフォールバックとしてプロシージャル生成を実装。

type SoundName =
  | "cardPlay"
  | "cardDraw"
  | "coin"
  | "bulkSuccess"
  | "bulkFail"
  | "forceBulk"
  | "win"
  | "lose"
  | "error"
  | "auction"
  | "submit"
  | "turnStart"
  | "eliminate"
  | "shop"
  | "sell"
  | "hover"
  | "alert";

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let volume = 0.35;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getMaster(): GainNode {
  getCtx();
  return masterGain!;
}

function now(): number {
  return getCtx().currentTime;
}

// ── プロシージャル音源ジェネレータ ──

function tone(freq: number, duration: number, type: OscillatorType = "sine", when?: number) {
  const ctx = getCtx();
  const t = when ?? now();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(getMaster());
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(duration: number, when?: number) {
  const ctx = getCtx();
  const t = when ?? now();
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  source.connect(gain);
  gain.connect(getMaster());
  source.start(t);
  source.stop(t + duration + 0.02);
}

function slideTone(from: number, to: number, duration: number, type: OscillatorType = "sine", when?: number) {
  const ctx = getCtx();
  const t = when ?? now();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(getMaster());
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function chord(freqs: number[], duration: number, type: OscillatorType = "triangle", when?: number) {
  freqs.forEach((f, i) => tone(f, duration, type, (when ?? now()) + i * 0.02));
}

// ── 個別SE実装 ──

const generators: Record<SoundName, () => void> = {
  cardPlay: () => {
    const t = now();
    tone(880, 0.06, "sine", t);
    tone(1320, 0.04, "sine", t + 0.03);
  },
  cardDraw: () => {
    const t = now();
    noise(0.08, t);
    slideTone(600, 1200, 0.1, "sine", t + 0.04);
  },
  coin: () => {
    const t = now();
    tone(2093, 0.12, "sine", t);
    tone(2637, 0.1, "sine", t + 0.05);
    tone(3136, 0.08, "sine", t + 0.1);
  },
  bulkSuccess: () => {
    const t = now();
    slideTone(200, 80, 0.3, "sawtooth", t);
    noise(0.15, t + 0.1);
    chord([110, 130, 160], 0.4, "triangle", t + 0.15);
  },
  bulkFail: () => {
    const t = now();
    slideTone(300, 100, 0.4, "sawtooth", t);
    tone(80, 0.5, "square", t + 0.1);
  },
  forceBulk: () => {
    const t = now();
    noise(0.2, t);
    slideTone(150, 50, 0.4, "sawtooth", t);
    tone(60, 0.6, "square", t + 0.15);
  },
  win: () => {
    const t = now();
    chord([523, 659, 784, 1047], 0.3, "triangle", t);
    chord([659, 784, 1047, 1319], 0.3, "triangle", t + 0.15);
    chord([784, 1047, 1319, 1568], 0.5, "triangle", t + 0.3);
    tone(2093, 0.8, "sine", t + 0.5);
  },
  lose: () => {
    const t = now();
    chord([400, 350, 300], 0.4, "sawtooth", t);
    slideTone(250, 80, 0.6, "sawtooth", t + 0.2);
    tone(60, 0.8, "sine", t + 0.5);
  },
  error: () => {
    const t = now();
    tone(200, 0.15, "square", t);
    tone(200, 0.15, "square", t + 0.18);
    tone(200, 0.3, "square", t + 0.36);
  },
  auction: () => {
    const t = now();
    tone(800, 0.05, "sine", t);
    tone(600, 0.08, "sine", t + 0.06);
    noise(0.06, t + 0.1);
  },
  submit: () => {
    const t = now();
    chord([440, 554, 659], 0.15, "triangle", t);
    tone(880, 0.2, "sine", t + 0.1);
  },
  turnStart: () => {
    const t = now();
    tone(880, 0.1, "sine", t);
    tone(1100, 0.15, "sine", t + 0.1);
    tone(1320, 0.2, "sine", t + 0.2);
  },
  eliminate: () => {
    const t = now();
    slideTone(400, 50, 0.5, "sawtooth", t);
    noise(0.3, t + 0.1);
  },
  shop: () => {
    const t = now();
    tone(1200, 0.05, "sine", t);
    tone(1500, 0.08, "sine", t + 0.05);
    tone(1800, 0.06, "sine", t + 0.1);
  },
  sell: () => {
    const t = now();
    noise(0.06, t);
    tone(600, 0.08, "sine", t + 0.03);
    tone(800, 0.06, "sine", t + 0.06);
  },
  hover: () => {
    const t = now();
    tone(1200, 0.03, "sine", t);
  },
  alert: () => {
    const t = now();
    tone(1000, 0.08, "square", t);
    tone(1000, 0.08, "square", t + 0.12);
  },
};

// ── 公開API ──

export const Sound = {
  play(name: SoundName) {
    if (muted) return;
    try {
      generators[name]();
    } catch {
      // AudioContext未対応環境では無視
    }
  },
  setMute(value: boolean) {
    muted = value;
    if (masterGain) {
      masterGain.gain.setTargetAtTime(muted ? 0 : volume, now(), 0.1);
    }
  },
  setVol(value: number) {
    volume = Math.max(0, Math.min(1, value));
    if (masterGain) {
      masterGain.gain.setTargetAtTime(muted ? 0 : volume, now(), 0.1);
    }
  },
  get muted() {
    return muted;
  },
  get vol() {
    return volume;
  },
};
