// js/home.js
//
// トップ：自分の交換票を作る（最新のシーンから求・譲を選ぶ）→ 二次元コードとリンク。
//         相手の二次元コードをカメラ・写真から読む → /t/#コード で相手の交換票を開く。
//
// ・自分の交換票は、この端末のブラウザの中（localStorage）だけに保存する。サーバーには送らない
// ・11/21 12:00 を過ぎたら、保存を消して終了の案内だけ出す（common.js）

import { checkOpenOrClose, loadCodec, loadHistory, loadMine, saveMine } from './common.js';
import { LINK_BASE } from './codec.js';
import { createScanner } from './scan.js';
import { displayMember, el, poseLabel, renderQr } from './view.js';

const $ = (id) => document.getElementById(id);

let codec;
let mine = { name: '', give: new Set(), want: new Set(), count: {} };
let lookingFor = true; // true＝求を選んでいる、false＝譲
const openScenes = new Set();

const scanner = createScanner({
  toast: (m) => toast(m),
  onCode: (code) => { location.href = `t/#${encodeURIComponent(code)}`; },
});

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
  $('scan').addEventListener('click', scanner.start);
  $('stopScan').addEventListener('click', scanner.stop);
  $('photo').addEventListener('change', scanner.readPhoto);
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

const LONG_PRESS_MS = 1000; // 譲を削除する長押し（本人指示 11/11：1秒。確認を出してから消す）

/**
 * 種類のマス。求は押すたびに入／切。譲は押すたびに枚数が増え（2枚以上は数字だけ大きく出す）、
 * 1秒の長押しで「トレ材から削除しますか？」を出し、OK なら 0 に戻す（アプリと同じ）。枚数はこの端末の中だけで、コードには「あるかないか」だけ入る。
 * ⚠️ スマホでは click が届かないことがあったので、譲は「指を離した時」に数える（pointerup）。
 *   click は、キーボード操作など pointer が無い場合の予備（二重に数えない）。
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

  const tap = () => {
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
  };

  let timer = 0;
  let pressed = false;
  let longDone = false;
  let suppressClick = false;
  let sx = 0;
  let sy = 0;
  const clear = () => { clearTimeout(timer); timer = 0; chip.classList.remove('holding'); };

  if (isGive) {
    chip.addEventListener('pointerdown', (e) => {
      pressed = true;
      longDone = false;
      sx = e.clientX;
      sy = e.clientY;
      clear();
      chip.classList.add('holding');
      timer = setTimeout(() => {
        longDone = true;
        if (on && confirm('トレ材から削除しますか？')) {
          set.delete(key);
          delete mine.count[key];
          persist();
          drawScenes();
        }
      }, LONG_PRESS_MS);
    });
    chip.addEventListener('pointermove', (e) => {
      // 指がずれた（スクロールなど）ときは、押したことにしない。
      if (pressed && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) { pressed = false; clear(); }
    });
    chip.addEventListener('pointerup', () => {
      clear();
      if (!pressed) return;
      pressed = false;
      suppressClick = true;
      if (!longDone) tap();
    });
    chip.addEventListener('pointercancel', () => { pressed = false; clear(); });
    chip.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  chip.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    tap();
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
