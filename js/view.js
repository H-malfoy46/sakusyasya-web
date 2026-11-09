// js/view.js
//
// 交換票を、アプリの交換画面と同じ考え方の表にして描く（求／譲を切り替え）。
// ・色は相手の言葉のまま（求＝黄、譲＝緑）
// ・自分の交換票（この端末の Web 版で作ったもの）があれば、噛み合うマスをピンクにする
//   相手の求 × 自分の譲 → 自分が渡せる／相手の譲 × 自分の求 → 自分がもらえる

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
};
export { el };

/** 丸数字つきの名前は「苗字 ①」に詰める（アプリと同じ）。 */
export function displayMember(name) {
  const m = name.match(/^(.*?)\s?([①-⑳])/);
  if (!m) return name;
  return `${m[1].split(' ')[0]} ${m[2]}`;
}

/**
 * 相手の交換票の表を [root] に描く。
 * [result] は codec.decode の結果。[mine] は自分の交換票 {give:Set, want:Set}（無ければ null）。
 */
export function renderSlip(root, result, mine) {
  let lookingFor = true; // true＝求、false＝譲
  const tabs = el('div', { class: 'tabs' });
  const body = el('div');
  const wantBtn = el('button', { class: 'want', type: 'button' }, `求 ${result.want.size}`);
  const giveBtn = el('button', { class: 'give', type: 'button' }, `譲 ${result.give.size}`);
  wantBtn.addEventListener('click', () => { lookingFor = true; draw(); });
  giveBtn.addEventListener('click', () => { lookingFor = false; draw(); });
  tabs.append(wantBtn, giveBtn);
  root.replaceChildren(tabs, body);

  function draw() {
    wantBtn.classList.toggle('on', lookingFor);
    giveBtn.classList.toggle('on', !lookingFor);
    const shown = lookingFor ? result.want : result.give;
    const other = mine ? (lookingFor ? mine.give : mine.want) : new Set();
    const cls = lookingFor ? 'want' : 'give';

    // シーン → メンバー → 種類（共有された範囲のマス目の順）。
    const byScene = new Map();
    for (const key of result.tiles) {
      const [scene, member, pose] = key.split('|');
      if (!byScene.has(scene)) byScene.set(scene, new Map());
      const ms = byScene.get(scene);
      if (!ms.has(member)) ms.set(member, []);
      ms.get(member).push(pose);
    }
    const out = [];
    for (const [scene, members] of byScene) {
      const rows = [];
      for (const [member, poses] of members) {
        if (!poses.some((p) => shown.has(`${scene}|${member}|${p}`))) continue;
        const chips = el('div', { class: 'chips' });
        for (const p of poses) {
          const key = `${scene}|${member}|${p}`;
          const on = shown.has(key);
          const hot = on && other.has(key);
          chips.append(el('span', { class: `chip ${hot ? 'hot' : on ? cls : ''}` }, p));
        }
        rows.push(el('div', { class: 'row' },
          el('div', { class: 'member', title: member }, displayMember(member)), chips));
      }
      if (rows.length) {
        out.push(el('div', { class: 'scene' }, el('div', { class: 'scene-title' }, scene), ...rows));
      }
    }
    if (!out.length) {
      out.push(el('p', { class: 'muted center' }, lookingFor ? '欲しい写真はありません' : 'トレ材はありません'));
    }
    body.replaceChildren(...out);
  }
  draw();
}

/** 二次元コードを描く（qrcode-generator。アプリと同じく誤り訂正 L）。 */
export function renderQr(root, code) {
  // eslint-disable-next-line no-undef
  const qr = qrcode(0, 'L');
  qr.addData(code, 'Byte');
  qr.make();
  root.innerHTML = qr.createImgTag(6, 0);
}
