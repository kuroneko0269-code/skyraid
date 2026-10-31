// P2P のメッセージ（5-1）の型（直列化は message-codec.ts）。すべて ArrayBuffer（ビッグエンディアン）。先頭 1 バイトが種類。
// join / welcome / event は確実に届く経路、input / state / ping は順不同の経路で送る（transport.ts）。
// 位置は float32、姿勢は smallest-three（6 バイト）、速度ベクトルは 1/16 m/s 単位の int16。Three.js 非依存
import type { Quat, Vec3 } from '../flight/math';
import type { NetControls } from './net-controls';

export { NO_TARGET, createNetControls, quantizeControls, type NetControls } from './net-controls';

/** ホストのゲーム設定（welcome で配る。ロビーでホストが撃墜数と時間を選ぶ。5-3） */
export interface GameSettings {
  mapId: string;
  timeLimitSeconds: number;
  scoreLimit: number;
}

export interface PlayerInfo {
  /** 0〜3。ホストは 0。色もこれで決まる */
  id: number;
  name: string;
  aircraftId: string;
  /** 最大 HP（ホストが機体と強化から決める。名札の HP バー。5-3） */
  maxHp: number;
}

export interface UpgradeLevelsMsg {
  engine: number;
  airframe: number;
  weapons: number;
  avionics: number;
}

export interface JoinMsg {
  type: 'join';
  version: number;
  name: string;
  aircraftId: string;
  upgrades: UpgradeLevelsMsg;
}

export const WELCOME_STATUS = ['ok', 'full', 'started', 'version'] as const;
export type WelcomeStatus = (typeof WELCOME_STATUS)[number];

/** 参加の返事と、ロビーの名簿（名簿が変わるたびに全員へ送り直す） */
export interface WelcomeMsg {
  type: 'welcome';
  status: WelcomeStatus;
  /** 受け取った人の ID（status が ok でなければ 0） */
  yourId: number;
  settings: GameSettings;
  players: PlayerInfo[];
}

/** 入力（クライアント → ホスト、30Hz）。controls[0] が seq（最新）、controls[i] が seq - i のステップ */
export interface InputMsg {
  type: 'input';
  seq: number;
  /** seq のステップでクライアントが他機を表示していたホストの tick（遅延補償。5-3。0 はまだ表示していない） */
  viewTick: number;
  controls: NetControls[];
}

export interface AircraftStateMsg {
  id: number;
  alive: boolean;
  afterburner: boolean;
  /** 復帰後の無敵中（5-3。半透明で表示） */
  invulnerable: boolean;
  /** ホストがこの機体に使った最後の入力の seq（ホスト自身の機体は 0） */
  lastInputSeq: number;
  position: Vec3;
  orientation: Quat;
  velocity: Vec3;
  /** 進行方向の速さ（m/s。失速の沈下を含まない。自機の補正に使う） */
  speed: number;
  /** スロットル位置 0〜1 */
  throttle: number;
  hp: number;
}

/** 状態（ホスト → 全員、15Hz）。tick はホストの固定ステップの番号（60Hz） */
/** 飛んでいるミサイル（5-3。位置は 0.5m・速度は 1/16 m/s に丸める） */
export interface MissileStateMsg {
  /** ホストの発射の通し番号の下位 8 ビット（表示側でミサイルを見分ける） */
  netId: number;
  /** 撃ったプレイヤー ID（0〜3） */
  owner: number;
  /** 追っているプレイヤー ID（NO_TARGET は直進） */
  targetId: number;
  position: Vec3;
  velocity: Vec3;
}

export interface StateMsg {
  type: 'state';
  tick: number;
  aircraft: AircraftStateMsg[];
  missiles: MissileStateMsg[];
}

export const EVENT_KINDS = [
  'start',
  'end',
  'fire',
  'kill',
  'hit',
  'explode',
  'flare',
  'respawn',
  'over',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** kill の a（撃墜した人）: 墜落（自滅） */
export const KILLER_NONE = 255;

/**
 * できごと（確実に届く経路）。start: 飛行開始 / end: セッション終了 / over: 対戦の終了（5-3）。
 * 戦闘（5-3。すべてホストが決める）:
 * fire: 機銃の引き金（a = 撃つ人、b = 1 引いた / 0 離した）/ hit: 機銃の命中（a = 撃った人、b = 当たった人、xyz = 位置）/
 * explode: ミサイルの起爆（a = 撃った人、b = 当たった人 or NO_TARGET、n = netId、xyz = 爆心）/
 * kill: 撃墜（a = 撃墜した人 or KILLER_NONE、b = された人、xyz = 位置）/ flare: フレア（a = 撒いた人）/
 * respawn: 復帰（a = 人、b = 出現位置の番号、n = その機体に最後に使った入力の seq）
 */
export interface EventMsg {
  type: 'event';
  kind: EventKind;
  a: number;
  b: number;
  /** できごとの時刻（ホストの tick） */
  tick: number;
  /** 種類ごとの数（explode の netId、respawn の seq） */
  n: number;
  x: number;
  y: number;
  z: number;
}

/** 1 人分の成績（5-3） */
export interface ScoreEntry {
  id: number;
  kills: number;
  deaths: number;
  /** 機銃の発射数と命中数（命中率） */
  shots: number;
  hits: number;
}

/** 成績と残り時間（ホスト → 全員。撃墜のたびと 1 秒ごと、終了時は over） */
export interface ScoreMsg {
  type: 'score';
  remainingSeconds: number;
  over: boolean;
  players: ScoreEntry[];
}

/** 生存確認と RTT。pong は受け取った ping の nonce と time をそのまま返す */
export interface PingMsg {
  type: 'ping';
  pong: boolean;
  nonce: number;
  /** 送った側の時計（ms） */
  time: number;
}

export type NetMessage = JoinMsg | WelcomeMsg | InputMsg | StateMsg | EventMsg | PingMsg | ScoreMsg;

export { decodeMessage, encodeMessage } from './message-codec';

/** できごとのメッセージを作る（使わない欄は 0） */
export function eventMsg(
  kind: EventKind,
  a: number,
  b: number,
  tick: number,
  n = 0,
  x = 0,
  y = 0,
  z = 0,
): EventMsg {
  return { type: 'event', kind, a, b, tick, n, x, y, z };
}
