// author: claude
// 把一次练习的全部声音（人声、钵声、背景声）预先合成成一条 WAV 音轨，交给 <audio> 播放。
// 原因：iPhone 锁屏后会暂停网页的实时音频（Web Audio），但通常会继续播放 <audio> 媒体。
//
// 做法（T020）：每种钵声、每段人声、每种背景声只合成或解码一次（缓存起来），
// 再按时间表把采样直接拼进 16 位音轨。以前把几百个钵声塞进一次离线渲染，20 分钟的呼吸练习要等 90 多秒；
// 现在只需要合成几段几秒长的声音，拼接是简单的加法，几乎不花时间，内存也只占最终音轨那么大。

import { bell, cue, background } from './synth.js';

// 单声道 24 kHz（人声原始采样率，每分钟约 2.9 MB）。音轨超过 20 分钟（例如助眠加上练完后的背景声）
// 改用 16 kHz（每分钟约 1.9 MB），控制手机内存；人声主要能量在 8 kHz 以下，听感差别很小。
const HI = 24000, LO = 16000, LONG = 20 * 60;
let SR = HI; // 每次 renderSession 开始时设定；片段缓存按采样率分开
export const TAIL = 7; // 结束钵声的余音
const LOOP = 100; // 背景声循环长度（秒）：雨声起伏 20 秒一次、海浪 14.3 秒一次，100 秒都是整数倍
const XF = 2; // 循环接缝处的交叉淡化（秒）
const BG_SKIP = 6; // 循环从背景声的第 6 秒开始截取
const VOICE_GAIN = 1.1;

const cache = new Map(); // 合成好的声音片段：key -> Float32Array

async function offline(seconds, draw) {
  const c = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  draw(c, c.destination);
  return (await c.startRendering()).getChannelData(0);
}

// 钵声片段：强度按 1 合成，用时再乘强度（bell 的输出和强度成正比）
function bellPiece(base, decay) {
  const key = `${SR}:bell:${base}:${decay}`;
  if (!cache.has(key)) cache.set(key, offline(6 * decay + 0.3, (c, d) => bell(c, d, 0, 1, base, decay)));
  return cache.get(key);
}
function cuePiece(kind) {
  const key = `${SR}:cue:${kind}`;
  if (!cache.has(key)) cache.set(key, offline(4.8, (c, d) => cue(c, d, 0, kind)));
  return cache.get(key);
}
function voicePiece(url) {
  const key = `${SR}:voice:${url}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const c = new OfflineAudioContext(1, SR, SR); // 只用来解码并重采样到 24 kHz
      return (await c.decodeAudioData(await voiceBytes(url))).getChannelData(0);
    })().catch(() => null)); // 缺失的片段就不读
  }
  return cache.get(key);
}
// 背景声：合成一段 LOOP 秒的无缝循环（level=1），用时平铺、乘音量
function bgLoop(type) {
  const key = `${SR}:bg:${type}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const skip = BG_SKIP; // 跳过 background() 自带的 4 秒淡入
      const raw = await offline(skip + LOOP + XF, (c, d) => background(c, d, type, 1, 0));
      const a = Math.round(skip * SR), n = Math.round(LOOP * SR), x = Math.round(XF * SR);
      const loop = raw.slice(a, a + n);
      // 开头 XF 秒和“循环之后的那 XF 秒”交叉淡化：循环末尾接回开头时就是原本连续的波形
      for (let i = 0; i < x; i++) { const k = i / x; loop[i] = loop[i] * k + raw[a + n + i] * (1 - k); }
      return loop;
    })());
  }
  return cache.get(key);
}

// events: [{ t, type: 'bell', strength, base, decay } | { t, type: 'cue', kind } | { t, type: 'voice', url }]
// tail：练完以后背景声再继续的秒数（助眠用），最后 3 分钟慢慢变小到无声
export async function renderSession({ total, events, sound, bgLevel, volume, tail = 0 }) {
  const useBg = sound && sound !== 'none' && bgLevel > 0;
  if (!useBg) tail = 0;
  SR = total + tail > LONG ? LO : HI;
  const len = Math.ceil((total + Math.max(TAIL, tail)) * SR);

  // 1. 准备片段（并行；缓存过的立即返回）
  const clips = await Promise.all(events.map(async (e) => {
    let data = null, gain = 1;
    if (e.type === 'bell') { data = await bellPiece(e.base, e.decay); gain = e.strength; }
    else if (e.type === 'cue') data = await cuePiece(e.kind);
    else if (e.type === 'voice') { data = await voicePiece(e.url); gain = VOICE_GAIN; }
    return data ? { start: Math.round(e.t * SR), data, gain, voice: e.type === 'voice' } : null;
  }));
  const parts = clips.filter(Boolean).sort((x, y) => x.start - y.start);
  const loop = useBg ? await bgLoop(sound) : null;

  // 2. 背景声在人声期间压低（和以前一样：提前 0.3 秒降到 0.55，说完后慢慢回到 1）
  const duckSpans = parts.filter((p) => p.voice).map((p) => [p.start - Math.round(0.3 * SR), p.start + p.data.length]);

  // 3. 分块拼接，直接写进 16 位 PCM
  const buf = new ArrayBuffer(44 + len * 2);
  const pcm = new Int16Array(buf, 44);
  const CH = SR * 10;
  const chunk = new Float32Array(CH);
  const kDown = 1 - Math.exp(-1 / (0.25 * SR));
  const kUp = 1 - Math.exp(-1 / (0.6 * SR));
  const fadeIn = 4 * SR, endAt = Math.round(total * SR);
  const tailEnd = Math.round((total + tail) * SR), tailFade = Math.round(Math.min(180, tail) * SR);
  const bgBase = useBg ? bgLevel : 0;
  let duck = 1, span = 0, first = 0;

  for (let c0 = 0; c0 < len; c0 += CH) {
    const n = Math.min(CH, len - c0);
    chunk.fill(0, 0, n);
    if (loop) {
      const L = loop.length;
      const off = L - (Math.round(BG_SKIP * SR) % L); // loop[0] 对应第 BG_SKIP 秒，这样起伏的相位和从 0 秒开始一致
      for (let i = 0; i < n; i++) {
        const s = c0 + i;
        while (span < duckSpans.length && s >= duckSpans[span][1]) span++;
        const target = span < duckSpans.length && s >= duckSpans[span][0] ? 0.55 : 1;
        duck += (target - duck) * (target < duck ? kDown : kUp);
        let g = bgBase * duck;
        if (s < fadeIn) g *= Math.pow(0.0002, 1 - s / fadeIn); // 4 秒指数淡入
        if (tail) { if (s > tailEnd - tailFade) g *= Math.max(0, (tailEnd - s) / tailFade) ** 2; } // 练完后继续，最后几分钟慢慢变小
        else if (s > endAt) g *= Math.exp(-(s - endAt) / (0.8 * SR)); // 结束后 0.8 秒时间常数淡出
        chunk[i] = loop[(s + off) % L] * g;
      }
    }
    while (first < parts.length && parts[first].start + parts[first].data.length <= c0) first++;
    for (let j = first; j < parts.length && parts[j].start < c0 + n; j++) {
      const { start, data, gain } = parts[j];
      const from = Math.max(0, c0 - start), to = Math.min(data.length, c0 + n - start);
      for (let k = from; k < to; k++) chunk[start + k - c0] += data[k] * gain;
    }
    for (let i = 0; i < n; i++) {
      const x = Math.max(-1, Math.min(1, chunk[i] * volume));
      pcm[c0 + i] = x < 0 ? x * 0x8000 : x * 0x7fff;
    }
  }
  return new Blob([header(buf, len, SR)], { type: 'audio/wav' });
}
export const trackRate = () => SR;

// 单文件版（dist/一息.html）把人声以 base64 嵌在页面里（window.YIXI_EMBED），直接双击打开也能读到
async function voiceBytes(u) {
  const b64 = window.YIXI_EMBED && window.YIXI_EMBED.files[u];
  if (!b64) return (await fetch(u)).arrayBuffer();
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function header(buf, samples, rate) {
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  return buf;
}

// 一段极短的静音，用来在点击“开始”的那一刻解锁播放器（iOS 要求首次播放发生在点击里）
export function silentWav() {
  const n = 2400;
  return URL.createObjectURL(new Blob([header(new ArrayBuffer(44 + n * 2), n, HI)], { type: 'audio/wav' }));
}
