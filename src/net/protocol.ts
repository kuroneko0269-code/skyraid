// P2P のメッセージ（5-1）の型（直列化は message-codec.ts）。すべて ArrayBuffer（ビッグエンディアン）。先頭 1 バイトが種類。
// join / welcome / event は確実に届く経路、input / state / ping は順不同の経路で送る（transport.ts）。
// 位置は float32、姿勢は smallest-three（6 バイト）、速度ベクトルは 1/16 m/s 単位の int16。Three.js 非依存
import type { PvpMode } from '../data/pvp';
import type { Quat, Vec3 } from '../flight/math';
import type { NetControls } from './net-controls';

export { NO_TARGET, createNetControls, quantizeControls, type NetControls } from './net-controls';

/** ホストのゲーム設定（welcome で配る。ロビーでホストが撃墜数と時間（5-3）、モード・強化の無効・初心者保護（5-4）を選ぶ） */
export interface GameSettings {
  mapId: string;
  timeLimitSeconds: number;
  /** 撃墜数の上限（チーム戦はチームの合計） */
  scoreLimit: number;
  mode: PvpMode;
  /** 強化を無効にする（全員が強化 Lv 0 の数値で飛ぶ） */
  noUpgrades: boolean;
  /** 初心者保護（撃墜数が最下位の人の復帰時に HP +50%・ミサイル +2） */
  rookieGuard: boolean;
}

/** チームなし（個人戦） */
export const NO_TEAM = 255;

export interface PlayerInfo {
  /** 0〜3。ホストは 0。色もこれで決まる */
  id: number;
  name: string;
  aircraftId: string;
  /** 最大 HP（ホストが機体と強化から決める。名札の HP バー。5-3） */
  maxHp: number;
  /** チーム戦のチーム（0 / 1。個人戦でもホストの割当を残す。5-4） */
  team: number;
  /** ロビーの準備ができた（ホストは見ない。5-4） */
  ready: boolean;
  /** リザルトの「もう一度」を押した（5-4） */
  again: boolean;
  /** 切断して再接続を待っている（5-4） */
  away: boolean;
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
  /** 再接続（5-4）: 前の ID（NO_RESUME は新しく参加）と合言葉 */
  resumeId: number;
  token: number;
}

/** join の resumeId: 新しく参加する */
export const NO_RESUME = 255;

/** ロビーでの自分の状態（クライアント → ホスト。変わるたびに全部送る。5-4） */
export interface LobbyMsg {
  type: 'lobby';
  ready: boolean;
  again: boolean;
  aircraftId: string;
  upgrades: UpgradeLevelsMsg;
}

/** 定型文（5-4）。クライアント → ホスト（from は無視）、ホスト → 全員（from は送った人） */
export interface ChatMsg {
  type: 'chat';
  from: number;
  phrase: number;
}

/** 参加の返事。expired: 再接続の期限が過ぎた・合言葉が違う（5-4） */
export const WELCOME_STATUS = ['ok', 'full', 'started', 'version', 'expired'] as const;
export type WelcomeStatus = (typeof WELCOME_STATUS)[number];

/** 参加の返事と、ロビーの名簿（名簿が変わるたびに全員へ送り直す） */
export interface WelcomeMsg {
  type: 'welcome';
  status: WelcomeStatus;
  /** 受け取った人の ID（status が ok でなければ 0） */
  yourId: number;
  /** 再接続の合言葉（受け取った人だけのもの。5-4） */
  yourToken: number;
  /** 対戦中か（再接続の間に対戦が終わっていたら、クライアントはロビーへ戻る。5-4） */
  inMatch: boolean;
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
  'bye',
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
 * respawn: 復帰（a = 人、b = 出現位置の番号（+ RESPAWN_BOOST は初心者保護つき。pvp-arena.ts）、n = その機体に最後に使った入力の seq）/
 * bye: クライアントが自分から抜ける（5-4。ホストは再接続を待たずに消す）
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
  /** 最長連続撃墜（撃墜されずに続けた撃墜数の最大。5-4） */
  bestStreak: number;
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

export type NetMessage =
  JoinMsg | WelcomeMsg | InputMsg | StateMsg | EventMsg | PingMsg | ScoreMsg | LobbyMsg | ChatMsg;

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
