// tools/check_codec.mjs
//
// Web 版の読み解き（js/codec.js）が、アプリで作ったコードを正しく読めるかの答え合わせ。
// さらに Web 版で作ったコードを tools/web_codes.json に書き出す（アプリ側で読めるかを確かめる用）。
//
// 実行（このフォルダの1つ上で）： node tools/check_codec.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { createCodec } from '../js/codec.js';

const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url)));
const codec = createCodec(data);

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed++;
    console.log('NG:', msg);
  }
};

const same = (set, arr) => set.size === arr.length && arr.every((k) => set.has(k));

// アプリで作ったコードを Web で読む（見えるのは最新のシーンの分だけ）。
for (const v of vectors) {
  const r = await codec.decode(v.code);
  check(r.ok, `${v.label}: 読めない（${r.error}）`);
  if (!r.ok) continue;
  check(same(r.give, v.giveLatest), `${v.label}: 譲が違う`);
  check(same(r.want, v.wantLatest), `${v.label}: 求が違う`);
  const hidden = v.give.length + v.want.length - v.giveLatest.length - v.wantLatest.length;
  check(r.hiddenCount === hidden, `${v.label}: 古いシーンの件数が違う（${r.hiddenCount} / ${hidden}）`);
  check(r.userName === v.name, `${v.label}: 名前が違う（${r.userName}）`);
}

// Web で作る → Web で読む（往復）。アプリ側の確認用にも書き出す（最新のシーンの分だけで作る）。
const out = [];
for (const v of vectors) {
  const give = v.giveLatest;
  const want = v.wantLatest;
  const code = await codec.encodeShortest({ give, want, userName: v.name });
  const r = await codec.decode(code);
  check(r.ok && same(r.give, give) && same(r.want, want), `${v.label}: Web の往復が合わない`);
  out.push({ label: v.label, name: v.name, give, want, code });
}
writeFileSync(new URL('./web_codes.json', import.meta.url), JSON.stringify(out, null, 2));

console.log(failed === 0 ? 'OK: すべて一致' : `NG: ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
