// tools/check_abuse.mjs — わざと壊した・重くしたコードで、固まらず「読めない」と返すかの確認（セキュリン M1）。
// 実行： node tools/check_abuse.mjs
import { readFileSync } from 'node:fs';
import { b64urlEncode, createCodec, extractCode, gzip } from '../js/codec.js';

const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const codec = createCodec(data);
const fp = data.fingerprint;
let failed = 0;
const expectFail = async (label, code) => {
  const t0 = Date.now();
  const r = await codec.decode(code);
  const ms = Date.now() - t0;
  const ok = !r.ok && ms < 1000;
  if (!ok) failed++;
  console.log(`${ok ? 'OK' : 'NG'}: ${label}（${ms}ms・${r.ok ? '読めてしまった' : r.error}）`);
};

// 1. 長すぎる
await expectFail('長すぎるコード', `t1.${fp}.*.r.${'A'.repeat(5000)}..`);
// 2. シーン番号の重複を大量に
await expectFail('シーン番号の重複', `t1.${fp}.${Array(160).fill('0').join('-')}.r.AA==..`);
// 3. 範囲外のシーン番号
await expectFail('範囲外のシーン番号', `t1.${fp}.zzzz.r.AA==..`);
// 4. 圧縮爆弾（0 が 50MB）
const bomb = await gzip(new Uint8Array(50 * 1024 * 1024));
const bombCode = `t1.${fp}.0.z.${b64urlEncode(bomb)}..`;
console.log(`  （圧縮爆弾のコード長 ${bombCode.length}字）`);
await expectFail('圧縮爆弾（長さで止まる）', bombCode);

// 5. 読み取った文字：知らないサイトの URL は受け付けない
const bad = extractCode('https://evil.example/t/#t1.abc');
if (bad !== null) { failed++; console.log('NG: 知らないサイトの URL を受け付けた'); } else console.log('OK: 知らないサイトの URL は受け付けない');
const good = extractCode('https://sakusyasya.h-marufoy.com/t/#t1.abc');
if (good !== 't1.abc') { failed++; console.log('NG: 自分のサイトのリンクを読めない'); } else console.log('OK: 自分のサイトのリンクは読める');

console.log(failed === 0 ? 'OK: すべて期待どおり' : `NG: ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
