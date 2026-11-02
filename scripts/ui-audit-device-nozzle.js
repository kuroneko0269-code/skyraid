/* global Buffer, fetch */
// 8-6 の点検（scripts/ui-audit-device.js）の排気口: 戦闘機 4 機種の後ろの拡大（上: 斜め後ろ・下: 真後ろの望遠）を
// 細かさ 高 / 低 × 影あり / なしで PNG に書き出す（黒い輪が無いことを目で確かめる）。モジュールだけ読む（アプリは起動しない）
import { writeFileSync } from 'node:fs';

export async function auditNozzles(browser, base, out) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 600 } });
  await page.route('**/src/main.ts', (r) =>
    r.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.goto(base);
  const files = [];
  for (const [detail, shadow] of [
    ['high', true],
    ['high', false],
    ['low', true],
    ['low', false],
  ]) {
    const png = await page.evaluate(
      async ([detail, shadow]) => {
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
        r.shadowMap.enabled = shadow;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        AIRCRAFT_MODELS.forEach((m, i) => {
          const scene = new THREE.Scene();
          scene.background = new THREE.Color(0x8fb4d8);
          scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x445566, 1.2));
          const sun = new THREE.DirectionalLight(0xffffff, 2.5);
          sun.position.set(30, 60, 20);
          sun.castShadow = shadow;
          sun.shadow.mapSize.set(2048, 2048);
          Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
          sun.shadow.bias = -0.0005;
          scene.add(sun);
          const o = new AircraftObject();
          o.build(m.shape, detail, 2);
          scene.add(o.group);
          const z = Math.max(...o.built.nozzles.map((n) => n.z));
          for (let row = 0; row < 2; row++) {
            const cam = new THREE.PerspectiveCamera(row === 0 ? 30 : 12, W / H, 0.1, 500);
            if (row === 0) cam.position.set(4, 2.5, z + 9);
            else cam.position.set(2.5, 1.2, z + 14);
            cam.lookAt(0, 0, z - (row === 0 ? 2 : 0));
            r.setViewport(i * W, (1 - row) * H, W, H);
            r.setScissor(i * W, (1 - row) * H, W, H);
            r.render(scene, cam);
          }
        });
        return r.domElement.toDataURL('image/png');
      },
      [detail, shadow],
    );
    const file = `${out}/nozzle-${detail}${shadow ? '-shadow' : ''}.png`;
    writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    files.push(file);
  }
  await page.close();
  return [{ what: '排気口の拡大（目で確かめる）', ok: true, files }];
}
