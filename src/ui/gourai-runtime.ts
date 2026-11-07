// 10-4a: メカ怪獣ゴウライの遅延チャンク（?dev=gourai のときだけ読む。読むのは src/ui/gourai-link.ts）:
// フリーフライトにゴウライだけを出し（判定は missions/gourai-dev.ts）、形（render/gourai-model/）と左の値の表示
// （状態・段階・熱・次の攻撃・生きている砲台の数・飛んでいる弾の数・体力・距離・高さ・壊れた部位・当たり・三角形と描画の回数。
// タップ / クリックで畳む）。URL: ?grhp=<1〜100>（40 未満で後半）・?grbreak=gunL,podR,...・?grroute=bay（港湾都市の湾）
import './gourai-dev.css';
import type { Scene } from 'three';
import { attackWeights } from '../ai/gourai-attacks';
import { relativeAim } from '../ai/raid-kit/frame';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { GOURAI_CONFIG as C, GOURAI_PARTS, GOURAI_TURRETS } from '../data/gourai';
import type { MapDef } from '../data/maps';
import type { GouraiGround } from '../entities/gourai/gourai-body';
import { attachGouraiDev, parseGouraiOptions, type GouraiDev } from '../missions/gourai-dev';
import type { GamePlay } from '../missions/game-play';
import { GouraiObject } from '../render/gourai-model/gourai-object';

export interface GouraiRuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly search: string;
  readonly ground: GouraiGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  readonly state: () => ScreenState;
  readonly inFreeFlight: () => boolean;
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
}

/** 怪獣を出している画面（ポーズ・フォトモード・結果の画面の後ろも見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause', 'photo', 'result'];

export function startGourai(p: GouraiRuntimeParts): GouraiDev {
  const dev = attachGouraiDev(p.play, parseGouraiOptions(p.search), {
    ground: p.ground,
    map: p.map,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  const obj = new GouraiObject('high');
  p.scene.add(...obj.objects);
  p.onDetail((d) => {
    obj.setDetail(d);
  });
  const panel = document.createElement('div');
  panel.className = 'gourai-dev';
  panel.hidden = true;
  let collapsed = false;
  panel.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('is-collapsed', collapsed);
  });
  document.body.append(panel);
  let last = performance.now();
  let lastText = '';
  let lastHp = dev.kaiju.parts.hp;
  let flash = 0;
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const state = p.state();
    const shown = dev.flying && SHOWN.includes(state) && dev.kaiju.body.visible;
    obj.setVisible(shown);
    const hp = dev.kaiju.parts.hp;
    flash = hp < lastHp ? 1 : Math.max(0, flash - dt * 12);
    lastHp = hp;
    if (shown) obj.update(dev.kaiju, alpha, dt, dev.playerPosition, flash);
    panel.hidden = !(dev.flying && state === 'flight');
    if (panel.hidden) return;
    const text = collapsed ? 'GOURAI (dev) ▸' : panelText(dev, obj);
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
function panelText(dev: GouraiDev, obj: GouraiObject): string {
  const k = dev.kaiju;
  const b = k.body;
  const pl = dev.playerPosition;
  const act = k.attack ? `${k.attack} ${k.action}` : k.action;
  const cands = attackWeights(k, pl).map((c) => `${c.attack}×${f1(c.weight)}`);
  const next =
    k.action === 'idle'
      ? `in ${f1(Math.max(0, k.cooldown))}s [${cands.join(',') || 'none'}]`
      : `${act} ${f1(k.actionLeft)}s left`;
  const broken = GOURAI_PARTS.filter((_, i) => k.parts.isBroken(i)).join(',') || 'none';
  const floor = b.floorAt(b.position.x, b.position.z);
  const dist = Math.hypot(pl.x - b.position.x, pl.y - b.position.y, pl.z - b.position.z);
  const aim = relativeAim(b, b.position, pl);
  // 自機の方角（体から見て）: 前 / 横 / 後ろ（左が正の方位）
  const ay = Math.abs(aim.yawDeg);
  const side = ay < 45 ? 'FRONT' : ay > 135 ? 'REAR' : aim.yawDeg > 0 ? 'LEFT' : 'RIGHT';
  const shots = k.shots;
  let guns = 0;
  let missiles = 0;
  for (const s of shots.shots) {
    if (!s.active) continue;
    if (s.kind === 'gun') guns++;
    else missiles++;
  }
  const turrets = GOURAI_TURRETS.map((t, i) =>
    k.turretAlive(i) ? (t.weapon === 'gun' ? 'G' : 'M') : '-',
  ).join('');
  const hits = dev.partTargets.reduce((s, t) => s + t.hits, 0);
  const phase = k.phase === 1 ? '1 armored' : '2 purged (fast)';
  return [
    `GOURAI (dev)  ${f0(k.elapsed)}s  laps ${f1(b.laps)}`,
    `state  ${act} ${f1(k.actionTime)}s${k.coreOpen ? '  CORE OPEN' : ''}`,
    `phase  ${phase}  hp ${f0(k.parts.hp)}/${f0(k.parts.maxHp)} (${f0(k.parts.ratio * 100)}%)`,
    `heat   ${f0(k.heat)}/${String(C.heat.max)} ×${f1(k.heatMul)}  vents ${String(k.vents)}`,
    `next   ${next}`,
    `turret ${String(k.turretsAlive)}/6 [${turrets}]`,
    `shots  ${String(guns + missiles)}/${String(C.shotCap)} (gun ${String(guns)} msl ${String(missiles)})  drop ${String(shots.dropped)}`,
    `       fired g${String(k.fired.gun)} m${String(k.fired.missile)}  hit g${String(k.hits.gun)} m${String(k.hits.missile)}  flared ${String(k.decoyed)}`,
    `you    ${side} ${f0(aim.yawDeg)}°  dist ${f0(dist)}m  dy ${f0(pl.y - b.position.y)}m`,
    `alt ${f0(b.position.y)}m  agl ${f0(b.position.y - floor)}m  spd ${f1(Math.hypot(b.velocity.x, b.velocity.z))}`,
    `broken ${broken}`,
    `hits on kaiju ${String(hits)}  taken g${String(dev.taken.gun)} m${String(dev.taken.missile)}`,
    `tris ${String(obj.triangles)} + shot 8×n  draws ${String(obj.draws)}`,
    dev.lateStart ? 'LATE START (replay differs)' : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
