/* global Buffer, fetch */
// 8-6 / 8-6b の点検（scripts/ui-audit-device.js）の排気口と噴流: 戦闘機 4 機種を横（上の段）と斜め後ろ（下の段）から拡大し、
// 画質（低: 細かさ low・陽炎は半透明の筒 / 中: high・半透明の筒 / 高: high・影あり・陽炎は屈折なので筒なし）×
// アフターバーナーなし / ありで PNG に書き出す。モジュールだけ読む（アプリは起動しない）。
// 噴流の先の黒い輪（8-6b）: iOS の GPU のように「負の数の累乗を NaN にする」pow に差し替え、陽炎の筒の後ろ（空だけが
// 見えるはずの所）の黒い画素を数える。筒の縁の画素の補間のはみ出しも模し（uv.y を 0.3% 大きく）、修正前のシェーダー（along を
// 0〜1 に収めない）と今のシェーダーを比べる
import { writeFileSync } from 'node:fs';

const QUALITIES = [
  { id: 'low', detail: 'low', shadow: false, refraction: false },
  { id: 'medium', detail: 'high', shadow: false, refraction: false },
  { id: 'high', detail: 'high', shadow: true, refraction: true },
];

/** 1 枚（4 機種 × 横・斜め後ろ）を描いて PNG と噴流の後ろの黒い画素の数を返す（ブラウザの中で動く） */
async function renderSheet([q, afterburner, nanPow, beforeFix]) {
  // アプリのモジュールと同じ three（開発サーバーが書き換えた import の先）を使う
  const src = await (await fetch('/src/render/aircraft-model/aircraft-object.ts')).text();
  const threeUrl = /from\s+["']([^"']*\/three[^"']*)["']/.exec(src)?.[1] ?? '';
  const THREE = await import(threeUrl);
  const { AIRCRAFT_MODELS } = await import('/src/data/aircraft.ts');
  const { AircraftObject } = await import('/src/render/aircraft-model/aircraft-object.ts');
  const W = 400;
  const H = 300;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(W * 4, H * 2);
  r.setScissorTest(true);
  r.shadowMap.enabled = q.shadow;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const probes = [];
  // 画質「中」以上の描画先（src/render/post.ts）と同じ HalfFloat。NaN・無限大は 8 ビットの画面では 0 に丸められて見えないが、
  // この描画先では残り、ブルームとトーンマッピングを通って黒い点になる
  const rt =
    q.id === 'low'
      ? null
      : new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  let nan = 0;
  AIRCRAFT_MODELS.forEach((m, i) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fb4d8);
    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x445566, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(30, 60, 20);
    sun.castShadow = q.shadow;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const o = new AircraftObject();
    o.build(m.shape, q.detail, 2);
    o.haze.refraction = q.refraction;
    const mat = o.haze.mesh.material;
    if (beforeFix)
      mat.fragmentShader = mat.fragmentShader.replace('clamp(vUv.y, 0.0, 1.0)', 'vUv.y');
    // 縁の画素の補間のはみ出し（MSAA で画素の中心が三角形の外のとき）を、筒の先の uv.y を 0.3% 大きくして模す
    if (nanPow)
      mat.vertexShader = mat.vertexShader.replace('vUv = uv;', 'vUv = uv * vec2(1.0, 1.003);');
    if (nanPow)
      mat.fragmentShader = mat.fragmentShader
        .replace(
          'void main()',
          'float mpow(float x, float y) { return x < 0.0 ? intBitsToFloat(0x7fc00000) : pow(x, y); }\nvoid main()',
        )
        .replace(/pow\(1\.0 - along/g, 'mpow(1.0 - along');
    mat.needsUpdate = true;
    for (let k = 0; k < 120; k++) {
      o.flame.update(afterburner, 1 / 60);
      o.haze.update(afterburner ? 0 : 1, 1 / 60);
    }
    scene.add(o.group);
    const z = Math.max(...o.built.nozzles.map((n) => n.z));
    for (let row = 0; row < 2; row++) {
      const cam = new THREE.PerspectiveCamera(row === 0 ? 28 : 30, W / H, 0.1, 500);
      if (row === 0) cam.position.set(16, 0.5, z + 3);
      else cam.position.set(4, 2.5, z + 13);
      cam.lookAt(0, 0, z + (row === 0 ? 2 : 1));
      r.setViewport(i * W, (1 - row) * H, W, H);
      r.setScissor(i * W, (1 - row) * H, W, H);
      r.render(scene, cam);
      if (row === 0 && rt) {
        // ポストエフェクトと同じ HalfFloat の描画先（MSAA 4）に描き、NaN の画素を数える
        r.setScissorTest(false);
        r.setRenderTarget(rt);
        r.setViewport(0, 0, W, H);
        r.render(scene, cam);
        const half = new Uint16Array(W * H * 4);
        r.readRenderTargetPixels(rt, 0, 0, W, H, half);
        for (let k = 0; k < half.length; k++) if ((half[k] & 0x7c00) === 0x7c00) nan++;
        r.setRenderTarget(null);
        r.setScissorTest(true);
        r.setViewport(i * W, (1 - row) * H, W, H);
      }
      if (row === 0) {
        // 横から見た噴流の後ろ半分（空だけ + 半透明の筒）の画面の範囲
        const a = new THREE.Vector3(0, 0, z + 3).project(cam);
        const b = new THREE.Vector3(0, 0, z + 7.5).project(cam);
        const yTop = new THREE.Vector3(0, 2, z + 5).project(cam);
        const yBot = new THREE.Vector3(0, -2, z + 5).project(cam);
        const px = (v) => ((v.x + 1) / 2) * W + i * W;
        const py = (v) => ((v.y + 1) / 2) * H + H;
        // 枠（この機種の 1 枚）の中に収める
        const clampX = (v) => Math.min((i + 1) * W - 1, Math.max(i * W, Math.round(v)));
        probes.push({
          x0: clampX(Math.min(px(a), px(b))),
          x1: clampX(Math.max(px(a), px(b))),
          y0: Math.round(Math.max(H, Math.min(py(yTop), py(yBot)))),
          y1: Math.round(Math.min(2 * H - 1, Math.max(py(yTop), py(yBot)))),
        });
      }
    }
  });
  // 黒い画素（輝度 0.3 未満。空は約 0.65、陽炎は空より明るい）を数える
  const gl = r.getContext();
  let dark = 0;
  for (const p of probes) {
    const w = p.x1 - p.x0;
    const h = p.y1 - p.y0;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(p.x0, p.y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (let k = 0; k < buf.length; k += 4) {
      const l = (0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2]) / 255;
      if (l < 0.3) dark++;
    }
  }
  return { png: r.domElement.toDataURL('image/png'), dark, nan };
}

export async function auditNozzles(browser, base, out) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 600 } });
  await page.route('**/src/main.ts', (r) =>
    r.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.goto(base);
  const rows = [];
  const files = [];
  for (const q of QUALITIES)
    for (const ab of [false, true]) {
      const { png, dark, nan } = await page.evaluate(renderSheet, [q, ab, false, false]);
      const file = `${out}/plume-${q.id}${ab ? '-ab' : ''}.png`;
      writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
      files.push(file);
      rows.push({
        what: `噴流 画質 ${q.id}・AB ${ab ? 'あり' : 'なし'}（黒い画素 ${dark}・NaN ${nan}）`,
        ok: dark === 0 && nan === 0,
        dark,
        nan,
        file,
      });
    }
  // iOS の GPU を模した pow（負の数で NaN）と縁の補間のはみ出し。修正前は HalfFloat の描画先に NaN が出て、修正後は出ない
  for (const beforeFix of [true, false]) {
    const q = QUALITIES[1];
    const { png, dark, nan } = await page.evaluate(renderSheet, [q, false, true, beforeFix]);
    const file = `${out}/plume-ios-pow-${beforeFix ? 'before' : 'after'}.png`;
    writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    rows.push({
      what: `噴流 iOS の pow を模擬・${beforeFix ? '修正前' : '修正後'}（黒い画素 ${dark}・NaN ${nan}）`,
      ok: beforeFix ? nan > 0 : dark === 0 && nan === 0,
      dark,
      nan,
      file,
    });
  }
  await page.close();
  return rows;
}
