// 10-5a: UFO ゼノリスの遅延チャンク（?dev=xenolith のときだけ読む。読むのは src/ui/xenolith-link.ts）:
// フリーフライトにゼノリスだけを出し（判定は missions/xenolith-dev.ts）、形（render/xenolith-model/）と左の値の表示
// （状態・段階・バリア・次の光線・瞬間移動までの時間・速さ・体力・距離・高さ・壊れた部位・当たり・三角形と描画の回数。タップ / クリックで畳む）、
// 見失ったときの画面の端の印（画面の外のゼノリス = 水色、画面の外の瞬間移動の移る先 = 白く点滅）。URL: ?xnhp=<1〜100>・?xnbreak=gen0,emitter1,...
import './xenolith-dev.css';
import { Vector3, type Camera, type Scene } from 'three';
import { attackWeights } from '../ai/xenolith-attacks';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { XENOLITH_CONFIG as C, XENOLITH_PARTS } from '../data/xenolith';
import type { MapDef } from '../data/maps';
import type { XenolithGround } from '../entities/xenolith/xenolith-body';
import type { GamePlay } from '../missions/game-play';
import {
  attachXenolithDev,
  parseXenolithOptions,
  type XenolithDev,
} from '../missions/xenolith-dev';
import { XenolithObject } from '../render/xenolith-model/xenolith-object';

export interface XenolithRuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly search: string;
  readonly ground: XenolithGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  readonly state: () => ScreenState;
  readonly inFreeFlight: () => boolean;
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
}

/** 怪獣を出している画面（ポーズ・フォトモード・結果の画面の後ろも見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause', 'photo', 'result'];
const ndc = new Vector3();
const view = new Vector3();

/** 画面の端の印（画面の外の点の向き）。画面の中なら隠す */
function placeEdge(el: HTMLElement, camera: Camera, x: number, y: number, z: number): void {
  camera.updateMatrixWorld();
  view.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  ndc.set(x, y, z).project(camera);
  const behind = view.z > 0;
  let nx = ndc.x;
  let ny = ndc.y;
  if (behind) {
    nx = -nx;
    ny = -ny;
  }
  const inside = !behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
  el.hidden = inside;
  if (inside) return;
  if (behind && Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
  const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
  const k = 0.9 / m;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const px = (nx * k * 0.5 + 0.5) * w;
  const py = (-ny * k * 0.5 + 0.5) * h;
  const angle = Math.atan2(-ny, nx);
  el.style.transform = `translate(${px.toFixed(1)}px, ${(py - 11).toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
}

export function startXenolith(p: XenolithRuntimeParts): XenolithDev {
  const dev = attachXenolithDev(p.play, parseXenolithOptions(p.search), {
    ground: p.ground,
    map: p.map,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  const obj = new XenolithObject('high');
  p.scene.add(...obj.objects);
  p.onDetail((d) => {
    obj.setDetail(d);
  });
  const panel = document.createElement('div');
  panel.className = 'xenolith-dev';
  panel.hidden = true;
  let collapsed = false;
  panel.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('is-collapsed', collapsed);
  });
  const edgeBody = document.createElement('div');
  edgeBody.className = 'xenolith-edge';
  edgeBody.hidden = true;
  const edgeWarp = document.createElement('div');
  edgeWarp.className = 'xenolith-edge is-warp';
  edgeWarp.hidden = true;
  document.body.append(panel, edgeBody, edgeWarp);
  let last = performance.now();
  let lastText = '';
  let lastHp = dev.kaiju.parts.hp;
  let flash = 0;
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const k = dev.kaiju;
    const shown = dev.flying && SHOWN.includes(state) && k.body.visible;
    obj.setVisible(shown);
    const hp = k.parts.hp;
    flash = hp < lastHp ? 1 : Math.max(0, flash - dt * 12);
    lastHp = hp;
    if (shown) obj.update(k, alpha, dt, flash);
    const flying = dev.flying && state === 'flight';
    // 見失ったときの手がかり: 画面の外の本体と、画面の外の瞬間移動の移る先
    if (flying) {
      const b = obj.group.position;
      placeEdge(edgeBody, p.camera, b.x, b.y, b.z);
      const d = k.warp.destination;
      if (k.warp.phase === 'telegraph') placeEdge(edgeWarp, p.camera, d.x, d.y, d.z);
      else edgeWarp.hidden = true;
    } else {
      edgeBody.hidden = true;
      edgeWarp.hidden = true;
    }
    panel.hidden = !flying;
    if (panel.hidden) return;
    const text = collapsed ? 'XENOLITH (dev) ▸' : panelText(dev, obj);
    if (text !== lastText) {
      panel.textContent = text;
      lastText = text;
    }
  });
  return dev;
}

const f0 = (n: number): string => n.toFixed(0);
const f1 = (n: number): string => n.toFixed(1);

/** 値の表示の文（開発用なので英語だけ。遊ぶ人に出すときに i18n の表へ） */
function panelText(dev: XenolithDev, obj: XenolithObject): string {
  const k = dev.kaiju;
  const b = k.body;
  const pl = dev.playerPosition;
  const beam = k.beam;
  const cands = attackWeights(k, pl).map((c) => `${c.attack}×${f1(c.weight)}`);
  const next = beam.busy
    ? `${beam.kind} ${beam.phase} ${f1(beam.time)}s${beam.untilFire > 0 ? `  fire in ${f1(beam.untilFire)}s` : ''}`
    : `in ${f1(Math.max(0, k.cooldown))}s [${cands.join(',') || 'none'}]`;
  const bar = k.barrier;
  const barLeft =
    bar.phase === 'flicker'
      ? `${f1(Math.max(0, bar.spec.flicker - bar.time))}s`
      : bar.phase === 'down'
        ? beam.busy && beam.phase !== 'warn'
          ? 'held'
          : `${f1(Math.max(0, bar.spec.down - bar.time))}s`
        : '';
  const warp = k.warp;
  const warpText = !k.warpEnabled
    ? 'disabled (emitters)'
    : warp.phase === 'telegraph'
      ? `TELEGRAPH ${f1(k.untilWarp)}s`
      : `in ${f1(k.untilWarp)}s (every ${f1(k.warpInterval)}s)`;
  const broken = XENOLITH_PARTS.filter((_, i) => k.parts.isBroken(i)).join(',') || 'none';
  const floor = b.floorAt(b.position.x, b.position.z);
  const dist = Math.hypot(pl.x - b.position.x, pl.y - b.position.y, pl.z - b.position.z);
  const hits = dev.partTargets.reduce((s, t) => s + t.hits, 0);
  return [
    `XENOLITH (dev)  ${f0(k.elapsed)}s`,
    `state  ${b.move} ${f1(b.moveTime)}s  orbit ${b.orbitDir > 0 ? 'L' : 'R'} r${f0(b.orbitRadius)} alt+${f0(b.altOffset)}`,
    `stage  ${String(k.stage)}  hp ${f0(k.parts.hp)}/${f0(k.parts.maxHp)} (${f0(k.parts.ratio * 100)}%)`,
    `barrier ${bar.phase.toUpperCase()} ${barLeft}  down ${f1(bar.spec.down)}s  drops ${String(bar.drops)}  blocked ${String(k.absorbed)}`,
    `next   ${next}`,
    `warp   ${warpText}  warps ${String(warp.warps)}`,
    `speed  ${f0(b.speed)} m/s  (cruise ${f0(C.move.cruise * b.speedMul)} / dash ${f0(C.move.dash * b.speedMul)})`,
    `you    dist ${f0(dist)}m  dy ${f0(pl.y - b.position.y)}m`,
    `alt ${f0(b.position.y)}m  agl ${f0(b.position.y - floor)}m`,
    `used   sweep ${String(k.attacksUsed.sweep)} charged ${String(k.attacksUsed.charged)} combo ${String(k.combos)}`,
    `broken ${broken}`,
    `hits on kaiju ${String(hits)}  taken sw${String(dev.taken.sweep)} ch${String(dev.taken.charged)} body${String(dev.taken.body)}`,
    `tris ${String(obj.triangles)}  draws ${String(obj.draws)}`,
    dev.lateStart ? 'LATE START (replay differs)' : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
