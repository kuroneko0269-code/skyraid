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
  /** レイドの高難度（6-6。HP ×1.4・予兆 −0.5 秒・最終フェーズ 3.5 分・報酬 ×1.8） */
  hard: boolean;
  /** 天候のプリセット（7-5。src/data/weather.ts の id。全員が同じ天候で飛ぶ） */
  weather: string;
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
  /** ロックしている怪獣の部位の番号（6-6。NO_PART はなし） */
  lockPart: number;
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

/** 怪獣の部位 1 つ（6-2。レイド） */
export interface KaijuPartStateMsg {
  /** 部位 HP の割合（0〜1。u16） */
  hpRatio: number;
  /** ブレイクの残り秒数 */
  breakTimer: number;
}

/**
 * 怪獣の状態（6-2。レイドのときだけ state に入る。ホストが動かし、クライアントは表示と HUD に使う）。
 * 判定（当たり・ダメージ）はホストだけ。6-6 で 40 バイト以下に詰めた（codec-kaiju.ts）。岩は event（rock）で送る
 */
export interface KaijuStateMsg {
  /** KAIJU_STAGES の番号 */
  stage: number;
  feet: Vec3;
  heading: number;
  /** 攻撃（KAIJU_ATTACKS の番号。NO_ATTACK はなし）と段階（ATTACK_STEPS の番号）・経過・長さ（秒） */
  attack: number;
  attackStep: number;
  attackTime: number;
  attackDuration: number;
  downTimer: number;
  /** 歩いた歩数（送るのは 2 で割った余り。写しが続きの値に直す） */
  walkPhase: number;
  hp: number;
  maxHp: number;
  phase: number;
  /** 最終フェーズの残り秒数（null は始まっていない） */
  finalRemaining: number | null;
  parts: KaijuPartStateMsg[];
  /** 熱線の向き（null は撃っていない） */
  beam: Vec3 | null;
  /** 攻撃の対象のプレイヤー ID（6-6。攻撃中だけ。NO_TARGET はなし） */
  targetId: number;
}

/** KaijuStateMsg.attack: 攻撃していない */
export const NO_ATTACK = 255;

/** 防衛戦（7-2）の敵の戦闘機 1 機（表示用。位置は 0.5m、姿勢は smallest-three） */
export interface DefenseFighterMsg {
  /** 敵機の入れ物の番号（ホストの世界の squadron.enemies の添字） */
  index: number;
  /** 機銃を撃っている */
  firing: boolean;
  position: Vec3;
  orientation: Quat;
}

/**
 * 防衛戦（7-2）の状態（防衛戦のときだけ state に入る。判定はホストだけ）。
 * 爆撃機・巡航ミサイルは出現の event（dspawn）から各自が直進を再現し、撃墜・着弾・離脱は event（dkill）。
 * 戦闘機は 1 回の state に半分ずつ（7.5Hz）入れる（codec-defense.ts）
 */
export interface DefenseStateMsg {
  /** DEFENSE_PHASES の番号 */
  phase: number;
  wave: number;
  remaining: number;
  /** 準備の残り秒数 */
  intermission: number;
  hqHp: number;
  hqMaxHp: number;
  /** 施設の状態のビット（FACILITY_KINDS の順） */
  aliveBits: number;
  /** 次の波の来る方向（マップの approaches の番号）と数 */
  approach: number;
  fighters: number;
  bombers: number;
  cruise: number;
  /** スキップを押した人・この準備で補給した人のビット（1 << ID） */
  skipMask: number;
  supplyMask: number;
  /** この state に入れた戦闘機（全部の半分ずつ） */
  enemies: DefenseFighterMsg[];
}

export interface StateMsg {
  type: 'state';
  tick: number;
  aircraft: AircraftStateMsg[];
  missiles: MissileStateMsg[];
  /** レイドの怪獣（6-2。レイドでなければ null） */
  kaiju: KaijuStateMsg | null;
  /** 防衛戦（7-2。防衛戦でなければ null） */
  defense: DefenseStateMsg | null;
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
  'stun',
  'rock',
  'break',
  'skip',
  'brief',
  'dspawn',
  'dkill',
  'dsupply',
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
 * bye: クライアントが自分から抜ける（5-4。ホストは再接続を待たずに消す）/
 * stun: 怪獣の咆哮でスタン（6-2。a = 人、n = 秒 × 100）/
 * 6-6: rock: 怪獣の岩（a = 岩の番号、b = 0 投げた（xyz = 位置、n = 速度を packRockVelocity で詰めたもの）/ 1 落ちた（xyz = 位置））/
 * break: ブレイク（a = 部位の番号、b = 貢献者のビット（1 << ID））/ skip: ブリーフィングのスキップ（クライアント → ホスト）/
 * brief: ブリーフィングの終わり（ホスト → 全員。この後カウントダウン。n = カウントダウンの残り tick）/
 * over の n: クリア時間（カウントダウンの後からの tick）。
 * 7-2（防衛戦）: dspawn: 爆撃機・巡航ミサイルが出た（a = 種類 DEFENSE_KIND、b = 入れ物の番号、xyz = 出た位置、
 * n = 爆撃機の目標の施設の番号）/ dkill: 敵が消えた（a = 撃墜した人・DKILL_IMPACT（巡航ミサイルの着弾）・DKILL_ESCAPE（離脱）・
 * KILLER_NONE（対空砲・墜落）、b = 種類、n = 入れ物の番号、xyz = 位置）/ dsupply: 補給（a = 人、n = 満タンに対する % ）。
 * skip は防衛戦の準備のスキップにも使う
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
  /** レイド（6-6）: 部位別の与ダメージ（KAIJU_PARTS の順。PvP は空）とブレイクに貢献した回数 */
  partDamage: number[];
  breaks: number;
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

/** 壊れた建物（6-6。ホスト → 全員、確実な経路）。ids は街の生成順の番号（BuildingField の添字） */
export interface RuinMsg {
  type: 'ruin';
  ids: number[];
}

export type NetMessage =
  | JoinMsg
  | WelcomeMsg
  | InputMsg
  | StateMsg
  | EventMsg
  | PingMsg
  | ScoreMsg
  | LobbyMsg
  | ChatMsg
  | RuinMsg;

/** 防衛戦（7-2）の敵の種類（dspawn・dkill の a / b） */
export const DEFENSE_KIND = { fighter: 0, bomber: 1, cruise: 2 } as const;
/** dkill の a: 巡航ミサイルが司令部に着いた / 爆撃機・戦闘機が離脱した */
export const DKILL_IMPACT = 254;
export const DKILL_ESCAPE = 253;
/** MissileStateMsg.owner: 防衛戦の敵のミサイル（7-2） */
export const ENEMY_OWNER = 4;

/** AircraftStateMsg.lockPart: ロックしていない */
export const NO_PART = 7;

/** 岩の速度（m/s、各軸 ±511）を event の n（u32）に詰める（1 m/s 単位） */
export function packRockVelocity(v: Readonly<Vec3>): number {
  const q = (x: number): number => (Math.round(Math.min(511, Math.max(-511, x))) + 512) & 1023;
  return (q(v.x) | (q(v.y) << 10) | (q(v.z) << 20)) >>> 0;
}

export function unpackRockVelocity(n: number, out: Vec3): Vec3 {
  out.x = (n & 1023) - 512;
  out.y = ((n >>> 10) & 1023) - 512;
  out.z = ((n >>> 20) & 1023) - 512;
  return out;
}

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
