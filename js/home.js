// js/home.js
//
// トップ：自分の交換票を作る（最新のシーンから求・譲を選ぶ）→ 二次元コードとリンク。
//         相手の二次元コードをカメラ・写真から読む → /t/#コード で相手の交換票を開く。
//
// ・自分の交換票は、この端末のブラウザの中（localStorage）だけに保存する。サーバーには送らない
// ・11/21 12:00 を過ぎたら、保存を消して終了の案内だけ出す（common.js）

import { checkOpenOrClose, clearMine, loadCodec, loadMine, saveMine } from './common.js';
import { LINK_BASE, extractCode } from './codec.js';
import { displayMember, el, renderQr } from './view.js';

const $ = (id) => document.getElementById(id);

let codec;
let mine = { name: '', give: new Set(), want: new Set() };
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
    };
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
  $('clear').addEventListener('click', clearAll);
  if (!navigator.share) $('share').hidden = true;

  drawScenes();
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
  $('tabWant').textContent = `求 ${mine.want.size}`;
  $('tabGive').textContent = `譲 ${mine.give.size}`;
  const cls = lookingFor ? 'want' : 'give';
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
        const chip = el('button', { class: `chip ${set.has(key) ? cls : ''}`, type: 'button' }, p);
        chip.addEventListener('click', () => {
          if (set.has(key)) set.delete(key);
          else {
            set.add(key);
            otherSet.delete(key); // 同じ写真を求と譲の両方には入れない
          }
          persist();
          drawScenes();
        });
        chips.append(chip);
      }
      wrap.append(el('div', { class: 'row' },
        el('div', { class: 'member', title: m.name }, displayMember(m.name)), chips));
    }
    return wrap;
  });
  $('scenes').replaceChildren(...out);
}

// ---- 自分の二次元コード ----

let currentCode = '';

async function showQr() {
  if (mine.give.size === 0 && mine.want.size === 0) {
    return toast('求か譲を選んでください');
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

// ---- その他 ----

function clearAll() {
  if (!confirm('交換票を消しますか？')) return;
  clearMine();
  mine = { name: '', give: new Set(), want: new Set() };
  $('name').value = '';
  $('qrcard').hidden = true;
  drawScenes();
}

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
