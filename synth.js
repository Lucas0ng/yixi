// author: claude
// 钵声和背景声的合成函数。传入任意 AudioContext（实时的或离线的）和起始时间，
// 实时试听（audio.js）和整段音轨预合成（render.js）共用同一套声音。

export function noiseBuffer(c, kind, seconds = 8) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  const fade = Math.floor(c.sampleRate * 0.05); // 首尾交叉淡化，循环时不咔哒
  for (let i = 0; i < fade; i++) { const a = i / fade; d[i] = d[i] * a + d[len - fade + i] * (1 - a); }
  return buf;
}

// 颂钵式钟声。decay 缩放余音长度。
export function bell(c, dest, t, strength = 1, base = 330, decay = 1) {
  const out = c.createGain();
  out.gain.value = 0.22 * strength;
  out.connect(dest);
  for (const [ratio, amp, dec] of [[1, 1, 6], [2.756, 0.4, 3.5], [5.404, 0.16, 2.2], [8.933, 0.06, 1.4]]) {
    const len = dec * decay;
    for (const detune of [0, 1.3]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio + detune;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp * (detune ? 0.5 : 1), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.1);
    }
  }
}

// 呼吸提示：吸气一声较高的钵，呼气一声较低的钵
export function cue(c, dest, t, kind) {
  if (kind === 'in') bell(c, dest, t, 0.38, 392, 0.6);
  else if (kind === 'out') bell(c, dest, t, 0.34, 262, 0.75);
}

function lfo(c, t, freq, depth, target, nodes) {
  const o = c.createOscillator();
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start(t);
  nodes.push(o, g);
}
function filter(c, type, freq, q = 0.7) {
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}

// 背景声：从 t0 开始，4 秒淡入到 level。返回 { gain, nodes, target }。
export function background(c, dest, type, level, t0) {
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  gain.connect(dest);
  const nodes = [];
  const noise = (kind, sec) => { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, kind, sec); s.loop = true; s.start(t0); nodes.push(s); return s; };

  if (type === 'rain') {
    // 远处的雨：粉红噪声只留中低频，再垫一层很轻的低频
    const amp = c.createGain(); amp.gain.value = 0.42;
    noise('pink', 9).connect(filter(c, 'highpass', 250)).connect(filter(c, 'lowpass', 1600, 0.5)).connect(amp).connect(gain);
    lfo(c, t0, 0.05, 0.06, amp.gain, nodes);
    const body = c.createGain(); body.gain.value = 0.22;
    noise('brown', 7).connect(filter(c, 'lowpass', 350)).connect(body).connect(gain);
  } else if (type === 'ocean') {
    // 慢浪：约 14 秒一次起伏
    const lp = filter(c, 'lowpass', 420, 0.5);
    const amp = c.createGain(); amp.gain.value = 0.32;
    noise('brown', 11).connect(lp).connect(amp).connect(gain);
    lfo(c, t0, 0.07, 220, lp.frequency, nodes);
    lfo(c, t0, 0.07, 0.24, amp.gain, nodes);
  } else {
    // 温暖长音：几个正弦音慢慢起伏
    const lp = filter(c, 'lowpass', 900, 0.4);
    lp.connect(gain);
    [[110, 0.16, 0.031], [164.8, 0.1, 0.047], [220, 0.08, 0.023], [329.6, 0.035, 0.059]].forEach(([f, a, rate]) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = a;
      o.connect(g).connect(lp); o.start(t0);
      nodes.push(o);
      lfo(c, t0, rate, a * 0.7, g.gain, nodes);
      lfo(c, t0, rate * 3.1, 0.6, o.frequency, nodes);
    });
  }
  const target = Math.max(0.0002, 0.5 * level);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(target, t0 + 4);
  return { gain, nodes, target };
}
