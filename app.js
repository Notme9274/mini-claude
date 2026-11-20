// Mini Claude — lokale chat met WebLLM (WebGPU). Alles draait in de browser, zonder server.

const WEBLLM_URLS = [
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm',
  'https://esm.run/@mlc-ai/web-llm',
];

const DEFAULT_SYSTEM =
  'Je bent Mini Claude, een behulpzame assistent die volledig offline op het apparaat van de gebruiker draait. ' +
  'Je draait op een klein open-source taalmodel en bent dus geen echt Claude-model van Anthropic; zeg dat eerlijk als iemand ernaar vraagt. ' +
  'Antwoord standaard in het Nederlands, tenzij de gebruiker een andere taal gebruikt. ' +
  'Wees beknopt, duidelijk en eerlijk. Zeg het als je iets niet zeker weet in plaats van iets te verzinnen.';

const VISION_CTX = 6144; // beeldmodellen hebben extra ruimte nodig voor de afbeelding

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Kleine instellingen in localStorage (nooit iets groots: alleen tekst)
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('miniai.' + k);
      return v === null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) {
    try {
      if (v === null) localStorage.removeItem('miniai.' + k);
      else localStorage.setItem('miniai.' + k, JSON.stringify(v));
    } catch { /* opslag niet beschikbaar: negeren */ }
  },
};

// Gesprekken (met kleine voorbeeldafbeeldingen) in IndexedDB
const idb = {
  p: null,
  open() {
    if (!this.p) {
      this.p = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('miniclaude', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'id' });
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.onblocked = () => rej(new Error('IndexedDB geblokkeerd'));
        } catch (e) { rej(e); }
      });
    }
    return this.p;
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction('chats', mode);
      const req = fn(t.objectStore('chats'));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', (s) => s.getAll()); },
  put(c) { return this.tx('readwrite', (s) => s.put(c)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
  clear() { return this.tx('readwrite', (s) => s.clear()); },
};

const newChatObj = () => ({ id: uid(), title: '', updated: Date.now(), messages: [] });

const state = {
  webllm: null,
  engine: null,
  modelId: null,
  models: [],
  f16: false,
  loading: false,
  generating: false,
  dbOK: true,
  chats: [],
  chat: newChatObj(),
  pending: null, // { full, thumb } afbeelding die bij het volgende bericht hoort
  settings: Object.assign(
    { system: DEFAULT_SYSTEM, temperature: 0.7, maxTokens: 768, memory: '' },
    store.get('settings', {})
  ),
};

const shortName = (id) => id.replace(/-MLC(-1k)?$/, '').replace(/-q4f(16|32)_1$/, '');
const modelRec = (id) => state.models.find((m) => m.model_id === id);
const isVision = (id) => /vision/i.test(id || '');
const gb = (mb) => (mb / 1024).toFixed(1).replace('.', ',');
const saveSettings = () => store.set('settings', state.settings);

let flashT = 0;
function flash(text) {
  $('#status').textContent = text;
  clearTimeout(flashT);
  flashT = setTimeout(renderStatus, 2800);
}

/* ---------- mini-markdown (veilig: eerst escapen, dan opmaak) ---------- */
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function mdText(t) {
  const lines = esc(t).split('\n');
  let out = '';
  let list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    let m;
    if ((m = raw.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; }
      out += `<li>${inline(m[1])}</li>`;
    } else if ((m = raw.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; }
      out += `<li>${inline(m[1])}</li>`;
    } else if (raw.trim() === '') {
      close();
    } else if ((m = raw.match(/^#{1,4}\s+(.*)/))) {
      close();
      out += `<p class="h">${inline(m[1])}</p>`;
    } else {
      close();
      out += `<p>${inline(raw)}</p>`;
    }
  }
  close();
  return out;
}
function md(text) {
  const parts = text.split('```');
  let html = '';
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      const nl = p.indexOf('\n');
      const body = nl >= 0 ? p.slice(nl + 1) : p;
      html += `<pre><code>${esc(body.replace(/\n$/, ''))}</code></pre>`;
    } else {
      html += mdText(p);
    }
  });
  return html;
}
function formatMessage(text) {
  // Sommige modellen beginnen met <think>…</think>: toon dat opklapbaar.
  const m = text.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (m) {
    const done = m[2] !== '';
    const rest = text.slice(m[0].length);
    return (
      `<details class="think"${done ? '' : ' open'}><summary>${done ? 'Redenering' : 'Denkt na…'}</summary>${md(m[1])}</details>` +
      md(rest)
    );
  }
  return md(text);
}

/* ---------- UI: berichten ---------- */
const scroller = () => $('#scroller');
function nearBottom() {
  const s = scroller();
  return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
}
function toBottom() { const s = scroller(); s.scrollTop = s.scrollHeight; }

function addBubble(role, text, img) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  if (img) {
    const pic = document.createElement('img');
    pic.className = 'pic';
    pic.alt = 'Meegestuurde afbeelding';
    pic.src = img;
    el.appendChild(pic);
  }
  const body = document.createElement('div');
  body.className = 'body';
  const meta = document.createElement('div');
  meta.className = 'meta';
  el.append(body, meta);
  $('#messages').appendChild(el);
  if (role === 'user') body.textContent = text;
  else body.innerHTML = formatMessage(text);
  $('#empty').hidden = true;
  return { el, body, meta };
}
function renderAll() {
  $('#messages').innerHTML = '';
  for (const m of state.chat.messages) addBubble(m.role, m.content, m.img);
  $('#empty').hidden = state.chat.messages.length > 0;
  toBottom();
}

/* ---------- opslag van gesprekken ---------- */
async function saveChat() {
  const c = state.chat;
  if (!c.messages.length) return;
  c.updated = Date.now();
  if (!c.title) {
    const first = c.messages.find((m) => m.role === 'user');
    c.title = (first?.content || 'Gesprek').replace(/\s+/g, ' ').trim().slice(0, 48);
  }
  if (!state.chats.includes(c)) state.chats.unshift(c);
  try {
    await idb.put(c);
    state.dbOK = true;
  } catch (e) {
    state.dbOK = false;
    console.warn('Opslaan mislukt', e);
  }
}

async function initChats() {
  try {
    state.chats = (await idb.all()) || [];
  } catch (e) {
    console.warn('IndexedDB niet beschikbaar', e);
    state.chats = [];
    state.dbOK = false;
  }
  // Oud, enkel gesprek uit de eerste versie overnemen
  const legacy = store.get('messages', null);
  if (Array.isArray(legacy) && legacy.length) {
    const c = { id: uid(), title: '', updated: Date.now(), messages: legacy };
    const first = legacy.find((m) => m.role === 'user');
    c.title = (first?.content || 'Gesprek').slice(0, 48);
    state.chats.push(c);
    try { await idb.put(c); } catch { /* negeren */ }
  }
  store.set('messages', null);
  state.chats.sort((a, b) => b.updated - a.updated);
  state.chat = state.chats[0] || newChatObj();
}

function resetEngineChat() {
  try { state.engine?.resetChat?.(); } catch { /* negeren */ }
}

function newChat() {
  if (state.generating) return;
  if (!state.chat.messages.length) { $('#input').focus(); return; }
  state.chat = newChatObj();
  resetEngineChat();
  clearPending();
  renderAll();
}

function openChat(id) {
  if (state.generating) return;
  const c = state.chats.find((x) => x.id === id);
  if (!c) return;
  state.chat = c;
  resetEngineChat();
  clearPending();
  renderAll();
}

async function deleteChat(id) {
  state.chats = state.chats.filter((c) => c.id !== id);
  try { await idb.del(id); } catch { /* negeren */ }
  if (state.chat.id === id) {
    state.chat = state.chats[0] || newChatObj();
    resetEngineChat();
    renderAll();
  }
}

function renderChatList() {
  const box = $('#chatList');
  box.innerHTML = '';
  const list = state.chats.filter((c) => c.messages.length).sort((a, b) => b.updated - a.updated);
  if (!list.length) {
    box.textContent = 'Nog geen opgeslagen gesprekken.';
    return;
  }
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'cached' + (c.id === state.chat.id ? ' cur' : '');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open';
    const t = document.createElement('b');
    t.textContent = c.title || 'Gesprek';
    const d = document.createElement('small');
    d.textContent = new Date(c.updated).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    open.append(t, d);
    open.addEventListener('click', () => { openChat(c.id); closeDialog('#chatsDlg'); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = 'Wissen';
    del.addEventListener('click', async () => { await deleteChat(c.id); renderChatList(); });
    row.append(open, del);
    box.appendChild(row);
  }
}

/* ---------- geheugen ---------- */
function systemText() {
  const mem = (state.settings.memory || '').trim();
  return mem
    ? state.settings.system + '\n\nNotities van de gebruiker over zichzelf ("ik" is de gebruiker):\n' + mem
    : state.settings.system;
}
function addMemory(fact) {
  const cur = (state.settings.memory || '').trim();
  state.settings.memory = (cur ? cur + '\n' : '') + '- ' + fact;
  saveSettings();
}

/* ---------- status ---------- */
function renderStatus() {
  const net = navigator.onLine ? 'online' : 'offline';
  const model = state.modelId ? shortName(state.modelId) + ' · ' : '';
  $('#status').textContent = model + net;
}
addEventListener('online', renderStatus);
addEventListener('offline', renderStatus);

/* ---------- setup-kaart ---------- */
function showSetup({ title, msg, form = false, progress = false, retry = false, cancel = false } = {}) {
  $('#setup').hidden = false;
  if (title) $('#setupTitle').textContent = title;
  $('#setupMsg').innerHTML = msg || '';
  $('#modelForm').hidden = !form;
  $('#progressWrap').hidden = !progress;
  $('#retryRow').hidden = !retry;
  $('#btnCancelSetup').hidden = !cancel;
}
const hideSetup = () => { $('#setup').hidden = true; };

function setComposerEnabled(on) {
  $('#input').disabled = !on;
  $('#btnSend').disabled = !on;
  $('#btnAttach').disabled = !on;
  $('#input').placeholder = on
    ? (isVision(state.modelId) ? 'Stel een vraag of voeg een afbeelding toe…' : 'Stel een vraag…')
    : 'Kies eerst een model…';
}

/* ---------- WebGPU + bibliotheek ---------- */
async function detectGPU() {
  if (!('gpu' in navigator)) return { ok: false, reason: 'nogpu' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'noadapter' };
    return { ok: true, f16: adapter.features.has('shader-f16') };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

async function swReady() {
  // Wacht tot de service worker de pagina bestuurt, zodat de bibliotheek meteen in de offline-cache komt.
  if (!('serviceWorker' in navigator)) return;
  try {
    await Promise.race([navigator.serviceWorker.ready, sleep(4000)]);
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })),
        sleep(1500),
      ]);
    }
  } catch { /* geen service worker: doorgaan */ }
}

async function loadLib() {
  let lastErr;
  for (const url of WEBLLM_URLS) {
    try { return await import(url); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------- modellenlijst ---------- */
function buildModelList(all) {
  const quant = state.f16 ? 'q4f16_1' : 'q4f32_1';
  const want = /^(Llama-3\.2-(1B|3B)-Instruct|Qwen2\.5-(0\.5B|1\.5B|3B)-Instruct|gemma-2-2b-it|SmolLM2-(360M|1\.7B)-Instruct|Phi-3\.5-mini-instruct|Phi-3\.5-vision-instruct)/;
  let list = all.filter(
    (m) => want.test(m.model_id) && m.model_id.includes(quant) && (m.vram_required_MB || 0) <= 6000
  );
  if (!list.length) list = all.filter((m) => m.model_id.includes(quant) && (m.vram_required_MB || 0) <= 3500 && !isVision(m.model_id));
  if (!list.length) list = all.slice();
  return list.sort((a, b) => (a.vram_required_MB || 0) - (b.vram_required_MB || 0));
}

async function refreshModelOptions() {
  const sel = $('#modelSelect');
  const prev = sel.value || store.get('lastModel');
  sel.innerHTML = '';
  for (const m of state.models) {
    let cached = false;
    try { cached = await state.webllm.hasModelInCache(m.model_id); } catch { /* negeren */ }
    m._cached = cached;
    const o = document.createElement('option');
    o.value = m.model_id;
    const short = m.model_id.endsWith('-1k') ? ' · korte context' : '';
    const vis = isVision(m.model_id) ? ' · leest afbeeldingen' : '';
    o.textContent = `${shortName(m.model_id)}${short}${vis} · ${gb(m.vram_required_MB || 0)} GB${cached ? ' · ✓ gedownload' : ''}`;
    sel.appendChild(o);
  }
  const has = (id) => [...sel.options].some((o) => o.value === id);
  if (prev && has(prev)) sel.value = prev;
  else {
    const def = state.models.find((m) => /^Llama-3\.2-1B-Instruct/.test(m.model_id) && !m.model_id.endsWith('-1k'));
    sel.value = def ? def.model_id : sel.options[0]?.value;
  }
  updateModelHint();
}

function updateModelHint() {
  const rec = modelRec($('#modelSelect').value);
  if (!rec) return;
  const heavy = (rec.vram_required_MB || 0) > 2400;
  let t = rec._cached
    ? 'Staat al op dit apparaat; start ook zonder internet.'
    : 'Wordt eenmalig gedownload (gebruik wifi). Daarna werkt het offline.';
  if (isVision(rec.model_id)) t += ' Dit model kan ook afbeeldingen lezen (één per bericht).';
  if (heavy) t += ' <span class="warn">Zwaar model: alleen aanbevolen voor iPads met 8 GB RAM of meer.</span>';
  $('#modelHint').innerHTML = t;
  $('#btnLoad').textContent = rec._cached ? 'Model starten' : 'Downloaden en starten';
}

/* ---------- model laden ---------- */
function onProgress(r) {
  const pct = Math.max(0, Math.min(1, r.progress || 0));
  $('#barFill').style.width = (pct * 100).toFixed(0) + '%';
  $('#progressText').textContent = (r.text || '').slice(0, 160) || `${(pct * 100).toFixed(0)}%`;
}

async function loadModel(id) {
  if (state.loading || !id) return;
  const rec = modelRec(id);
  if (!navigator.onLine && rec && !rec._cached) {
    showSetup({
      title: 'Geen internet',
      msg: 'Dit model is nog niet gedownload. Maak één keer verbinding met internet, of kies een model met ✓.',
      form: true, cancel: !!state.modelId,
    });
    return;
  }
  state.loading = true;
  setComposerEnabled(false);
  showSetup({
    title: rec?._cached ? 'Model laden…' : 'Model downloaden…',
    msg: rec?._cached
      ? 'Het model wordt uit de opslag van je iPad geladen.'
      : 'Houd dit scherm open en blijf op wifi. Dit hoeft maar één keer.',
    progress: true,
  });
  $('#barFill').style.width = '0%';
  $('#progressText').textContent = 'Starten…';

  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* niet beschikbaar */ }
  store.set('loadingModel', id); // markering: wordt gewist zodra laden klaar is

  try {
    if (!state.engine) state.engine = new state.webllm.MLCEngine({ initProgressCallback: onProgress });
    else state.engine.setInitProgressCallback(onProgress);
    await state.engine.reload(id, isVision(id) ? { context_window_size: VISION_CTX } : undefined);
    state.modelId = id;
    store.set('lastModel', id);
    store.set('loadingModel', null);
    try { navigator.storage?.persist?.(); } catch { /* negeren */ }
    if (!isVision(id)) clearPending();
    hideSetup();
    setComposerEnabled(true);
    $('#input').focus();
  } catch (err) {
    console.error(err);
    store.set('loadingModel', null);
    state.modelId = null;
    const msg = String(err?.message || err);
    const mem = /memory|alloc|lost|OOM|buffer/i.test(msg);
    showSetup({
      title: 'Laden mislukt',
      msg:
        (mem
          ? 'Waarschijnlijk te weinig geheugen. Kies een kleiner model (bijv. Llama-3.2-1B of Qwen2.5-0.5B). '
          : 'Er ging iets mis. Controleer je internetverbinding en probeer het opnieuw. ') +
        `<br><span class="small">${esc(msg).slice(0, 220)}</span>`,
      form: true,
    });
  } finally {
    state.loading = false;
    try { wake?.release?.(); } catch { /* negeren */ }
    renderStatus();
    refreshModelOptions();
  }
}

/* ---------- afbeeldingen ---------- */
function shrink(img, max, quality) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // doorzichtige PNG's niet zwart laten worden
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { full: shrink(img, 768, 0.85), thumb: shrink(img, 320, 0.7) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderPending() {
  const p = state.pending;
  $('#attachPrev').hidden = !p;
  if (p) $('#attachImg').src = p.thumb;
}
function clearPending() {
  state.pending = null;
  renderPending();
}

function onAttachClick() {
  if (!state.modelId || state.generating) return;
  if (!isVision(state.modelId)) {
    const vis = state.models.find((m) => isVision(m.model_id));
    showSetup({
      title: 'Afbeeldingen lezen',
      msg: vis
        ? 'Het huidige model kan geen afbeeldingen lezen. Kies <b>Phi-3.5-vision</b>. Dat is een zwaar model (ongeveer 4 GB geheugen), dus vooral geschikt voor iPads met 8 GB RAM of meer.'
        : 'Dit apparaat toont geen beeldmodel. Het heeft waarschijnlijk te weinig geheugen of mist ondersteuning (shader-f16).',
      form: !!vis, cancel: true,
    });
    if (vis) { $('#modelSelect').value = vis.model_id; updateModelHint(); }
    return;
  }
  $('#file').click();
}

async function onFileChosen(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    flash('Afbeelding verwerken…');
    state.pending = await prepareImage(file);
    renderPending();
    renderStatus();
    $('#input').focus();
  } catch (err) {
    console.warn(err);
    flash('Afbeelding kon niet gelezen worden');
  }
}

/* ---------- gesprek ---------- */
function buildPrompt(fullImg) {
  const vision = isVision(state.modelId);
  const rec = modelRec(state.modelId);
  const ctx = vision ? VISION_CTX : rec?.overrides?.context_window_size || 4096;
  const maxTok = Math.max(128, Math.min(state.settings.maxTokens, Math.floor(ctx / 2)));
  const sys = systemText();
  const reserve = fullImg ? 2200 : 0; // een afbeelding kost veel tokens
  const budget = Math.max(600, (ctx - maxTok - 150 - reserve) * 3); // ruwe schatting: 3 tekens per token

  let used = sys.length;
  const picked = [];
  const all = state.chat.messages;
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    if (!m.content) continue;
    if (used + m.content.length > budget && picked.length > 0) break;
    used += m.content.length;
    picked.unshift(m);
  }
  while (picked.length && picked[0].role !== 'user') picked.shift();

  const msgs = picked.map((m, i) => {
    let c = m.content;
    const isLast = i === picked.length - 1;
    if (m.img && !(isLast && fullImg)) c += ' (met afbeelding)';
    return { role: m.role, content: c };
  });

  if (vision) {
    // Beeldmodellen krijgen geen aparte systeemrol: de instructies gaan voorop het eerste bericht.
    if (msgs[0]) msgs[0].content = sys + '\n\n' + msgs[0].content;
  } else {
    msgs.unshift({ role: 'system', content: sys });
  }
  if (fullImg && msgs.length) {
    const last = msgs[msgs.length - 1];
    last.content = [
      { type: 'text', text: last.content },
      { type: 'image_url', image_url: { url: fullImg } },
    ];
  }
  return { messages: msgs, maxTok };
}

function setGenerating(on) {
  state.generating = on;
  const icon = $('#iconSend');
  icon.innerHTML = on ? '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>' : '<path d="M12 19V5M5 12l7-7 7 7"/>';
  $('#btnSend').setAttribute('aria-label', on ? 'Stop' : 'Verstuur');
  $('#btnSend').disabled = !state.modelId;
  $('#btnAttach').disabled = on || !state.modelId;
}

async function send(text) {
  if (state.generating || !state.modelId) return;
  text = text.trim();
  const pend = state.pending;
  if (!text && !pend) return;
  if (!text) text = 'Beschrijf deze afbeelding.';

  const mm = text.match(/^\s*onthoud(?:\s+dat)?\s*[:,]?\s+(.{3,})/i);
  if (mm) { addMemory(mm[1].trim()); flash('Onthouden ✓'); }

  const userMsg = { role: 'user', content: text };
  if (pend) userMsg.img = pend.thumb;
  state.chat.messages.push(userMsg);
  clearPending();
  addBubble('user', text, userMsg.img);
  toBottom();
  saveChat();

  const { messages, maxTok } = buildPrompt(pend?.full);
  const b = addBubble('assistant', '');
  b.body.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  toBottom();
  setGenerating(true);

  let out = '';
  let chunks = 0;
  let t0 = 0;
  let tps = 0;
  let raf = 0;
  const paint = () => {
    raf = 0;
    const stick = nearBottom();
    b.body.innerHTML = formatMessage(out);
    if (stick) toBottom();
  };

  try {
    const stream = await state.engine.chat.completions.create({
      messages,
      stream: true,
      temperature: state.settings.temperature,
      top_p: 0.95,
      max_tokens: maxTok,
      stream_options: { include_usage: true },
    });
    for await (const chunk of stream) {
      const d = chunk.choices?.[0]?.delta?.content;
      if (d) {
        if (!t0) t0 = performance.now();
        out += d;
        chunks++;
        if (!raf) raf = requestAnimationFrame(paint);
      }
      const u = chunk.usage?.extra?.decode_tokens_per_s;
      if (u) tps = u;
    }
    if (!tps && t0 && chunks > 3) tps = chunks / ((performance.now() - t0) / 1000);
    if (raf) cancelAnimationFrame(raf);
    if (out) {
      b.body.innerHTML = formatMessage(out);
      if (tps) b.meta.textContent = `${tps.toFixed(1).replace('.', ',')} tokens/s`;
    } else {
      b.el.remove();
    }
  } catch (err) {
    console.error(err);
    if (raf) cancelAnimationFrame(raf);
    const msg = String(err?.message || err);
    const lost = /lost|out of memory|OOM|alloc/i.test(msg);
    b.body.innerHTML =
      formatMessage(out) +
      `<p class="err">⚠️ ${lost ? 'Het geheugen van de GPU is vol of de verbinding met de GPU is verbroken. Kies een kleiner model.' : 'Er ging iets mis bij het genereren.'}<br><span class="small">${esc(msg).slice(0, 200)}</span></p>`;
    if (lost) {
      state.modelId = null;
      state.engine = null;
      setComposerEnabled(false);
      renderStatus();
      refreshModelOptions().then(() => showSetup({ title: 'Kies een kleiner model', msg: 'Het vorige model paste niet in het geheugen.', form: true }));
    }
  } finally {
    if (out) state.chat.messages.push({ role: 'assistant', content: out });
    await saveChat();
    setGenerating(false);
    if (state.modelId) { setComposerEnabled(true); $('#input').focus(); }
  }
}

/* ---------- dialogs ---------- */
function openDialog(sel) {
  const d = $(sel);
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}
function closeDialog(sel) {
  const d = $(sel);
  if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
}

async function renderCached() {
  const box = $('#cachedList');
  box.innerHTML = '';
  let any = false;
  for (const m of state.models) {
    let cached = false;
    try { cached = await state.webllm.hasModelInCache(m.model_id); } catch { /* negeren */ }
    if (!cached) continue;
    any = true;
    const row = document.createElement('div');
    row.className = 'cached';
    const name = document.createElement('span');
    name.textContent = shortName(m.model_id) + (m.model_id === state.modelId ? ' (actief)' : '');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = 'Verwijderen';
    del.addEventListener('click', async () => {
      if (!confirm(`${shortName(m.model_id)} van dit apparaat verwijderen?`)) return;
      try {
        if (m.model_id === state.modelId) {
          await state.engine.unload();
          state.modelId = null;
          setComposerEnabled(false);
          renderStatus();
        }
        await state.webllm.deleteModelAllInfoInCache(m.model_id);
      } catch (e) { console.error(e); }
      await refreshModelOptions();
      await renderCached();
      if (!state.modelId) { closeDialog('#settings'); showSetup({ title: 'Kies een model', msg: 'Kies welk model je wilt gebruiken.', form: true }); }
    });
    row.append(name, del);
    box.appendChild(row);
  }
  if (!any) box.textContent = 'Nog geen modellen gedownload.';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) $('#storageInfo').textContent = `Opslag in gebruik door deze app: ${(est.usage / 1048576).toFixed(0)} MB.` + (state.dbOK ? '' : ' Let op: gesprekken kunnen op dit apparaat niet worden bewaard.');
  } catch { /* negeren */ }
}

function openSettings() {
  $('#setMemory').value = state.settings.memory || '';
  $('#setSystem').value = state.settings.system;
  $('#setTemp').value = state.settings.temperature;
  $('#tempVal').textContent = Number(state.settings.temperature).toFixed(2).replace('.', ',');
  $('#setMax').value = String(state.settings.maxTokens);
  openDialog('#settings');
  if (state.webllm) renderCached();
}

async function wipeAll() {
  if (state.generating) return;
  if (!confirm('Alle opgeslagen gesprekken wissen? Je geheugennotitie blijft bewaard.')) return;
  try { await idb.clear(); } catch { /* negeren */ }
  state.chats = [];
  state.chat = newChatObj();
  resetEngineChat();
  renderAll();
  closeDialog('#settings');
}

/* ---------- start ---------- */
function autosize() {
  const el = $('#input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function wireUI() {
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.generating) { try { state.engine.interruptGenerate(); } catch { /* negeren */ } return; }
    const v = $('#input').value;
    if (!v.trim() && !state.pending) return;
    $('#input').value = '';
    autosize();
    send(v);
  });
  const input = $('#input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!state.generating) $('#composer').requestSubmit();
    }
  });
  input.addEventListener('input', autosize);
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && state.modelId) send(b.textContent);
  });

  $('#btnAttach').addEventListener('click', onAttachClick);
  $('#file').addEventListener('change', onFileChosen);
  $('#btnAttachRemove').addEventListener('click', clearPending);

  $('#btnNew').addEventListener('click', newChat);
  $('#btnChats').addEventListener('click', () => { renderChatList(); openDialog('#chatsDlg'); });
  $('#btnCloseChats').addEventListener('click', () => closeDialog('#chatsDlg'));
  $('#btnNewFromList').addEventListener('click', () => { newChat(); closeDialog('#chatsDlg'); });

  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnCloseSettings').addEventListener('click', () => closeDialog('#settings'));
  $('#btnSwitch').addEventListener('click', () => {
    closeDialog('#settings');
    showSetup({ title: 'Kies een model', msg: '', form: true, cancel: !!state.modelId });
  });
  $('#btnReset').addEventListener('click', () => {
    state.settings.system = DEFAULT_SYSTEM;
    $('#setSystem').value = DEFAULT_SYSTEM;
    saveSettings();
  });
  $('#btnWipe').addEventListener('click', wipeAll);
  $('#setMemory').addEventListener('input', (e) => { state.settings.memory = e.target.value; saveSettings(); });
  $('#setSystem').addEventListener('input', (e) => { state.settings.system = e.target.value; saveSettings(); });
  $('#setTemp').addEventListener('input', (e) => {
    state.settings.temperature = parseFloat(e.target.value);
    $('#tempVal').textContent = state.settings.temperature.toFixed(2).replace('.', ',');
    saveSettings();
  });
  $('#setMax').addEventListener('change', (e) => { state.settings.maxTokens = parseInt(e.target.value, 10); saveSettings(); });

  $('#modelSelect').addEventListener('change', updateModelHint);
  $('#btnLoad').addEventListener('click', () => loadModel($('#modelSelect').value));
  $('#btnCancelSetup').addEventListener('click', hideSetup);
  $('#btnRetry').addEventListener('click', () => location.reload());

  $('#btnHintClose').addEventListener('click', () => { $('#installHint').hidden = true; store.set('hintClosed', true); });
}

function maybeShowInstallHint() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (ios && !standalone && !store.get('hintClosed', false)) $('#installHint').hidden = false;
}

async function main() {
  wireUI();
  await initChats();
  renderAll();
  renderStatus();
  setComposerEnabled(false);
  maybeShowInstallHint();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker mislukt:', e));
  }

  showSetup({ title: 'Even geduld…', msg: 'Apparaat controleren.' });

  const gpu = await detectGPU();
  if (!gpu.ok) {
    showSetup({
      title: 'WebGPU niet beschikbaar',
      msg:
        'Deze browser kan geen lokale AI-modellen draaien. Je hebt <b>iPadOS 26 of nieuwer</b> nodig (Safari). ' +
        'Controleer onder Instellingen → Algemeen → Software-update. Open de app in Safari of vanaf het beginscherm.',
      retry: true,
    });
    return;
  }
  state.f16 = gpu.f16;

  await swReady();
  try {
    state.webllm = await loadLib();
  } catch (e) {
    console.error(e);
    showSetup({
      title: 'Bibliotheek niet geladen',
      msg: navigator.onLine
        ? 'De AI-bibliotheek kon niet worden opgehaald. Probeer het zo opnieuw.'
        : 'Je bent offline en de app is nog nooit online geopend, dus de bibliotheek staat nog niet in de cache. Open de app één keer met internet.',
      retry: true,
    });
    return;
  }

  state.models = buildModelList(state.webllm.prebuiltAppConfig.model_list);
  await refreshModelOptions();

  const crashed = store.get('loadingModel', null);
  const last = store.get('lastModel', null);
  if (crashed) {
    store.set('loadingModel', null);
    showSetup({
      title: 'Laden niet afgerond',
      msg: `Het laden van <b>${esc(shortName(crashed))}</b> werd vorige keer niet afgerond. Dat kan komen doordat je de app sloot, of doordat er te weinig geheugen was. Probeer het opnieuw of kies een kleiner model.`,
      form: true,
    });
    return;
  }
  const rec = last && modelRec(last);
  if (rec?._cached) {
    loadModel(last); // direct starten vanuit de opslag, ook offline
  } else {
    showSetup({
      title: 'Kies een model',
      msg: 'Begin met het kleinste model. Het wordt één keer gedownload (ongeveer 0,5 tot 2 GB) en werkt daarna zonder internet.',
      form: true,
    });
  }
}

main();
