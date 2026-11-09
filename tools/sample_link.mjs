// tools/sample_link.mjs — SNS での見え方を確かめるための見本のリンクを作る（手元用）。
// 実行： node tools/sample_link.mjs
import { readFileSync } from 'node:fs';
import { LINK_BASE, createCodec } from '../js/codec.js';

const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const codec = createCodec(data);

// 最新のシーンから、ばらばらに 求12件・譲15件 を選ぶ（毎回同じ結果になるよう順番で選ぶ）。
const tiles = codec.buildTiles(codec.scenes.map((s) => s.index)).filter(Boolean);
const want = tiles.filter((_, i) => i % 37 === 3).slice(0, 12);
const give = tiles.filter((_, i) => i % 29 === 7).slice(0, 15);
for (const [label, g, w] of [
  ['少ない（求1・譲1）', give.slice(0, 1), want.slice(0, 1)],
  ['ふつう（求12・譲15）', give, want],
]) {
  const code = await codec.encodeShortest({ give: g, want: w, userName: 'さくら' });
  const link = LINK_BASE + code;
  console.log(`■ ${label}：${link.length}文字`);
  console.log(link);
  console.log('');
}
