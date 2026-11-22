// ---------- Idiomas: [código de fala, código de tradução, nome] ----------
const LANGS = [
  ['de-DE', 'de', 'Alemão'], ['ar-SA', 'ar', 'Árabe'], ['zh-CN', 'zh-CN', 'Chinês'], ['ko-KR', 'ko', 'Coreano'],
  ['es-ES', 'es', 'Espanhol'], ['fr-FR', 'fr', 'Francês'], ['he-IL', 'he', 'Hebraico'], ['hi-IN', 'hi', 'Hindi'],
  ['nl-NL', 'nl', 'Holandês'], ['en-US', 'en', 'Inglês'], ['it-IT', 'it', 'Italiano'], ['ja-JP', 'ja', 'Japonês'],
  ['la', 'la', 'Latim'], ['pl-PL', 'pl', 'Polonês'], ['pt-BR', 'pt', 'Português (BR)'], ['pt-PT', 'pt-PT', 'Português (PT)'],
  ['ru-RU', 'ru', 'Russo'], ['tr-TR', 'tr', 'Turco'],
];
const TR = new Map(LANGS.map(([s, t]) => [s, t]));
const NAME = new Map(LANGS.map(([s, , n]) => [s, n]));

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const srcSel = $('src');
const dstSel = $('dst');
srcSel.innerHTML = dstSel.innerHTML = LANGS.map(([c, , n]) => `<option value="${c}">${n}</option>`).join('');
srcSel.value = store.get('tv.src', 'pt-BR');
dstSel.value = store.get('tv.dst', 'en-US');
if (!srcSel.value) srcSel.value = 'pt-BR';
if (!dstSel.value) dstSel.value = 'en-US';

// ---------- Utilidades ----------
function speak(text, lang) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang.replace('_', '-') === lang) || voices.find((v) => v.lang.startsWith(lang.slice(0, 2))) || null;
  speechSynthesis.speak(u);
}

function copy(text, btn) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const use = btn.querySelector('use');
    use.setAttribute('href', '#i-check');
    setTimeout(() => use.setAttribute('href', '#i-copy'), 1200);
  }, () => {});
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- Tradução: Google (~0,35 s) com fallback MyMemory e cache ----------
const cache = new Map();
const withTimeout = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

async function translate(q, from, to, signal) {
  const sl = TR.get(from), tl = TR.get(to);
  if (sl === tl) return q;
  const key = `${sl}|${tl}|${q}`;
  if (cache.has(key)) return cache.get(key);
  let out;
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${sl}&tl=${tl}&q=${encodeURIComponent(q)}`, { signal: withTimeout(signal, 3000) });
    if (!r.ok) throw new Error(r.status);
    out = (await r.json())[0].map((s) => s[0]).join('');
  } catch (e) {
    if (signal?.aborted) throw e;
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${sl}|${tl}`, { signal: withTimeout(signal, 6000) });
    const j = await r.json();
    if (+j.responseStatus !== 200) throw new Error(j.responseDetails || 'serviço indisponível');
    const t = document.createElement('textarea');
    t.innerHTML = j.responseData.translatedText;
    out = t.value;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

// ---------- Tema ----------
const root = document.documentElement;
$('theme').onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  store.set('tv.theme', root.dataset.theme);
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!store.get('tv.theme')) root.dataset.theme = e.matches ? 'dark' : 'light';
});

// ---------- Histórico (simples: tradução + original, mais recente primeiro) ----------
const histSec = $('history');
const histEl = $('hist');
const tpl = $('tpl-item').content.firstElementChild;
const MAX_HIST = 100;
let hist = [];
try { hist = (JSON.parse(store.get('tv.hist', '[]')) || []).slice(0, MAX_HIST); } catch {}
let saveTimer;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('tv.hist', JSON.stringify(hist)), 500); };

function fill(li, e) {
  li.dataset.id = e.id;
  const tran = li.firstElementChild;
  tran.className = 'tran' + (e.err ? ' err' : e.dst == null ? ' pending' : '');
  tran.textContent = e.err ? 'Falha na tradução' : e.dst ?? 'Traduzindo…';
  tran.nextElementSibling.textContent = e.src;
  return li;
}

function renderHist() {
  const frag = document.createDocumentFragment();
  for (const e of hist) frag.append(fill(tpl.cloneNode(true), e));
  histEl.replaceChildren(frag);
  histSec.hidden = !hist.length;
}

function addEntry(e) {
  hist.unshift(e);
  histEl.prepend(fill(tpl.cloneNode(true), e));
  if (hist.length > MAX_HIST) { hist.length = MAX_HIST; histEl.lastElementChild.remove(); }
  histSec.hidden = false;
  save();
  return e;
}

function updateEntry(e) {
  const li = histEl.querySelector(`[data-id="${e.id}"]`);
  if (li) fill(li, e);
  save();
}

function translateEntry(e) {
  return translate(e.src, e.sl, e.tl).then(
    (t) => { e.dst = t; e.err = false; },
    () => { e.err = true; },
  ).finally(() => updateEntry(e));
}

histEl.onclick = (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const e = hist.find((x) => x.id === btn.closest('.item').dataset.id);
  if (!e) return;
  if (btn.dataset.act === 'speak') speak(e.dst, e.tl);
  else copy(e.dst, btn);
};

$('clearHist').onclick = () => {
  if (!confirm('Limpar o histórico?')) return;
  hist = [];
  draft = null;
  renderHist();
  save();
};

// ---------- Modo texto ----------
const input = $('input');
const output = $('output');
let textTimer, textCtrl, textSeq = 0, draft = null, draftTimer;

input.oninput = () => {
  $('count').textContent = `${input.value.length} / 5000`;
  clearTimeout(textTimer);
  textTimer = setTimeout(runText, 250);
};

async function runText() {
  const q = input.value.trim();
  textCtrl?.abort();
  clearTimeout(draftTimer);
  if (!q) { output.textContent = ''; output.className = ''; draft = null; return; }
  const seq = ++textSeq;
  const ctrl = (textCtrl = new AbortController());
  const from = srcSel.value, to = dstSel.value;
  output.classList.add('pending');
  try {
    const t = await translate(q, from, to, ctrl.signal);
    if (seq !== textSeq) return;
    output.className = '';
    output.textContent = t;
    // Salva no histórico quando o usuário para de digitar; edições seguintes atualizam a mesma entrada
    draftTimer = setTimeout(() => {
      if (draft && draft.sl === from && draft.tl === to && hist.includes(draft)) {
        Object.assign(draft, { src: q, dst: t, t: Date.now(), err: false });
        updateEntry(draft);
      } else draft = addEntry({ id: uid(), sl: from, tl: to, src: q, dst: t, t: Date.now() });
    }, 1500);
  } catch {
    if (seq !== textSeq || ctrl.signal.aborted) return;
    output.className = 'err';
    output.textContent = 'Falha na tradução. Verifique sua conexão.';
  }
}

$('inClear').onclick = () => { input.value = ''; input.oninput(); runText(); input.focus(); };
$('inSpeak').onclick = () => speak(input.value.trim(), srcSel.value);
$('outSpeak').onclick = () => speak(output.className ? '' : output.textContent, dstSel.value);
$('outCopy').onclick = (ev) => copy(output.className ? '' : output.textContent, ev.currentTarget);

// ---------- Modo voz (Whisper local, sem censura, funciona em qualquer navegador) ----------
const mic = $('mic');
const statusEl = $('status');
const live = $('live');
const status = (t) => { statusEl.textContent = t; };
const listeningMsg = () => `Ouvindo em ${NAME.get(srcSel.value)}…`;
const MODEL_BYTES = 76e6;

// Detector de fala (VAD) roda no thread de áudio e envia cada frase completa ao Whisper.
// Sem prévias parciais: o Whisper processa sempre uma janela de 30 s, então cada prévia
// custava o mesmo que uma frase inteira e atrasava (e travava) tudo.
const WORKLET = `
const OUT = 16000;
class Vad extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pre = []; this.buf = []; this.len = 0; this.voiced = 0; this.silence = 0;
    this.noise = 0.005; this.talking = false;
    this.port.onmessage = () => this.emit();
  }
  concat() {
    const src = new Float32Array(this.len);
    let o = 0;
    for (const c of this.buf) { src.set(c, o); o += c.length; }
    if (sampleRate === OUT) return src;
    const ratio = sampleRate / OUT, n = Math.floor(src.length / ratio), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * ratio, j = x | 0, f = x - j;
      out[i] = src[j] * (1 - f) + (src[j + 1] ?? src[j]) * f;
    }
    return out;
  }
  emit() {
    if (this.voiced > sampleRate * 0.25) { const a = this.concat(); this.port.postMessage(a, [a.buffer]); }
    else if (this.len) this.port.postMessage(null);
    this.buf = []; this.len = 0; this.voiced = 0; this.silence = 0;
  }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    let e = 0;
    for (let i = 0; i < ch.length; i++) e += ch[i] * ch[i];
    e = Math.sqrt(e / ch.length);
    const speech = e > Math.max(0.012, this.noise * 3);
    if (!speech) this.noise += (e - this.noise) * 0.01;
    const c = ch.slice();
    if (this.len || speech) {
      if (!this.len) { for (const p of this.pre) { this.buf.push(p); this.len += p.length; } this.pre = []; }
      this.buf.push(c); this.len += c.length;
      if (speech) { this.voiced += c.length; this.silence = 0; } else this.silence += c.length;
      if (this.silence > sampleRate * 0.45 || this.len > sampleRate * 20) this.emit();
    } else {
      this.pre.push(c);
      if (this.pre.length > 30) this.pre.shift();
    }
    const talking = this.len > 0 && this.silence < sampleRate * 0.25;
    if (talking !== this.talking) { this.talking = talking; this.port.postMessage(talking); }
    return true;
  }
}
registerProcessor('vad', Vad);`;
const workletURL = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));

let workerP = null, worker = null, audio = null, running = false, segId = 0, finals = 0;
const segs = new Map();

function loadWorker() {
  return (workerP ??= new Promise((resolve, reject) => {
    const w = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    const fail = (msg) => {
      workerP = null;
      w.terminate();
      status(`Não foi possível preparar o reconhecimento de voz (${msg}).`);
      reject(new Error(msg));
    };
    w.onerror = (e) => { e.preventDefault(); fail(e.message || 'erro ao iniciar'); };
    w.onmessage = ({ data: d }) => {
      if (d.type === 'progress') status(`Preparando reconhecimento de voz… ${Math.min(99, Math.round((d.loaded / MODEL_BYTES) * 100))}%`);
      else if (d.type === 'ready') {
        w.onmessage = onWorker;
        worker = w;
        status(running ? listeningMsg() : 'Toque no microfone para falar');
        resolve(w);
      } else if (d.type === 'error') fail(d.message);
    };
    status('Preparando reconhecimento de voz…');
    w.postMessage({ type: 'load' });
  }));
}

function onWorker({ data: d }) {
  const meta = segs.get(d.id);
  segs.delete(d.id);
  finals = Math.max(0, finals - 1);
  if (!finals) live.textContent = '';
  if (d.type === 'result' && d.text && meta) {
    const e = addEntry({ id: uid(), sl: meta.sl, tl: meta.tl, src: d.text, dst: null, t: Date.now() });
    translateEntry(e);
  }
}

function onAudio({ data }) {
  if (typeof data === 'boolean') { mic.classList.toggle('talk', data); return; }
  if (data === null) return;
  const language = srcSel.value.slice(0, 2);
  const id = ++segId;
  finals++;
  live.textContent = 'Transcrevendo…';
  segs.set(id, { sl: srcSel.value, tl: dstSel.value });
  worker.postMessage({ type: 'transcribe', id, audio: data, language }, [data.buffer]);
}

async function start() {
  running = true;
  mic.classList.add('on');
  mic.setAttribute('aria-pressed', 'true');
  try { await loadWorker(); } catch { return stop(statusEl.textContent); }
  if (!running) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let ctx, source;
    try {
      ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      source = ctx.createMediaStreamSource(stream);
    } catch { // navegadores que não reamostram o microfone (ex.: Firefox): o VAD reamostra
      ctx?.close();
      ctx = new AudioContext({ latencyHint: 'interactive' });
      source = ctx.createMediaStreamSource(stream);
    }
    await ctx.audioWorklet.addModule(workletURL);
    const node = new AudioWorkletNode(ctx, 'vad');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    node.port.onmessage = onAudio;
    audio = { stream, ctx, node };
    if (!running) return releaseAudio();
    status(listeningMsg());
  } catch (e) {
    releaseAudio();
    stop(e.name === 'NotAllowedError' ? 'Microfone bloqueado. Libere a permissão no navegador.' : `Erro no microfone: ${e.message}`);
  }
}

function releaseAudio() {
  const a = audio;
  audio = null;
  if (!a) return;
  a.node.port.postMessage('flush'); // envia a última frase antes de fechar
  a.stream.getTracks().forEach((t) => t.stop());
  setTimeout(() => a.ctx.close(), 150);
}

function stop(msg = 'Toque no microfone para falar') {
  running = false;
  mic.classList.remove('on', 'talk');
  mic.setAttribute('aria-pressed', 'false');
  releaseAudio();
  status(msg);
}

mic.onclick = () => (running ? stop() : start());

// ---------- Modos ----------
const tabs = document.querySelectorAll('[data-mode]');
function setMode(m) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === m));
  $('voice').hidden = m !== 'voice';
  $('text').hidden = m !== 'text';
  store.set('tv.mode', m);
  if (m === 'voice') loadWorker().catch(() => {});
  else { if (running) stop(); input.focus(); }
}
for (const t of tabs) t.onclick = () => setMode(t.dataset.mode);

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || $('voice').hidden || e.repeat) return;
  if (e.target.closest('input, textarea, select, button')) return;
  e.preventDefault();
  mic.click();
});

// ---------- Idiomas ----------
function onLang() {
  store.set('tv.src', srcSel.value);
  store.set('tv.dst', dstSel.value);
  if (running) status(listeningMsg());
  if (!$('text').hidden && input.value.trim()) runText();
}
srcSel.onchange = dstSel.onchange = onLang;
$('swap').onclick = () => {
  [srcSel.value, dstSel.value] = [dstSel.value, srcSel.value];
  if (!$('text').hidden && output.textContent && !output.className) {
    input.value = output.textContent;
    $('count').textContent = `${input.value.length} / 5000`;
  }
  onLang();
};

// ---------- Início ----------
renderHist();
for (const e of hist) if (e.dst == null && !e.err) translateEntry(e); // retoma traduções interrompidas
setMode(store.get('tv.mode', 'voice'));
