// 9-6a: 確かめる場（?dev=kaiju2）の組み立て（遅延チャンク。?dev=kaiju2 のときだけ app.ts が読む）:
// フリーフライトに空の怪獣ネフィルガだけを出す（判定は missions/kaiju2-dev.ts、形は render/kaiju2-model/）、
// 左に値の表示（状態・段階・次の攻撃・スタミナ・距離・部位・当てた回数・三角形）。表示はタップ / クリックで畳む。
// URL: ?k2hp=<1〜100>（体力の割合 → 段階）・?k2break=wingL,wingR,head,tail（壊れた部位で始める）
import './kaiju2-dev.css';
import type { Scene } from 'three';
import { attackCandidates, geometryTo } from '../ai/kaiju2-attacks';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { KAIJU2_PARTS } from '../data/kaiju2';
import type { MapDef } from '../data/maps';
import type { GamePlay } from '../missions/game-play';
import { attachKaiju2Dev, parseKaiju2Options, type Kaiju2Dev } from '../missions/kaiju2-dev';
import { Kaiju2Object } from '../render/kaiju2-model/kaiju2-object';

export interface Kaiju2DevParts {
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly search: string;
  readonly ground: (x: number, z: number) => number;
  readonly map: () => Pick<MapDef, 'center'>;
  readonly state: () => ScreenState;
  /** 今フリーフライトを飛んでいる（読み込みが遅れたときに使う） */
  readonly inFreeFlight: () => boolean;
  /** 画質の機体の細かさ（今の値をすぐと、変わるたび） */
  readonly onDetail: (fn: (d: AircraftDetail) => void) => void;
  /** 描画フレームごと（補間の alpha） */
  readonly onRender: (fn: (alpha: number) => void) => void;
}

/** 怪獣を出している画面（ポーズ中も見える） */
const SHOWN: readonly ScreenState[] = ['flight', 'pause'];

export function startKaiju2Dev(p: Kaiju2DevParts): Kaiju2Dev {
  const dev = attachKaiju2Dev(p.play, parseKaiju2Options(p.search), {
    ground: p.ground,
    map: p.map,
  });
  // 読み込みが遅れてフリーフライトがもう始まっていたら、その場で出す（この飛行のリプレイは怪獣なしの記録と合わない）
  if (p.state() === 'flight' && p.inFreeFlight()) dev.startLate();
  const obj = new Kaiju2Object('high');
  p.scene.add(...obj.objects);
  p.onDetail((d) => {
    obj.setDetail(d);
  });
  const panel = document.createElement('div');
  panel.className = 'kaiju2-dev';
  panel.hidden = true;
  let collapsed = false;
  panel.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('is-collapsed', collapsed);
  });
  document.body.append(panel);
  let last = performance.now();
  let lastText = '';
  p.onRender((alpha) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const shown = dev.freeFlying && SHOWN.includes(p.state());
    obj.setVisible(shown);
    if (shown) obj.update(dev.body, alpha, dt);
    panel.hidden = !(shown && p.state() === 'flight');
    if (panel.hidden) return;
    const text = collapsed ? 'NEPHIRGA (dev) ▸' : panelText(dev, obj.triangles);
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
function panelText(dev: Kaiju2Dev, triangles: number): string {
  const k = dev.body;
  const target = dev.playerPosition;
  const g = geometryTo(k, target);
  const cands = attackCandidates(g, k.phase, k.broken, k.history);
  const act = k.attack ? `${k.attack} ${k.state}` : k.state;
  const next =
    k.state === 'cruise'
      ? `${cands[0] ?? '-'} in ${f1(Math.max(0, k.attackCooldown))}s [${cands.join(',') || 'none'}]`
      : '-';
  const broken = KAIJU2_PARTS.filter((x) => k.broken[x]).join(',') || 'none';
  const floor = k.floorAt(k.position.x, k.position.z);
  return [
    'NEPHIRGA (dev)',
    `state  ${act} ${f1(k.stateTime)}s`,
    `phase  ${String(k.phase)}  hp ${f0(k.hpRatio * 100)}%`,
    `next   ${next}`,
    `stamina ${f0(Math.max(0, k.stamina))}s`,
    `dist ${f0(g.distance)}m  ang ${f0(g.angle)}°`,
    `alt ${f0(k.position.y)}m  agl ${f0(k.position.y - floor)}m  spd ${f0(k.speed)}`,
    `broken ${broken}`,
    `hits o${String(k.hits.orbs)} g${String(k.hits.gust)} d${String(k.hits.dive)} t${String(k.hits.tail)}`,
    `tris ${String(triangles)}  ${dev.lateStart ? 'LATE START (replay differs)' : ''}`,
  ].join('\n');
}
