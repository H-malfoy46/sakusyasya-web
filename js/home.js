// js/home.js
//
// トップ：自分の交換票を作る（最新のシーンから求・譲を選ぶ）→ 二次元コードとリンク。
//         相手の二次元コードをカメラ・写真から読む → /t/#コード で相手の交換票を開く。
//
// ・自分の交換票は、この端末のブラウザの中（localStorage）だけに保存する。サーバーには送らない
// ・11/21 12:00 を過ぎたら、保存を消して終了の案内だけ出す（common.js）

import { checkOpenOrClose, loadCodec, loadHistory, loadMine, saveMine } from './common.js';
import { LINK_BASE, extractCode } from './codec.js';
import { displayMember, el, poseLabel, renderQr } from './view.js';

const $ = (id) => document.getElementById(id);

let codec;
let mine = { name: '', give: new Set(), want: new Set(), count: {} };
let lookingFor = true; // true＝求を選んでいる、false＝譲
const openScenes = new Set();

async function main() {
  if (!checkOpenOrClose()) {
    $('ended').hidden = false;
    return;
  }
  try {
    codec = await loadCodec('.');
  } catch (_) {
    return showError('データを読み込めませんでした。通信のよい所でもう一度開いてください');
  }
  const saved = loadMine();
  if (saved) {
    // 今のデータに無いマス（古いシーンなど）は落とす。
    const known = new Set(codec.buildTiles(codec.scenes.map((s) => s.index)));
    mine = {
      name: saved.name,
      give: new Set([...saved.give].filter((k) => known.has(k))),
      want: new Set([...saved.want].filter((k) => known.has(k))),
      count: saved.count || {},
    };
    // 枚数が無い（古い保存）譲は 1 枚として扱う。
    for (const k of mine.give) if (!(mine.count[k] > 0)) mine.count[k] = 1;
  }
  // 最初は一番新しいシーンだけ開いておく。
  if (codec.scenes[0]) openScenes.add(codec.scenes[0].title);

  $('name').value = mine.name;
  $('name').addEventListener('input', () => {
    mine.name = $('name').value;
    persist();
  });
  $('tabWant').addEventListener('click', () => { lookingFor = true; drawScenes(); });
  $('tabGive').addEventListener('click', () => { lookingFor = false; drawScenes(); });
  $('showQr').addEventListener('click', showQr);
  $('copy').addEventListener('click', copyLink);
  $('share').addEventListener('click', shareLink);
  $('scan').addEventListener('click', startScan);
  $('stopScan').addEventListener('click', stopScan);
  $('photo').addEventListener('change', readPhoto);
  if (!navigator.share) $('share').hidden = true;

  drawScenes();
  drawHistory();
  $('app').hidden = false;
}

function persist() {
  saveMine(mine);
  $('qrcard').hidden = true; // 中身が変わったら、古い二次元コードは隠す
}

// ---- 求・譲を選ぶ表 ----

function drawScenes() {
  $('tabWant').classList.toggle('on', lookingFor);
  $('tabGive').classList.toggle('on', !lookingFor);
  const set = lookingFor ? mine.want : mine.give;
  const otherSet = lookingFor ? mine.give : mine.want;

  const out = codec.scenes.map((s) => {
    const open = openScenes.has(s.title);
    const count = s.members.reduce(
      (n, m) => n + m.poses.filter((p) => set.has(`${s.title}|${m.name}|${p}`)).length, 0);
    const head = el('button', { class: 'scene-head', type: 'button' },
      el('span', { class: 'scene-title' }, s.title),
      el('span', { class: 'scene-count' }, count ? String(count) : ''),
      el('span', { class: 'caret' }, open ? '▲' : '▼'));
    head.addEventListener('click', () => {
      if (open) openScenes.delete(s.title); else openScenes.add(s.title);
      drawScenes();
    });
    const wrap = el('div', { class: 'scene' }, head);
    if (!open) return wrap;
    for (const m of s.members) {
      const chips = el('div', { class: 'chips' });
      for (const p of m.poses) {
        const key = `${s.title}|${m.name}|${p}`;
        chips.append(makeChip(key, poseLabel(p), set, otherSet));
      }
      wrap.append(el('div', { class: 'row' },
        el('div', { class: 'member', title: m.name }, displayMember(m.name)), chips));
    }
    return wrap;
  });
  $('scenes').replaceChildren(...out);
}

/**
 * 種類のマス。求は押すたびに入／切。譲は押すたびに枚数が増え（2枚以上は数字だけ大きく出す）、
 * 長押しで 0 に戻す（アプリと同じ）。枚数はこの端末の中だけで、コードには「あるかないか」だけ入る。
 */
function makeChip(key, label, set, otherSet) {
  const isGive = !lookingFor;
  const n = isGive ? (mine.count[key] || 0) : 0;
  const on = set.has(key);
  const cls = lookingFor ? 'want' : 'give';
  const text = isGive && n > 1 ? String(Math.min(n, 99)) : label;
  const chip = el('button', {
    class: `chip ${on ? cls : ''}${isGive && n > 1 ? ' num' : ''}`, type: 'button',
  }, text);

  let timer = 0;
  let longPressed = false;
  const clearTimer = () => { clearTimeout(timer); timer = 0; };
  if (isGive) {
    chip.addEventListener('pointerdown', () => {
      longPressed = false;
      clearTimer();
      timer = setTimeout(() => {
        longPressed = true;
        if (on) {
          set.delete(key);
          delete mine.count[key];
          persist();
          drawScenes();
        }
      }, 500);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      chip.addEventListener(ev, clearTimer);
    }
    chip.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  chip.addEventListener('click', () => {
    if (longPressed) { longPressed = false; return; }
    if (isGive) {
      mine.count[key] = Math.min((mine.count[key] || 0) + 1, 99);
      set.add(key);
      otherSet.delete(key); // 同じ写真を求と譲の両方には入れない
    } else if (set.has(key)) {
      set.delete(key);
    } else {
      set.add(key);
      otherSet.delete(key);
      delete mine.count[key];
    }
    persist();
    drawScenes();
  });
  return chip;
}

// ---- 自分の二次元コード ----

let currentCode = '';

async function showQr() {
  if (mine.give.size === 0 && mine.want.size === 0) {
    return toast('交換したい写真を選んでください');
  }
  currentCode = await codec.encodeShortest({
    give: [...mine.give], want: [...mine.want], userName: mine.name,
  });
  renderQr($('qr'), currentCode);
  $('qrcard').hidden = false;
  $('qrcard').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(LINK_BASE + currentCode);
    toast('リンクをコピーしました');
  } catch (_) {
    toast('コピーできませんでした');
  }
}

async function shareLink() {
  try {
    await navigator.share({ text: `${LINK_BASE}${currentCode}\n#サク写シャッ! #生写真交換` });
  } catch (_) { /* やめた時も何もしない */ }
}

// ---- 相手のコードを読む ----

let stream = null;
let scanning = false;

async function startScan() {
  $('scanner').hidden = false;
  $('scanner').scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (_) {
    toast('カメラを使えません。写真から読み取ってください');
    return;
  }
  const video = $('video');
  video.srcObject = stream;
  await video.play().catch(() => {});
  scanning = true;
  requestAnimationFrame(tick);
}

function stopScan() {
  scanning = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $('scanner').hidden = true;
}

let lastError = 0;
function tick() {
  if (!scanning) return;
  const video = $('video');
  if (video.readyState >= 2 && video.videoWidth) {
    const found = decodeFrom(video, video.videoWidth, video.videoHeight);
    if (found) return;
  }
  requestAnimationFrame(tick);
}

/** 映像・画像から二次元コードを探す。見つかって開けたら true。 */
function decodeFrom(source, w, h) {
  const canvas = $('canvas');
  // 大きすぎる画像は縮める（重くならないように）。
  const scale = Math.min(1, 1600 / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // eslint-disable-next-line no-undef
  const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (!qr || !qr.data) return false;
  return openCode(qr.data);
}

function openCode(text) {
  const code = extractCode(text);
  if (!code) {
    const now = Date.now();
    if (now - lastError > 3000) {
      lastError = now;
      toast('交換用のコードではありません');
    }
    return false;
  }
  stopScan();
  location.href = `t/#${encodeURIComponent(code)}`;
  return true;
}

function readPhoto(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const ok = decodeFrom(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(url);
    if (!ok) toast('二次元コードが見つかりませんでした');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast('写真を開けませんでした');
  };
  img.src = url;
}

// ---- 読み取り履歴（この端末の中だけ・10件） ----

function drawHistory() {
  const list = loadHistory();
  $('history').hidden = list.length === 0;
  if (!list.length) return;
  const rows = list.map((h) => {
    const d = new Date(h.at);
    const when = h.at ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    const label = h.name ? `${h.name}さんの交換票` : '相手の交換票';
    return el('a', { class: 'hist', href: `t/#${encodeURIComponent(h.code)}` },
      el('span', { class: 'hist-name' }, label), el('span', { class: 'hist-time' }, when));
  });
  $('historyList').replaceChildren(...rows);
}

// ---- その他 ----

let toastTimer = 0;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function showError(message) {
  const e = $('error');
  e.textContent = message;
  e.hidden = false;
}

main();
