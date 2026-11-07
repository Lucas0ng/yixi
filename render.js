// author: claude
// 把一次练习的全部声音（人声、钵声、背景声）预先合成成一条 WAV 音轨，交给 <audio> 播放。
// 原因：iPhone 锁屏后会暂停网页的实时音频（Web Audio），但通常会继续播放 <audio> 媒体。

import { bell, cue, background } from './synth.js';

const SR = 24000; // 单声道 24 kHz：人声原始采样率，20 分钟约 58 MB
export const TAIL = 7; // 结束钵声的余音

// events: [{ t, type: 'bell', strength, base, decay } | { t, type: 'cue', kind } | { t, type: 'voice', url }]
export async function renderSession({ total, events, sound, bgLevel, volume }) {
  const c = new OfflineAudioContext(1, Math.ceil((total + TAIL) * SR), SR);
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(c.destination);

  // 人声
  const urls = [...new Set(events.filter((e) => e.type === 'voice').map((e) => e.url))];
  const bufs = {};
  await Promise.all(urls.map(async (u) => {
    try { bufs[u] = await c.decodeAudioData(await voiceBytes(u)); } catch (e) { /* 缺失的片段就不读 */ }
  }));
  const voiceGain = c.createGain();
  voiceGain.gain.value = 1.1;
  voiceGain.connect(master);

  // 背景声：淡入、说话时压低一半、结束时淡出
  if (sound && sound !== 'none' && bgLevel > 0) {
    const duck = c.createGain();
    duck.connect(master);
    const bg = background(c, duck, sound, bgLevel, 0);
    for (const e of events) {
      if (e.type !== 'voice' || !bufs[e.url]) continue;
      duck.gain.setTargetAtTime(0.55, Math.max(0, e.t - 0.3), 0.25);
      duck.gain.setTargetAtTime(1, e.t + bufs[e.url].duration, 0.6);
    }
    bg.gain.gain.setTargetAtTime(0.0001, total, 0.8);
  }

  for (const e of events) {
    if (e.type === 'bell') bell(c, master, e.t, e.strength, e.base, e.decay);
    else if (e.type === 'cue') cue(c, master, e.t, e.kind);
    else if (e.type === 'voice' && bufs[e.url]) {
      const s = c.createBufferSource();
      s.buffer = bufs[e.url];
      s.connect(voiceGain);
      s.start(e.t);
    }
  }

  const out = await c.startRendering();
  return wav(out.getChannelData(0), SR);
}

// 单文件版（dist/一息.html）把人声以 base64 嵌在页面里（window.YIXI_EMBED），直接双击打开也能读到
async function voiceBytes(u) {
  const b64 = window.YIXI_EMBED && window.YIXI_EMBED.files[u];
  if (!b64) return (await fetch(u)).arrayBuffer();
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function wav(data, rate) {
  const buf = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data.length * 2, true);
  const pcm = new Int16Array(buf, 44);
  for (let i = 0; i < data.length; i++) { const x = Math.max(-1, Math.min(1, data[i])); pcm[i] = x < 0 ? x * 0x8000 : x * 0x7fff; }
  return new Blob([buf], { type: 'audio/wav' });
}

// 一段极短的静音，用来在点击“开始”的那一刻解锁播放器（iOS 要求首次播放发生在点击里）
export function silentWav() {
  return URL.createObjectURL(wav(new Float32Array(2400), SR));
}
