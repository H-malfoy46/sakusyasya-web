// js/scan.js
//
// 相手の二次元コードを、カメラまたは写真から読み取る（トップと、相手の交換票の画面の両方で使う）。
// 読み取れたら onCode(コード) を呼ぶ。映像・写真はこの端末の中だけで読み、どこにも送らない。
//
// 必要な部品（HTML 側）：#scanner #video #canvas #photo #stopScan（と jsQR の読み込み）

import { extractCode } from './codec.js';

const $ = (id) => document.getElementById(id);

export function createScanner({ toast, onCode }) {
  let stream = null;
  let scanning = false;
  let lastError = 0;

  async function start() {
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

  function stop() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('scanner').hidden = true;
  }

  function tick() {
    if (!scanning) return;
    const video = $('video');
    if (video.readyState >= 2 && video.videoWidth) {
      if (decodeFrom(video, video.videoWidth, video.videoHeight)) return;
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
    return open(qr.data);
  }

  function open(text) {
    const code = extractCode(text);
    if (!code) {
      const now = Date.now();
      if (now - lastError > 3000) {
        lastError = now;
        toast('交換用のコードではありません');
      }
      return false;
    }
    stop();
    onCode(code);
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

  return { start, stop, readPhoto };
}
