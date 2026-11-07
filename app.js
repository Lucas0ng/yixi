// author: claude
// 一息 · A 晨昏版。页面浮在一片随时间变化的天空和远山上（index.html 的 #scene）。
import { PRACTICES, DURATIONS, SOUNDS, INTERVALS, MOODS, SAFETY } from './content.js';
import { Sound } from './audio.js';
import { renderSession, silentWav } from './render.js';

// ---------------------------------------------------------------- 存储

const KEY = 'yixi:';
const store = {
  get(k, d) {
    try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* 隐私模式下仍可使用，只是不保存 */ }
  },
};

const DEFAULTS = { duration: 5, mood: true, cues: true, vibrate: true, volume: 0.8, bgVolume: 0.3, voice: true, sound: 'none', interval: 0, last: 'slow', sky: 'auto' };
let settings = { ...DEFAULTS, ...store.get('settings', {}) };
let records = store.get('records', []);
const saveSettings = () => store.set('settings', settings);
const saveRecords = () => store.set('records', records);
Sound.setVolume(settings.volume);

// 人声引导：manifest 由 scripts/gen_voice.py 生成，记录每段音频的时长
let voice = { clips: {} };
if (window.YIXI_EMBED) voice = window.YIXI_EMBED.manifest; // 单文件版：人声清单嵌在页面里
else fetch('voice/manifest.json').then((r) => (r.ok ? r.json() : null)).then((m) => { if (m) voice = m; }).catch(() => { /* 没有人声也能用 */ });
// 请浏览器不要在空间紧张时清掉本地记录（不支持就算了）
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
const clipsFor = (id) => (settings.voice && voice.clips[id] && voice.clips[id].length === (PRACTICES[id].steps || []).length ? voice.clips[id] : null);

// 引导练习的段落时间表：每段至少留出“读完 + 4 秒安静”，多出来的时间按权重分给各段
const LEAD = 3;
const GAP = 4;
function planSteps(id, durSec) {
  const p = PRACTICES[id];
  const clips = clipsFor(id);
  const need = p.steps.map((s, i) => (clips ? clips[i].dur + GAP : 6) + (i === 0 ? LEAD : 0));
  const needSum = need.reduce((a, b) => a + b, 0);
  const total = Math.max(durSec, Math.ceil(needSum));
  const wSum = p.steps.reduce((a, s) => a + s[0], 0);
  const extra = total - needSum;
  let acc = 0;
  const bounds = need.map((n, i) => { const a = acc; acc += n + (extra * p.steps[i][0]) / wSum; return a; });
  return { total, bounds, clips, minMin: Math.ceil(needSum / 60) };
}
const minMinutes = (id) => (PRACTICES[id].steps ? planSteps(id, 0).minMin : 1);

// ---------------------------------------------------------------- 工具

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const overlay = $('#overlay');
const sun = $('#sun');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (sec) => { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const vibrate = (p) => { if (settings.vibrate && navigator.vibrate) try { navigator.vibrate(p); } catch (e) { /* ignore */ } };

function weekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 周一为一周开始
  return x;
}

function stats() {
  const ws = weekStart().getTime();
  const days = new Set(records.filter((r) => r.ts >= ws).map((r) => dayKey(r.ts)));
  const totalMin = records.reduce((s, r) => s + r.actualSec, 0) / 60;
  const moods = records.slice(-30).map((r) => r.moodAfter).filter(Boolean);
  const moodAvg = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
  return { weekDays: days, totalMin, count: records.length, moodAvg, moodN: moods.length };
}

// ---------------------------------------------------------------- 天色与太阳

const SKY = {
  dawn: { name: '清晨', line: '新的一天，先呼吸一下', color: '#8ea3c8' },
  day: { name: '白天', line: '停一下，几分钟就好', color: '#6fa6d6' },
  dusk: { name: '傍晚', line: '慢一点也没关系', color: '#5d6f9a' },
  night: { name: '夜晚', line: '让今天在这里结束', color: '#0c1330' },
};

function skyNow() {
  const forced = new URLSearchParams(location.search).get('sky');
  if (SKY[forced]) return forced;
  if (SKY[settings.sky]) return settings.sky;
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 5 && h < 8.5) return 'dawn';
  if (h >= 8.5 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19.5) return 'dusk';
  return 'night';
}

function applySky() {
  const s = skyNow();
  document.documentElement.dataset.sky = s;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', SKY[s].color);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 22) return '晚上好';
  return '夜深了';
}

// 太阳（夜里是月亮）的位置：x 水平位置，dy 相对屏幕中线的偏移（vh），s 缩放
function placeSun(x, dy, s = 1) {
  sun.style.setProperty('--sun-x', x);
  sun.style.setProperty('--sun-dy', `${dy}vh`);
  sun.style.setProperty('--sun-s', s);
}
function sunForPage() {
  const night = document.documentElement.dataset.sky === 'night';
  if (tab === 'home') night ? placeSun('70%', -24, 0.55) : placeSun('64%', -5, 1);
  else placeSun('84%', -34, 0.42);
}

(function makeStars() {
  const box = $('#scene .stars');
  let html = '';
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 100, y = Math.random() * 100, d = Math.random() * 5;
    html += `<i style="left:${x}%;top:${y}%;animation-delay:-${d}s;${Math.random() < 0.2 ? 'width:3px;height:3px;' : ''}"></i>`;
  }
  box.innerHTML = html;
})();

// ---------------------------------------------------------------- 图标

const svg = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: svg('<circle cx="12" cy="13" r="4"/><path d="M3 19h18M12 4v2M5.6 7.6l1.4 1.4M18.4 7.6 17 9"/>'),
  stats: svg('<path d="M5 19V11M12 19V5M19 19v-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  pause: svg('<path d="M9 6v12M15 6v12"/>'),
  play: svg('<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>'),
};

// ---------------------------------------------------------------- 分组（首页四个入口）

const GROUPS = {
  breath: { name: '呼吸', note: '跟着太阳的升落呼吸，最适合刚开始。', ids: ['sigh', 'slow', 'box'] },
  sit: { name: '静坐', note: '只有钵声和计时。', ids: ['sit'] },
  guided: { name: '引导', note: '闭上眼睛，跟着声音一段一段做。走神很正常，回来就好。', ids: ['aware', 'scan', 'kind'] },
  sleep: { name: '助眠', note: '躺着做，结束时不用睁眼，可以直接睡去。', ids: ['sleep', 'scan', 'slow'] },
};

// 首页“今天就练这个”：替用户先选好，不用每天做决定
function todayPick() {
  const h = new Date().getHours();
  let id;
  if (!records.length) id = 'slow';
  else if (h >= 21 || h < 4) id = 'sleep';
  else if (h >= 5 && h < 10) id = 'slow';
  else id = PRACTICES[settings.last] ? settings.last : 'slow';
  const dur = Math.max(id === 'sleep' ? Math.max(settings.duration, 10) : settings.duration, minMinutes(id));
  return { id, dur };
}

// ---------------------------------------------------------------- 页面

let tab = 'home';

function render() {
  applySky();
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  if (tab === 'home') renderHome();
  else if (tab === 'stats') renderStats();
  else renderSettings();
  sunForPage();
  window.scrollTo(0, 0);
}

function renderHome() {
  const s = stats();
  const sky = SKY[document.documentElement.dataset.sky];
  const { id, dur } = todayPick();
  const p = PRACTICES[id];
  const d = new Date();
  const wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const week = s.weekDays.size ? `本周已练 ${s.weekDays.size} 天` : '漏一天也没关系';
  view.innerHTML = `
    <div class="home">
      <p class="eyebrow shadow">${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${wk} · ${sky.name}</p>
      <h1 class="greet shadow">${greeting()}<br>${sky.line}</h1>
      <div class="spacer"></div>
      <button class="today card" data-action="today" data-id="${id}" data-dur="${dur}" aria-label="开始${esc(p.name)} ${dur} 分钟">
        <small>今天就练这个</small>
        <span class="t">${esc(p.name)}<span class="dot">·</span>${dur} 分钟</span>
        <span class="m">${esc(p.short)} · ${week}</span>
        <span class="play" aria-hidden="true"></span>
      </button>
      <div class="quick">
        ${Object.entries(GROUPS).map(([k, g]) => `<button class="glass" data-action="group" data-cat="${k}">${g.name}</button>`).join('')}
      </div>
      <div class="home-foot shadow">
        <button data-action="sos">现在很紧张？先做 1 分钟</button>
        <button data-action="setup" data-id="${id}">调整 ›</button>
      </div>
    </div>`;
}

function renderStats() {
  const s = stats();
  const ws = weekStart();
  const today = dayKey(Date.now());
  const wk = ['一', '二', '三', '四', '五', '六', '日'].map((n, i) => {
    const d = new Date(ws); d.setDate(ws.getDate() + i);
    const k = dayKey(d.getTime());
    return `<span class="wd ${s.weekDays.has(k) ? 'on' : ''} ${k === today ? 'now' : ''}"><i></i>${n}</span>`;
  }).join('');

  const perDay = {};
  for (const r of records) perDay[dayKey(r.ts)] = (perDay[dayKey(r.ts)] || 0) + r.actualSec / 60;
  const start = new Date(ws); start.setDate(ws.getDate() - 21);
  let grid = '';
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const m = perDay[dayKey(d.getTime())] || 0;
    const lv = m === 0 ? 0 : m < 5 ? 1 : m < 10 ? 2 : 3;
    grid += `<span class="cell l${lv} ${d.getTime() > Date.now() ? 'future' : ''}" title="${d.getMonth() + 1}/${d.getDate()} · ${Math.round(m)} 分钟"></span>`;
  }

  const list = records.slice(-30).reverse().map((r) => {
    const d = new Date(r.ts);
    const p = PRACTICES[r.key];
    const m = r.moodAfter ? `<span class="mood">练后心情：${MOODS[r.moodAfter - 1].t}</span>` : '';
    return `<li><span>${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}</span><span>${esc(p ? p.name : r.key)}</span><span>${Math.max(1, Math.round(r.actualSec / 60))} 分钟</span>${m}</li>`;
  }).join('');

  view.innerHTML = `
    <header class="shadow"><h1 class="page-title">记录</h1><p class="page-sub">只记这周练了几天。漏一天，什么都不会失去。</p></header>
    <section class="panel card">
      <div class="weekrow">${wk}</div>
      <p class="big-num">本周<b>${s.weekDays.size}</b>天</p>
    </section>
    <section class="tiles">
      <div class="tile card"><b>${Math.round(s.totalMin)}</b><span>累计分钟</span></div>
      <div class="tile card"><b>${s.count}</b><span>练习次数</span></div>
      <div class="tile card"><b>${s.moodAvg == null ? '—' : s.moodAvg.toFixed(1)}</b><span>练后心情<br>（满分 5）</span></div>
    </section>
    <section class="panel card">
      <h2>最近四周</h2>
      <div class="grid4">${grid}</div>
      <p class="legend"><span class="cell l0"></span>没练 <span class="cell l1"></span>&lt;5 分钟 <span class="cell l2"></span>5–10 <span class="cell l3"></span>≥10</p>
    </section>
    <section class="panel card">
      <h2>最近练习</h2>
      ${list ? `<ul class="hist">${list}</ul>` : '<p class="muted">还没有记录。练满 30 秒就会记下来。</p>'}
    </section>`;
}

function chips(name, options, current) {
  return `<div class="chips" role="radiogroup">${options.map((o) => `<button role="radio" aria-checked="${String(o.id) === String(current)}" data-chip="${name}" data-val="${o.id}" ${o.off ? 'disabled' : ''}>${esc(o.name)}</button>`).join('')}</div>`;
}
function toggle(name, on, label) {
  return `<label class="row"><span>${label}</span><input type="checkbox" data-setting="${name}" ${on ? 'checked' : ''}><i class="switch"></i></label>`;
}

function renderSettings() {
  const skyOpts = [{ id: 'auto', name: '跟随时间' }, ...Object.entries(SKY).map(([id, v]) => ({ id, name: v.name }))];
  view.innerHTML = `
    <header class="shadow"><h1 class="page-title">设置</h1></header>
    <section class="panel card">
      <h2>天色</h2>
      ${chips('sky', skyOpts, settings.sky)}
      <h2>默认时长</h2>
      ${chips('duration', DURATIONS.map((d) => ({ id: d, name: `${d} 分钟` })), settings.duration)}
    </section>
    <section class="panel card">
      ${toggle('voice', settings.voice, '引导练习用人声朗读')}
      ${toggle('cues', settings.cues, '呼吸练习用钵声提示')}
      ${toggle('mood', settings.mood, '练习后记一下心情')}
      ${toggle('vibrate', settings.vibrate, '振动提示（部分手机支持）')}
      <label class="row"><span>总音量</span><input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-setting="volume"></label>
      <label class="row"><span>背景声音量</span><input type="range" min="0" max="1" step="0.05" value="${settings.bgVolume}" data-setting="bgVolume"></label>
      <div class="btnrow"><button class="btn-line" data-action="testbell">试听钵声</button></div>
    </section>
    <section class="panel card">
      <h2>数据</h2>
      <p class="muted">所有记录只保存在这台设备的浏览器里，不上传到任何地方。换浏览器、换电脑或清理浏览器数据前，先导出一份；到新地方再导入就能接着用。</p>
      <div class="btnrow">
        <button class="btn-line" data-action="export">导出记录</button>
        <button class="btn-line" data-action="import">导入记录</button>
        <button class="btn-line danger" data-action="clear">清空记录</button>
      </div>
      <input type="file" id="importfile" accept=".json,application/json" hidden>
    </section>
    <section class="panel card">
      <h2>关于</h2>
      <p class="muted">一息：免费、无广告、无账号、可离线。在 iPhone 上用 Safari 打开，点“分享 → 添加到主屏幕”，就能像 App 一样使用。</p>
      <p class="muted">锁屏后声音会继续播放，可以在锁屏界面暂停。如果从主屏幕图标打开时锁屏就停了，改在 Safari 里打开会更稳定（这是部分 iOS 版本的已知问题）。</p>
      <p class="muted">${esc(SAFETY)}</p>
    </section>`;
}

// ---------------------------------------------------------------- 面板

function showSheet(html) {
  overlay.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  overlay.className = 'show';
  requestAnimationFrame(() => overlay.classList.add('in'));
}

function openGroup(cat) {
  const g = GROUPS[cat];
  if (g.ids.length === 1) { openSetup(g.ids[0]); return; }
  showSheet(`
    <h2>${g.name}</h2>
    <p class="desc">${esc(g.note)}</p>
    <div>${g.ids.map((id) => `<button class="pick" data-action="setup" data-id="${id}" data-cat="${cat}"><i class="dot"></i><span><b>${esc(PRACTICES[id].name)}</b><span>${esc(PRACTICES[id].short)}</span></span>${ICON.chevron}</button>`).join('')}</div>`);
}

function openSetup(id, again = false) {
  const p = PRACTICES[id];
  const min = minMinutes(id);
  const dur = Math.max(settings.duration, min);
  const durOpts = DURATIONS.map((d) => ({ id: d, name: `${d} 分钟`, off: d < min }));
  const html = `
    <h2>${esc(p.name)}</h2>
    <p class="desc">${esc(p.desc)}</p>
    <h3>时长</h3>
    ${chips('s-duration', durOpts, dur)}
    ${min > 1 ? `<p class="hint">人声读完一遍约需 ${min} 分钟，更短的时长先关掉了。</p>` : ''}
    ${p.steps ? `<h3>人声朗读</h3>${chips('s-voice', [{ id: 1, name: '开' }, { id: 0, name: '关（只看文字）' }], settings.voice ? 1 : 0)}` : ''}
    <h3>背景声</h3>
    ${chips('s-sound', SOUNDS, settings.sound)}
    <label class="row slim"><span>背景声音量</span><input type="range" min="0" max="1" step="0.05" value="${settings.bgVolume}" data-setting="bgVolume"></label>
    ${p.cat === 'sit' ? `<h3>间隔钵声</h3>${chips('s-interval', INTERVALS, settings.interval)}` : ''}
    <button class="start" data-action="begin" data-id="${id}">开始</button>`;
  if (again) { $('.sheet', overlay).innerHTML = `<div class="grab"></div>${html}`; return; }
  showSheet(html);
}

function closeOverlay() {
  if (!active) Sound.stopBg(0.8); // 关掉面板时停止试听
  overlay.className = '';
  overlay.innerHTML = '';
  overlay.onclick = null;
  if (document.body.classList.contains('live')) { document.body.classList.remove('live'); sunForPage(); }
}

// ---------------------------------------------------------------- 心情（只在练后问一次，可跳过）

function askMood(onPick) {
  overlay.innerHTML = `
    <div class="float shadow">
      <h2>现在感觉如何？</h2>
      <p>走神很正常，练了就好。</p>
      <div class="moods">${MOODS.map((m) => `<button data-mood="${m.v}"><i class="dot" style="--r:${4 + m.v * 2.4}px"></i>${m.t}</button>`).join('')}</div>
      <button class="later" data-mood="0">跳过</button>
    </div>`;
  overlay.className = 'show in';
  overlay.onclick = (e) => {
    const b = e.target.closest('[data-mood]');
    if (!b) return;
    overlay.onclick = null;
    onPick(Number(b.dataset.mood) || null);
  };
}

// ---------------------------------------------------------------- 练习进行中

let active = null;
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* 不支持就算了 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active && !active.paused) keepAwake(true);
});

// 播放器：每次练习先把全部声音合成成一条音轨，再交给它播放。锁屏后通常还能继续播。
const player = new Audio();
player.preload = 'auto';
player.setAttribute('playsinline', '');
let silentUrl = null;
let trackUrl = null;

// 必须在点击里同步调用：先让播放器播一小段静音，之后换成正式音轨时 iOS 才允许自动播放
function unlockPlayer() {
  try {
    if (!silentUrl) silentUrl = silentWav();
    player.src = silentUrl;
    const p = player.play();
    if (p && p.catch) p.catch(() => { /* ignore */ });
  } catch (e) { /* ignore */ }
}

function begin(id, durMin, opts = {}) {
  Sound.stopBg(0.3); // 停掉面板里的试听
  unlockPlayer();
  runSession(id, Math.max(durMin, minMinutes(id)), opts);
}

// 这次练习的声音时间表
function soundEvents(p, total, bounds, clips, opts) {
  const ev = [];
  if (p.pattern) {
    if (settings.cues) {
      const cycle = p.pattern.reduce((s, x) => s + x.d, 0);
      for (let t0 = 0; t0 < total - 0.01; t0 += cycle) {
        let t = t0;
        p.pattern.forEach((ph, i) => {
          const prev = p.pattern[(i - 1 + p.pattern.length) % p.pattern.length];
          if (ph.k !== prev.k && ph.k !== 'hold') ev.push({ t: t + 0.02, type: 'cue', kind: ph.k }); // 只在吸、呼切换时敲钵
          t += ph.d;
        });
      }
    }
  } else {
    ev.push({ t: 0.05, type: 'bell', strength: p.sleepy ? 0.6 : 1, base: 330, decay: 1 });
    if (bounds) {
      bounds.forEach((b, k) => {
        if (clips) ev.push({ t: b + (k === 0 ? LEAD : 0.8), type: 'voice', url: clips[k].file });
        else if (k > 0) ev.push({ t: b, type: 'bell', strength: 0.45, base: 392, decay: 1 });
      });
    } else {
      const iv = (opts.interval ?? settings.interval) * 60;
      if (iv > 0) for (let t = iv; t < total - 5; t += iv) ev.push({ t, type: 'bell', strength: 0.5, base: 330, decay: 1 });
    }
  }
  ev.push({ t: total, type: 'bell', strength: p.sleepy ? 0.5 : 1, base: 330, decay: 1 }); // 结束钵声
  return ev;
}

function runSession(id, durMin, opts) {
  const p = PRACTICES[id];
  let total = durMin * 60;
  let cycle = 0;
  if (p.pattern) {
    cycle = p.pattern.reduce((s, x) => s + x.d, 0);
    total = Math.max(1, Math.round(total / cycle)) * cycle; // 在一次呼气结束时收尾
  }
  let bounds = null;
  let clips = null;
  if (p.steps) ({ total, bounds, clips } = planSteps(id, total));

  const hint = p.pattern ? p.hint : p.steps ? (clips ? '闭上眼睛也可以，跟着声音做' : '跟着文字一段一段做') : '';
  overlay.innerHTML = `
    <div class="session ${p.cat}">
      <div class="sess-top">
        <button class="icon-btn glass" data-action="end" aria-label="结束">${ICON.close}</button>
        <span class="sess-name shadow">${esc(p.name)}</span>
        <button class="icon-btn glass" data-action="pause" id="pausebtn" aria-label="暂停">${ICON.pause}</button>
      </div>
      <div class="word shadow"><b id="phase"></b><span id="count"></span></div>
      <p class="cue shadow" id="cue"></p>
      <div class="tap" data-action="pause"></div>
      <div class="sess-bottom shadow">
        <p class="hint-line" id="hint">正在准备声音…</p>
        <div class="prog"><i id="prog"></i></div>
        <span class="remain" id="remain">${fmtClock(total)}</span>
      </div>
    </div>`;
  overlay.className = 'show in';
  document.body.classList.add('live');
  placeSun('50%', p.pattern ? 13 : -8, 1);

  const phaseEl = $('#phase'), countEl = $('#count'), cueEl = $('#cue'), remainEl = $('#remain'), prog = $('#prog'), hintEl = $('#hint');
  const A = active = { id, p, total, opts, ready: false, paused: false, lastPhase: -1, lastStep: -1, raf: 0, done: false };
  // 播放器的进度就是练习的时钟：锁屏回来后画面会自动对上
  A.elapsed = () => (A.ready ? Math.min(player.currentTime, total) : 0);
  keepAwake(true);
  if (p.cat === 'sit') { cueEl.textContent = '安静地坐着。走神了很正常，回到呼吸就好。'; cueEl.classList.add('show'); }

  renderSession({
    total, events: soundEvents(p, total, bounds, clips, opts),
    sound: opts.sound ?? settings.sound, bgLevel: settings.bgVolume, volume: settings.volume,
  }).then((blob) => {
    if (A.done) return;
    if (trackUrl) URL.revokeObjectURL(trackUrl);
    trackUrl = URL.createObjectURL(blob);
    player.src = trackUrl;
    A.ready = true;
    hintEl.textContent = hint;
    setMediaSession(p, durMin);
    player.play().catch(() => { A.paused = true; showPaused(true); hintEl.textContent = '轻点继续'; });
  }).catch(() => { hintEl.textContent = '声音准备失败，可以只看画面练习'; });

  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  const visible = () => document.visibilityState === 'visible';

  function frame() {
    if (A.done) return;
    const e = A.elapsed();
    remainEl.textContent = `${A.stepText || ''}还剩 ${fmtClock(total - e)}`;
    prog.style.width = `${(e / total) * 100}%`;

    if (p.pattern) {
      const n = Math.floor(e / cycle);
      let tc = e - n * cycle;
      let i = 0;
      while (i < p.pattern.length - 1 && tc >= p.pattern[i].d) { tc -= p.pattern[i].d; i++; }
      const ph = p.pattern[i];
      const prev = p.pattern[(i - 1 + p.pattern.length) % p.pattern.length];
      const level = A.ready ? prev.to + (ph.to - prev.to) * ease(Math.min(1, tc / ph.d)) : 0;
      placeSun('50%', 13 - 27 * level, 0.95 + 0.2 * level); // 太阳随吸气升起，随呼气落下
      const key = n * 10 + i;
      if (A.ready && key !== A.lastPhase && !A.paused) {
        A.lastPhase = key;
        phaseEl.textContent = ph.t;
        if (visible()) vibrate(ph.k === 'out' ? [12, 60, 12] : ph.k === 'in' ? 18 : 0);
      }
      if (!A.ready) phaseEl.textContent = '准备一下';
      else if (!A.paused) { const left = Math.ceil(ph.d - tc); countEl.textContent = left > 0 ? left : ''; }
    } else {
      placeSun('50%', -8 + 2 * Math.sin((2 * Math.PI * e) / 12), 1.05); // 太阳停在半空，很慢地浮动
      if (bounds) {
        let k = 0;
        while (k < bounds.length - 1 && e >= bounds[k + 1]) k++;
        if (k !== A.lastStep) {
          const first = A.lastStep < 0;
          A.lastStep = k;
          cueEl.classList.remove('show');
          setTimeout(() => { cueEl.textContent = p.steps[k][1]; cueEl.classList.add('show'); }, first ? 0 : 600);
          A.stepText = `第 ${k + 1} / ${p.steps.length} 段 · `;
        }
      }
    }

    if (A.ready && (e >= total || player.ended)) { finish(true); return; }
    A.raf = requestAnimationFrame(frame);
  }
  A.raf = requestAnimationFrame(frame);

  function showPaused(on) {
    const btn = $('#pausebtn');
    const box = $('.session', overlay);
    if (!btn || !box) return;
    btn.innerHTML = on ? ICON.play : ICON.pause;
    btn.setAttribute('aria-label', on ? '继续' : '暂停');
    box.classList.toggle('paused', on);
    if (on && p.pattern) { phaseEl.textContent = '已暂停'; countEl.textContent = '轻点继续'; }
    if (!on) A.lastPhase = -1;
  }
  A.showPaused = showPaused;
  A.togglePause = () => {
    if (!A.ready) return;
    if (player.paused) player.play().catch(() => { /* ignore */ });
    else player.pause();
  };
}

// 播放器的暂停/继续（包括锁屏界面上的按钮）同步到画面
player.addEventListener('pause', () => {
  if (!active || !active.ready || active.done || player.ended) return;
  active.paused = true; active.showPaused(true); keepAwake(false);
});
player.addEventListener('play', () => {
  if (!active || !active.ready || active.done) return;
  active.paused = false; active.showPaused(false); keepAwake(true);
});
// 锁屏时画面不刷新，靠播放结束事件把这次练习记下来
player.addEventListener('ended', () => { if (active && active.ready) finish(true); });

function setMediaSession(p, durMin) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: p.name, artist: '一息', album: `${durMin} 分钟`,
      artwork: [192, 512].map((n) => ({ src: new URL(`icons/icon-${n}.png`, location.href).href, sizes: `${n}x${n}`, type: 'image/png' })),
    });
    navigator.mediaSession.setActionHandler('play', () => { player.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { player.pause(); });
  } catch (e) { /* ignore */ }
}

function finish(complete) {
  const A = active;
  if (!A || A.done) return;
  A.done = true;
  cancelAnimationFrame(A.raf);
  const sec = Math.round(A.elapsed());
  if (!complete || !A.ready) player.pause(); // 正常结束时让结束钵声的余音放完
  keepAwake(false);
  active = null;
  placeSun('50%', 6, 1); // 练完后太阳停在山口，回到首页时再落回原位

  if (sec < 30) { closeOverlay(); render(); return; }

  const rec = { id: Date.now().toString(36), ts: Date.now(), key: A.id, plannedSec: A.total, actualSec: sec, moodAfter: null, sound: A.opts.sound ?? settings.sound, complete };
  const save = () => { records.push(rec); saveRecords(); };
  if (A.p.sleepy && complete) { save(); closeOverlay(); render(); return; }

  const mins = Math.max(1, Math.round(sec / 60));
  const showDone = () => {
    const s = stats();
    overlay.innerHTML = `
      <div class="float shadow">
        <h2>${complete ? '完成了' : '练了'} ${mins} 分钟</h2>
        <p>本周第 ${s.weekDays.size} 天。漏一天，什么都不会失去。</p>
        <button class="ok" data-action="done">好</button>
      </div>`;
    overlay.className = 'show in';
  };
  if (settings.mood && !A.opts.sos) askMood((m) => { rec.moodAfter = m; save(); showDone(); });
  else { save(); showDone(); }
}

// ---------------------------------------------------------------- 事件

document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    const name = chip.dataset.chip;
    const val = chip.dataset.val;
    chip.parentElement.querySelectorAll('[data-chip]').forEach((b) => b.setAttribute('aria-checked', String(b === chip)));
    if (name === 'duration' || name === 's-duration') settings.duration = Number(val);
    else if (name === 'sky') { settings.sky = val; saveSettings(); applySky(); sunForPage(); return; }
    else if (name === 's-sound') { settings.sound = val; Sound.unlock(); Sound.startBg(val, settings.bgVolume); } // 面板里先试听
    else if (name === 's-interval') settings.interval = Number(val);
    else if (name === 's-voice') {
      settings.voice = val === '1';
      saveSettings();
      openSetup($('[data-action=begin]', overlay).dataset.id, true); // 开关人声会改变最短时长，重画面板
      return;
    }
    saveSettings();
    return;
  }

  const t = e.target.closest('[data-action],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  const a = t.dataset.action;
  if (a === 'today') { settings.last = t.dataset.id; saveSettings(); begin(t.dataset.id, Number(t.dataset.dur)); }
  else if (a === 'group') openGroup(t.dataset.cat);
  else if (a === 'setup') { if (overlay.innerHTML) openSetup(t.dataset.id, true); else openSetup(t.dataset.id); }
  else if (a === 'close-sheet') closeOverlay();
  else if (a === 'begin') { settings.last = t.dataset.id; saveSettings(); begin(t.dataset.id, settings.duration); }
  else if (a === 'sos') begin('sigh', 1, { sos: true, sound: 'none' });
  else if (a === 'pause') { if (active) active.togglePause(); }
  else if (a === 'end') { if (active) finish(false); else closeOverlay(); }
  else if (a === 'done') { closeOverlay(); tab = 'home'; render(); }
  else if (a === 'testbell') { Sound.unlock(); Sound.bell(1); }
  else if (a === 'export') exportData();
  else if (a === 'import') $('#importfile').click();
  else if (a === 'clear') {
    if (records.length && confirm(`确定清空全部 ${records.length} 条记录吗？清空后无法恢复。建议先导出。`)) { records = []; saveRecords(); render(); }
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-setting]');
  if (!el) return;
  const k = el.dataset.setting;
  settings[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
  if (k === 'volume') Sound.setVolume(settings.volume);
  if (k === 'bgVolume') Sound.setBgLevel(settings.bgVolume);
  saveSettings();
});
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.setting;
  if (k === 'volume') Sound.setVolume(Number(e.target.value));
  if (k === 'bgVolume') Sound.setBgLevel(Number(e.target.value));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (active) finish(false); else if ($('.sheet', overlay)) closeOverlay(); }
  else if (e.key === ' ' && active) { e.preventDefault(); active.togglePause(); }
});

// 导入：合并导出文件里的记录，按 id 去重，不会覆盖已有记录
document.addEventListener('change', (e) => {
  if (e.target.id !== 'importfile' || !e.target.files[0]) return;
  const f = e.target.files[0];
  e.target.value = '';
  f.text().then((txt) => {
    const data = JSON.parse(txt);
    const list = Array.isArray(data) ? data : data.records;
    if (!Array.isArray(list)) throw new Error('bad');
    const have = new Set(records.map((r) => r.id));
    const ok = list.filter((r) => r && typeof r.ts === 'number' && typeof r.actualSec === 'number' && typeof r.key === 'string' && !have.has(r.id));
    records = [...records, ...ok].sort((x, y) => x.ts - y.ts);
    saveRecords();
    alert(ok.length ? `导入了 ${ok.length} 条记录。` : '没有新的记录要导入（可能都已经在这里了）。');
    render();
  }).catch(() => alert('这个文件读不出来。请选择从一息导出的 .json 文件。'));
});

function exportData() {
  const blob = new Blob([JSON.stringify({ app: '一息', exported: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `yixi-records-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 每 5 分钟检查一次天色（跟随时间时，傍晚会自然变成夜晚）
setInterval(() => { if (!active && settings.sky === 'auto') { const before = document.documentElement.dataset.sky; applySky(); if (before !== document.documentElement.dataset.sky) render(); } }, 5 * 60 * 1000);

$('#tabs').classList.add('glass');
$('#tabs').innerHTML = [['home', '今天', ICON.home], ['stats', '记录', ICON.stats], ['settings', '设置', ICON.gear]]
  .map(([id, n, ic]) => `<button data-tab="${id}">${ic}<span>${n}</span></button>`).join('');
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线缓存失败不影响使用 */ });
}
