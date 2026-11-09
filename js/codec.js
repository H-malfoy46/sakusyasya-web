// js/codec.js
//
// 交換票のコード（アプリ「サク写シャッ!」と同じ形）を作る・読み解く。
//
// ■ 正はアプリ側：osyacole/lib/services/collection_share_codec.dart の TradeShareCodec
//   形：t{版}.{データの印}.{シーンの選び方}.{z|r}.{本体}.{名前}.{優先}
//   ・本体：マス目1つにつき2ビット（前半＝譲、後半＝求）。短くなるなら gzip
//   ・base64url は**パディング（=）付き**（Dart の base64Url.encode と同じ）
//   ・マス目の並びは data/scenes.json の順（アプリから書き出したもの）
//
// ⚠️ ここを直したら tools/check_codec.mjs で、アプリが作ったコードとの答え合わせをすること。

export const PREFIX = 't';

/** 読むコードの長さの上限（アプリの二次元コードの上限 1,200字に余裕を見た値）。 */
export const MAX_CODE_LENGTH = 3000;

/**
 * シーンのデータを受け取って、コードの道具一式を作る。
 *
 * ★ 2026-11-09 本人決定：Web に載せる中身は**最新のシーンだけ**。
 *   それ以外のシーンは「マス目の数（n）」だけが入っている。アプリのコードの中で
 *   最新のシーンのマスがどこにあるかを数えるのに要るため。古いシーンの中身は表示しない。
 *   データの印（fingerprint）はアプリが書き出した値をそのまま使う（全シーンが無いと計算できない）。
 */
export function createCodec(data) {
  const all = data.scenes.map((s, index) => ({
    index,
    count: s.n,
    detail: s.t
      ? {
          title: s.t,
          release: s.r,
          genre: s.g,
          members: s.m.map(([id, poses]) => ({ name: data.members[id], poses })),
        }
      : null,
  }));
  /** 中身のあるシーン（最新）。新しい順。 */
  const scenes = all
    .filter((s) => s.detail)
    .map((s) => ({ index: s.index, ...s.detail }))
    .sort((a, b) => releaseValue(b.release) - releaseValue(a.release));

  /**
   * マス目の一覧（アプリの buildTiles と同じ順・同じ数）。
   * 中身の無い（古い）シーンのマスは null にして、位置だけ合わせる。
   */
  function buildTiles(sceneIndices) {
    const targets =
      sceneIndices == null
        ? all
        : sceneIndices.filter((i) => i >= 0 && i < all.length).map((i) => all[i]);
    const tiles = [];
    for (const s of targets) {
      if (!s.detail) {
        for (let k = 0; k < s.count; k++) tiles.push(null);
        continue;
      }
      for (const m of s.detail.members) {
        for (const p of m.poses) tiles.push(`${s.detail.title}|${m.name}|${p}`);
      }
    }
    return tiles;
  }

  const fingerprint = data.fingerprint;

  function encodeSceneSpec(indices) {
    if (indices == null || indices.length === 0) return '*';
    return [...new Set(indices)].sort((a, b) => a - b).map((i) => i.toString(36)).join('-');
  }

  /** シーンの選び方を読む。重複・範囲外・多すぎるものは読めない扱い（null ではなく false）。 */
  function decodeSceneSpec(spec) {
    if (spec === '*') return null;
    const parts = spec.split('-');
    if (parts.length > all.length) return false;
    const out = new Set();
    for (const p of parts) {
      if (!/^[0-9a-z]{1,4}$/.test(p)) return false;
      const v = parseInt(p, 36);
      if (v >= all.length || out.has(v)) return false;
      out.add(v);
    }
    return [...out];
  }

  /** 交換票に載っているシーンだけの番号（アプリの sceneIndicesFor と同じ。番号は全シーンの中の位置）。 */
  function sceneIndicesFor(keys) {
    const titles = new Set(keys.map((k) => k.split('|')[0]));
    if (titles.size === 0) return null;
    const idx = scenes.filter((s) => titles.has(s.title)).map((s) => s.index).sort((a, b) => a - b);
    return idx.length ? idx : null;
  }

  async function encode({ give, want, sceneIndices = null, userName = '' }) {
    const tiles = buildTiles(sceneIndices);
    const giveSet = new Set(give);
    const wantSet = new Set(want);
    const half = (tiles.length + 7) >> 3;
    const bytes = new Uint8Array(half * 2);
    tiles.forEach((key, i) => {
      if (giveSet.has(key)) bytes[i >> 3] |= 1 << (i & 7);
      if (wantSet.has(key)) bytes[half + (i >> 3)] |= 1 << (i & 7);
    });
    const compressed = await gzip(bytes);
    const useGzip = compressed.length < bytes.length;
    const body = b64urlEncode(useGzip ? compressed : bytes);
    const trimmed = userName.trim();
    const name = trimmed ? b64urlEncode(new TextEncoder().encode(trimmed)) : '';
    // 優先（★）は Web 版では送らない（空欄）。
    return `${PREFIX}${data.version}.${fingerprint}.${encodeSceneSpec(sceneIndices)}.${useGzip ? 'z' : 'r'}.${body}.${name}.`;
  }

  /**
   * 交換票のコードを作る。Web 版は最新のシーンしか持たないので、**いつも載せたシーンだけに絞る**。
   * 何も選んでいなければ、最新のシーン全部を対象にする（古いシーンの中身は知らないため）。
   */
  async function encodeShortest({ give, want, userName = '' }) {
    const idx = sceneIndicesFor([...give, ...want]) ?? scenes.map((s) => s.index).sort((a, b) => a - b);
    return encode({ give, want, sceneIndices: idx, userName });
  }

  /** コードを読み解く。失敗しても例外は投げず {ok:false, error} を返す。 */
  async function decode(code) {
    const fail = (error) => ({ ok: false, error });
    const trimmed = (code || '').trim();
    if (!trimmed) return fail('コードが空です');
    // ⚠️ 長すぎるもの（二次元コードに入らない量）は読まない。わざと重くしたコードで固まらないように。
    if (trimmed.length > MAX_CODE_LENGTH) return fail('交換用のコードではありません');
    const parts = trimmed.split('.');
    if (parts.length < 5 || parts.length > 7 || !parts[0].startsWith(PREFIX)) {
      return fail('交換用のコードではありません');
    }
    const version = Number(parts[0].substring(PREFIX.length));
    if (!Number.isInteger(version)) return fail('コードの形式が正しくありません');
    if (version !== data.version) {
      return fail('このコードは別のバージョンで作られています。アプリを最新にしてお試しください');
    }
    if (parts[1] !== fingerprint) {
      return fail('相手とデータが違うため読み取れません。両方を最新にしてお試しください');
    }
    const sceneIndices = decodeSceneSpec(parts[2]);
    if (sceneIndices === false) return fail('コードが壊れているようです');
    const tiles = buildTiles(sceneIndices);
    try {
      const half = (tiles.length + 7) >> 3;
      const raw = b64urlDecode(parts[4]);
      // 展開は「本来の大きさ」を超えたところで打ち切る（圧縮爆弾で固まらないように）。
      const bytes = parts[3] === 'z' ? await gunzip(raw, half * 2 + 1) : raw;
      if (bytes.length !== half * 2) return fail('コードが壊れているようです');
      const give = new Set();
      const want = new Set();
      let hiddenCount = 0; // 古いシーン（Web では中身を持たない）に入っていた件数
      tiles.forEach((key, i) => {
        const g = bytes[i >> 3] & (1 << (i & 7));
        const w = bytes[half + (i >> 3)] & (1 << (i & 7));
        if (key == null) {
          if (g) hiddenCount++;
          if (w) hiddenCount++;
          return;
        }
        if (g) give.add(key);
        if (w) want.add(key);
      });
      let userName = '';
      if (parts.length >= 6 && parts[5]) {
        try {
          userName = new TextDecoder('utf-8', { fatal: true }).decode(b64urlDecode(parts[5]));
        } catch (_) {
          userName = '';
        }
      }
      return {
        ok: true,
        give,
        want,
        tiles: tiles.filter((t) => t != null),
        hiddenCount,
        userName: cleanName(userName),
      };
    } catch (_) {
      return fail('コードが壊れているようです');
    }
  }

  return { scenes, fingerprint, buildTiles, sceneIndicesFor, encode, encodeShortest, decode };
}

/** 「2026/10/15」「2026/6/10」のどちらの書き方でも比べられる数にする。 */
function releaseValue(r) {
  const [y, m, d] = (r || '').split('/').map(Number);
  return (y || 0) * 10000 + (m || 0) * 100 + (d || 0);
}

/** 受け取った名前を表示用に整える（改行・制御文字を除き、長すぎるものは切る）。 */
export function cleanName(name) {
  // eslint-disable-next-line no-control-regex
  // 改行・制御文字・文字の向きを変える記号・見えない文字を除く（なりすまし表示の対策）。
  const s = name
    .replace(/[\u0000-\u001f\u007f؜​-‏‪-‮⁠-⁩﻿]/g, '')
    .trim();
  return [...s].slice(0, 20).join('');
}

/** 自分のサイトの交換票リンクの入り口（アプリの kTradeShareLinkBase と同じ）。 */
export const LINK_BASE = 'https://sakusyasya.h-marufoy.com/t/#';

/**
 * 読み取った文字からコードを取り出す。
 * ⚠️ 受け付けるのは「t で始まるコード」か「このサイトの交換票リンク」だけ。
 *   ほかの URL は読まない（読み取った QR から知らないサイトへ移らないように）。
 */
export function extractCode(input) {
  const t = (input || '').trim();
  if (!t || t.length > MAX_CODE_LENGTH + LINK_BASE.length) return null;
  const at = t.indexOf(LINK_BASE);
  if (at >= 0) {
    const code = t.substring(at + LINK_BASE.length).split(/\s/)[0];
    return code.startsWith(PREFIX) ? code : null;
  }
  if (t.includes('://')) return null;
  const token = t.split(/\s/).find((x) => x.startsWith(PREFIX));
  return token || null;
}

// ---- base64url（パディング付き）・gzip ----

export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

export function b64urlDecode(text) {
  let s = text.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));

/** 展開する。[limit] バイトを超えたら、そこで読むのをやめる（超えた分は捨てる）。 */
export async function gunzip(bytes, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      break;
    }
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
