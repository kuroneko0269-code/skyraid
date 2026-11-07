// 10-3a: 白鯨アルビオンの遅延チャンク（?dev=albion のときだけ読む。読むのは src/ui/albion-link.ts）:
// フリーフライトにアルビオンだけを出し（判定は missions/albion-dev.ts）、形（render/albion-model/）と左の値の表示
// （状態・段階・体力・次の攻撃・子分の数・距離・高さ・周回・壊れた部位・当たり・三角形と描画の回数。タップ / クリックで畳む）。
// URL: ?abhp=<1〜100>（体力の割合 → 段階）・?abbreak=nestFront,nestMid,nestRear,dorsal,tail,head・?abroute=bay（港湾都市の湾）
import './albion-dev.css';
import type { Scene } from 'three';
import { attackWeights, axisOffset } from '../ai/albion-attacks';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { ALBION_CONFIG as C, ALBION_PARTS } from '../data/albion';
import type { MapDef } from '../data/maps';
import type { AlbionGround } from '../entities/albion/albion-body';
import { attachAlbionDev, parseAlbionOptions, type AlbionDev } from '../missions/albion-dev';
import type { GamePlay } from '../missions/game-play';
import { AlbionObject } from '../render/albion-model/albion-object';

export interface AlbionRuntimeParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly search: string;
  readonly ground: AlbionGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  readonly state: () => ScreenState;
  readonly inFreeFlight: () => boolean;
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
}

/** 怪獣を出している画面（ポーズ・フォトモード・結果の画面の後ろも見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause', 'photo', 'result'];

export function startAlbion(p: AlbionRuntimeParts): AlbionDev {
  const dev = attachAlbionDev(p.play, parseAlbionOptions(p.search), {
    ground: p.ground,
    map: p.map,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  const obj = new AlbionObject('high');
  p.scene.add(...obj.objects);
  p.onDetail((d) => {
    obj.setDetail(d);
  });
  const panel = document.createElement('div');
  panel.className = 'albion-dev';
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
  const prevMinion = (i: number) => dev.minionTargets[i]?.prevPosition ?? dev.kaiju.body.position;
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
    if (shown) obj.update(dev.kaiju, alpha, dt, prevMinion, flash);
    panel.hidden = !(dev.flying && state === 'flight');
    if (panel.hidden) return;
    const text = collapsed ? 'ALBION (dev) ▸' : panelText(dev, obj);
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
function panelText(dev: AlbionDev, obj: AlbionObject): string {
  const k = dev.kaiju;
  const b = k.body;
  const pl = dev.playerPosition;
  const sw = k.swarm;
  const act = k.attack ? `${k.attack} ${k.action}` : k.action;
  const cands = attackWeights(k, pl).map((c) => `${c.attack}×${f1(c.weight)}`);
  const next =
    k.action === 'idle'
      ? `in ${f1(Math.max(0, k.cooldown))}s [${cands.join(',') || 'none'}]`
      : `${act} ${f1(k.actionLeft)}s left`;
  const broken = ALBION_PARTS.filter((_, i) => k.parts.isBroken(i)).join(',') || 'none';
  const floor = b.floorAt(b.position.x, b.position.z);
  const dist = Math.hypot(pl.x - b.position.x, pl.y - b.position.y, pl.z - b.position.z);
  const o = axisOffset(b, pl);
  const hits = dev.partTargets.reduce((s, t) => s + t.hits, 0);
  const draws =
    1 + (obj.minions.mesh.visible ? 1 : 0) + obj.fx.objects.filter((m) => m.visible).length;
  const nextWave = sw.timer;
  return [
    `ALBION (dev)  ${f0(k.elapsed)}s  lap ${f1(b.laps)}`,
    `state  ${act} ${f1(k.actionTime)}s${b.turning ? '  (turning)' : ''}`,
    `phase  ${String(k.phase)}  hp ${f0(k.parts.hp)}/${f0(k.parts.maxHp)} (${f0(k.parts.ratio * 100)}%)`,
    `next   ${next}`,
    `cloud  ${k.cloudLeft > 0 ? `${f1(k.cloudLeft)}s` : '-'}${dev.inCloud ? '  PLAYER IN CLOUD' : ''}`,
    `minion ${String(sw.activeCount)}/${String(C.minions.cap)}  wave in ${f1(Math.max(0, nextWave))}s`,
    `       spawned ${String(sw.spawned)} kills ${String(sw.kills)} gone ${String(sw.expired)} rams ${String(k.rams)}`,
    `dist ${f0(dist)}m  side ${f0(o.side)}m  above ${f0(o.above)}m`,
    `alt ${f0(b.position.y)}m  agl ${f0(b.position.y - floor)}m  spd ${f1(b.speed)}`,
    `broken ${broken}`,
    `hits on kaiju ${String(hits)}  taken s${String(dev.taken.spout)} t${String(dev.taken.slam)} r${String(dev.taken.ram)}`,
    `tris ${String(obj.triangles)} + minion ${String(obj.minions.triangles)}×n  draws ${String(draws)}`,
    dev.lateStart ? 'LATE START (replay differs)' : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
