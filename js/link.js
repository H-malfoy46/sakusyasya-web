// js/link.js
//
// 共有リンク（https://sakusyasya.h-marufoy.com/t/#コード）を開いたときの画面。
// コードは # の後ろにあるので、ブラウザはサーバーへ送らない。読み解きはこの端末の中だけで行う。

import { APP_STORE_URL, addHistory, checkOpenOrClose, loadCodec, loadMine } from './common.js';
import { createScanner } from './scan.js';
import { el, renderQr, renderSlip } from './view.js';

const $ = (id) => document.getElementById(id);

async function main() {
  $('store').href = APP_STORE_URL;
  if (!checkOpenOrClose()) {
    $('ended').hidden = false;
    return;
  }
  let code = '';
  try {
    code = decodeURIComponent(location.hash.replace(/^#/, ''));
  } catch (_) {
    code = ''; // 壊れた # の後ろ（%E0%A4%A など）
  }
  if (!code) return showError('交換票のリンクではありません');

  let codec;
  try {
    codec = await loadCodec('..');
  } catch (_) {
    return showError('データを読み込めませんでした。通信のよい所でもう一度開いてください');
  }
  const r = await codec.decode(code);
  if (!r.ok) return showError(r.error);

  addHistory(code, r.userName); // 読み取れたものだけ、履歴に残す（この端末の中だけ）

  const mine = loadMine();
  const hasMine = !!mine && (mine.give.size > 0 || mine.want.size > 0);
  // 自分の交換票の表は、データにある全マスを並べて、自分が選んだものを色にする。
  const allKeys = [];
  for (const sc of codec.scenes) {
    for (const m of sc.members) for (const p of m.poses) allKeys.push(`${sc.title}|${m.name}|${p}`);
  }
  let myCode = '';

  const showSide = async (isMine) => {
    $('sideOther').classList.toggle('on', !isMine);
    $('sideMine').classList.toggle('on', isMine);
    const h = $('heading');
    h.replaceChildren();
    if (!isMine) {
      // 見出し：「〜さん」はピンク、「の交換票」は紺（アプリと同じ）。
      if (r.userName) {
        h.append(el('span', { class: 'name' }, el('b', {}, r.userName), 'さん'), 'の交換票');
      } else {
        h.append('相手の交換票');
      }
      renderSlip($('table'), r, mine);
      renderQr($('qr'), code);
      return;
    }
    h.append('自分の交換票');
    if (!hasMine) {
      $('table').replaceChildren(el('p', { class: 'muted center' },
        '自分の交換票がまだありません。下の「自分の交換票を作る」から作れます'));
      $('qr').replaceChildren();
      return;
    }
    // 色の付き方（ピンク＝噛み合う）は、相手の交換票との組み合わせで決まる。
    renderSlip($('table'),
      { want: mine.want, give: mine.give, tiles: allKeys },
      { give: r.give, want: r.want });
    // 相手に読んでもらえるよう、二次元コードも自分のものにする。
    if (!myCode) {
      myCode = await codec.encodeShortest({
        give: [...mine.give], want: [...mine.want], userName: mine.name,
      });
    }
    renderQr($('qr'), myCode);
  };
  $('sideOther').addEventListener('click', () => showSide(false));
  $('sideMine').addEventListener('click', () => showSide(true));

  // 相手のコードを読み取る（この画面の二次元コードの下）。
  const toast = (m) => {
    const t = $('toast');
    t.textContent = m;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
  };
  const scanner = createScanner({
    toast,
    onCode: (c) => {
      const enc = encodeURIComponent(c);
      if (`#${enc}` === location.hash) return toast('いま見ている交換票です');
      location.hash = enc; // hashchange で読み込み直す
    },
  });
  $('scan').addEventListener('click', scanner.start);
  $('stopScan').addEventListener('click', scanner.stop);
  $('photo').addEventListener('change', scanner.readPhoto);

  await showSide(false);
  $('slip').hidden = false;
  $('qrcard').hidden = false;
}

function showError(message) {
  const e = $('error');
  e.textContent = message;
  e.hidden = false;
}

// 同じタブで別の交換票のリンクを開くと、# の後ろだけが変わって画面が作り直されない。
// そのときは読み込み直して、新しい交換票を出す。
window.addEventListener('hashchange', () => location.reload());

main();
