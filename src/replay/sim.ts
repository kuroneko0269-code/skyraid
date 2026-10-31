// 記録と再生で共通の判定の進め方（7-B。Three.js・DOM 非依存）: 飛行の始め方（初期状態 → 世界）・1 ステップの入力の
// 量子化と読み書き・固定ステップ 1 回分・外部の操作。本番の飛行（ui/flight-loop.ts・ui/flight-start.ts）・再生・テスト・
// レースのゴーストが同じ関数を通るので、同じ記録なら同じ結果になる
import { applyKaijuToCity } from '../combat/city-damage';
import type { BuildingField } from '../combat/buildings';
import type { CombatInput } from '../combat/combat-input';
import { AIM_ASSIST_CONFIG } from '../data/assist';
import { findCourse } from '../data/courses';
import { findDefenseMap } from '../data/defense';
import { findMap, ISLAND_MAP } from '../data/maps';
import { MISSIONS } from '../data/missions';
import { raidMission } from '../data/missions-special';
import { REPLAY_CONFIG } from '../data/replay';
import { WORLD_CONFIG } from '../data/terrain';
import { AIRCRAFT_MODELS, findAircraftModel } from '../data/aircraft';
import type { AircraftControls } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import type { GamePlay } from '../missions/game-play';
import type { MissionDef } from '../missions/types';
import { resolveLoadout, type Loadout } from '../progression/loadout';
import { hashState, type StateSnapshot, type WalkSkip } from './state-walk';
import type { ReplayCommand, ReplayFrame, ReplayStart } from './types';

/** 再生・記録が触る世界 */
export interface SimWorld {
  readonly play: GamePlay;
  /** マップを id のものにする（地形・街。同じなら建物を建て直す） */
  useMap(id: string): void;
  readonly buildings: () => BuildingField | null;
  /** 起動直後の状態の写し（前の飛行の名残を消してから始める。なければ書き戻さない） */
  readonly pristine?: StateSnapshot | null;
}

/** 状態の走査の根（ハッシュ・キーフレーム）: ゲームの進行と街の建物 */
export function simRoots(w: Pick<SimWorld, 'play' | 'buildings'>): object[] {
  const b = w.buildings();
  return b ? [w.play, b] : [w.play];
}

/** 走査しないもの: 操作設定（オートレベル・反転は毎ステップの入力に入れて書く） */
export function simSkip(play: GamePlay): WalkSkip {
  const options = play.session.aircraft.flight.options;
  return (o) => o === options;
}

/** 今の状態のハッシュ */
export function simHash(w: Pick<SimWorld, 'play' | 'buildings'>): string {
  return hashState(simRoots(w), simSkip(w.play));
}

export function missionFor(
  s: Pick<ReplayStart, 'mode' | 'missionId' | 'raidDifficulty'>,
): MissionDef | null {
  if (s.mode === 'raid') return raidMission(s.raidDifficulty ?? 'normal');
  if (s.mode !== 'mission') return null;
  return MISSIONS.find((m) => m.id === s.missionId) ?? null;
}

export function loadoutFor(s: Pick<ReplayStart, 'aircraftId' | 'upgrades'>): Loadout {
  const model = findAircraftModel(s.aircraftId) ?? AIRCRAFT_MODELS[0];
  if (!model) throw new Error('機体の定義がない');
  return resolveLoadout(model, s.upgrades);
}

/**
 * 初期状態から飛行を始める（本番の飛行の始め・再生の始めの両方）: 名残を消す → 敵の設定 → 装備 → マップ → シード → モード。
 * 見た目（機体の形・カメラ）は呼び出し側
 */
export function startFromHeader(w: SimWorld, s: ReplayStart): void {
  const play = w.play;
  const session = play.session;
  w.pristine?.restore();
  w.play.announceModes();
  session.setFreeEnemies(s.enemies);
  session.applyLoadout(loadoutFor(s));
  w.useMap(s.mapId);
  const map = findMap(s.mapId);
  session.setFreeStart(map.id === ISLAND_MAP.id ? WORLD_CONFIG.start : map.start);
  play.reseed(s.seed);
  switch (s.mode) {
    case 'race': {
      const course = findCourse(s.courseId ?? '');
      if (!course) throw new Error(`コース ${s.courseId ?? ''} がない`);
      const ref = s.raceReference;
      play.startRace(course, ref ? { ringTimes: ref } : null);
      break;
    }
    case 'defense':
      play.startDefense(findDefenseMap(s.mapId), s.defenseDifficulty ?? 'normal');
      break;
    case 'mission':
    case 'raid': {
      const def = missionFor(s);
      if (!def) throw new Error(`ミッション ${s.missionId ?? ''} がない`);
      play.startMission(def);
      break;
    }
    default:
      play.startFree();
  }
}

/** 固定ステップ 1 回分（プレイヤー機・敵・ミッション → 街の建物の崩れ・怪獣が壊す建物） */
export function stepWorld(
  play: GamePlay,
  buildings: BuildingField | null,
  controls: Readonly<AircraftControls>,
  input: Readonly<CombatInput>,
  dt: number,
  coopKaiju = false,
): void {
  play.step(controls, input, dt);
  if (!buildings) return;
  buildings.step(dt);
  // 協力（6-6）はホストの RaidHost だけが壊して番号を配る
  if (!coopKaiju) applyKaijuToCity(buildings, play.session.props.kaiju, play.session.props.kaijuAi);
}

const AXIS = REPLAY_CONFIG.axisSteps;
const TT = REPLAY_CONFIG.throttleTargetSteps;
// | 0 で -0 を 0 にそろえる（記録の整数には -0 がない）
const qAxis = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * AXIS) | 0;

const BUTTONS = [
  'trigger',
  'missile',
  'flare',
  'targetNext',
  'rocket',
  'bomb',
  'bombHeld',
] as const;

/** 今の操作を記録の形（量子化した整数）にする */
export function captureFrame(
  out: ReplayFrame,
  controls: Readonly<AircraftControls>,
  input: Readonly<CombatInput>,
  session: FlightSession,
): ReplayFrame {
  out.pitch = qAxis(controls.pitch);
  out.roll = qAxis(controls.roll);
  out.yaw = qAxis(controls.yaw);
  out.throttle = qAxis(controls.throttle);
  const t = controls.throttleTarget;
  out.throttleTarget =
    t === null || t === undefined ? -1 : Math.round(Math.max(0, Math.min(1, t)) * TT);
  let b = controls.afterburner ? 1 : 0;
  BUTTONS.forEach((k, i) => {
    if (input[k]) b |= 2 << i;
  });
  out.buttons = b;
  const o = session.aircraft.flight.options;
  out.flags =
    (o.autoLevel ? 1 : 0) |
    (o.invertPitch ? 2 : 0) |
    (session.combat.gun.hitRadiusScale !== 1 ? 4 : 0);
  return out;
}

/**
 * 記録の形の操作を飛行に入れる（再生。本番も記録した値で上書きしてから進めるので、記録と同じ値で判定する）。
 * オートレベル・反転・エイムアシストの判定の拡大もここで入れる
 */
export function applyFrame(
  f: Readonly<ReplayFrame>,
  controls: AircraftControls,
  input: CombatInput,
  session: FlightSession,
): void {
  controls.pitch = f.pitch / AXIS;
  controls.roll = f.roll / AXIS;
  controls.yaw = f.yaw / AXIS;
  controls.throttle = f.throttle / AXIS;
  controls.throttleTarget = f.throttleTarget < 0 ? null : f.throttleTarget / TT;
  controls.afterburner = (f.buttons & 1) !== 0;
  BUTTONS.forEach((k, i) => {
    input[k] = (f.buttons & (2 << i)) !== 0;
  });
  const o = session.aircraft.flight.options;
  o.autoLevel = (f.flags & 1) !== 0;
  o.invertPitch = (f.flags & 2) !== 0;
  session.combat.gun.hitRadiusScale = f.flags & 4 ? AIM_ASSIST_CONFIG.gunHitRadiusScale : 1;
}

/** 外部の操作を効かせる（本番はその場で、再生は記録したステップの前に） */
export function applyCommand(play: GamePlay, c: Readonly<ReplayCommand>): void {
  const s = play.session;
  switch (c.kind) {
    case 'select':
      s.combat.targeting.select(s.combat.allTargets[c.target] ?? null);
      break;
    case 'skip':
      play.defense?.skip();
      break;
    case 'enemies':
      s.configureEnemies(c.enabled, c.difficulty, c.count);
      break;
  }
}
