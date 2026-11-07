// author: claude
// 实时声音：只用于面板里的背景声试听和“试听钵声”。练习时的声音由 render.js 预先合成成整段音轨。

import { bell, background } from './synth.js';

let ctx = null;
let master = null;
let bg = null; // { gain, nodes, target }
let volume = 0.8;

const now = () => ctx.currentTime;

export const Sound = {
  // 必须在用户点击时调用
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* 没有声音也能用 */ }
  },

  setVolume(v) {
    volume = v;
    if (master) master.gain.setTargetAtTime(v, now(), 0.05);
  },

  bell(strength = 1, base = 330, decay = 1) {
    if (ctx) bell(ctx, master, now() + 0.02, strength, base, decay);
  },

  startBg(type, level = 0.3) {
    this.stopBg(0.3);
    if (!ctx || !type || type === 'none') return;
    bg = background(ctx, master, type, level, now());
  },

  setBgLevel(level) {
    if (bg) bg.gain.gain.setTargetAtTime(Math.max(0.0001, 0.5 * level), now(), 0.2);
  },

  stopBg(fade = 2) {
    if (!bg || !ctx) return;
    const { gain, nodes } = bg;
    bg = null;
    gain.gain.cancelScheduledValues(now());
    gain.gain.setTargetAtTime(0.0001, now(), fade / 4);
    setTimeout(() => {
      for (const n of nodes) { try { if (n.stop) n.stop(); } catch (e) { /* ignore */ } try { n.disconnect(); } catch (e) { /* ignore */ } }
      try { gain.disconnect(); } catch (e) { /* ignore */ }
    }, fade * 1000 + 200);
  },
};
