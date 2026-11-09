// js/common.js
//
// Web 版の共通の決まりごと。
//
// ■ 公開の期間（2026-11-09 本人決定）
//   アプリの無料キャンペーンと同じく、**日本時間 2026-11-21 12:00 まで**。過ぎたら案内だけ出す。
//   （アプリ側の正：osyacole/lib/other/release_flags.dart の kSpeedCampaignEnd）
//
// ■ 保存するもの（この端末のブラウザの中だけ。サーバーには送らない）
//   自分の交換票（名前・譲・求）を localStorage に。消すボタンも置く。

import { createCodec } from './codec.js';

export const CAMPAIGN_END = Date.UTC(2026, 10, 21, 3, 0, 0); // 日本時間 11/21 12:00
export const isOpen = (now = Date.now()) => now < CAMPAIGN_END;

/**
 * 期間が終わっていたら、この端末に保存した交換票を消して false を返す（2026-11-09 本人決定
 * 「11/21 で終了したら保存していた情報もなくなる」）。どの画面も最初にこれを呼ぶ。
 * ⚠️ 消せるのは「次に開いたとき」。開かれなければブラウザに残るが、外には出ない。
 *   終了後はサイト自体も閉じる（公開をやめる）。
 */
export function checkOpenOrClose() {
  if (isOpen()) return true;
  // このサイトがブラウザに保存したものを全部消す（後から保存するものを足しても漏れないように）。
  try { localStorage.clear(); } catch (_) {}
  try { sessionStorage.clear(); } catch (_) {}
  return false;
}

export const APP_STORE_URL = 'https://apps.apple.com/jp/app/id6796346724';

let codecPromise = null;
/** シーンのデータを読み込んで、コードの道具を用意する（1回だけ）。 */
export function loadCodec(base = '..') {
  if (!codecPromise) {
    codecPromise = fetch(`${base}/data/scenes.json`, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`data ${r.status}`);
        return r.json();
      })
      .then(createCodec);
  }
  return codecPromise;
}

const MINE_KEY = 'sakusyasya.mySlip.v1';

/** 自分の交換票を読む。無ければ null。 */
export function loadMine() {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return { name: v.name || '', give: new Set(v.give || []), want: new Set(v.want || []) };
  } catch (_) {
    return null;
  }
}

export function saveMine(mine) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify({
      name: mine.name, give: [...mine.give], want: [...mine.want],
    }));
  } catch (_) { /* 保存できなくても画面は使える */ }
}

export function clearMine() {
  try { localStorage.removeItem(MINE_KEY); } catch (_) {}
}
