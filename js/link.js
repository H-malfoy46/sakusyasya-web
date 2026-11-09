// js/link.js
//
// 共有リンク（https://sakusyasya.h-marufoy.com/t/#コード）を開いたときの画面。
// コードは # の後ろにあるので、ブラウザはサーバーへ送らない。読み解きはこの端末の中だけで行う。

import { APP_STORE_URL, checkOpenOrClose, loadCodec, loadMine } from './common.js';
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

  // 見出し：「〜さん」はピンク、「の交換票」は紺（アプリと同じ）。
  const h = $('heading');
  if (r.userName) {
    h.append(el('span', { class: 'name' }, el('b', {}, r.userName), 'さん'), 'の交換票');
  } else {
    h.append('相手の交換票');
  }
  renderSlip($('table'), r, loadMine());
  $('slip').hidden = false;

  renderQr($('qr'), code);
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
