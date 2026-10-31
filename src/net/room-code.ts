// 部屋コード・PeerJS の ID・参加の失敗の型（5-1 の room.ts から 5-4 で分けた）。Three.js・DOM 非依存
import { NET_CONFIG } from '../data/net';
import type { GameSettings, UpgradeLevelsMsg, WelcomeStatus } from './protocol';
import type { TransportOpener } from './transport';

const C = NET_CONFIG.room;

/** 紛らわしい文字（0 / O / 1 / I）を含まない部屋コード */
export function generateRoomCode(rng: () => number = Math.random): string {
  const a = C.codeAlphabet;
  let s = '';
  for (let i = 0; i < C.codeLength; i++) s += a[Math.floor(rng() * a.length) % a.length] ?? 'A';
  return s;
}

/** 入力された部屋コードを整える（小文字・空白・ハイフンを許す）。形が違えば null */
export function normalizeRoomCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== C.codeLength) return null;
  for (const ch of s) if (!C.codeAlphabet.includes(ch)) return null;
  return s;
}

export function hostPeerId(code: string): string {
  return `${C.peerIdPrefix}${code}`;
}

export function clientPeerId(rng: () => number): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(rng() * 36).toString(36);
  return `${C.peerIdPrefix}c-${s}`;
}

/** 参加する人の情報（パイロット名と、ハンガーで選んだ機体・強化） */
export interface PlayerProfile {
  name: string;
  aircraftId: string;
  upgrades: UpgradeLevelsMsg;
}

/** 終わり方: ホストが抜けた / 自分で抜けた / 再接続できなかった（5-4） */
export type RoomEndReason = 'host-left' | 'left' | 'lost';
export type JoinError =
  Exclude<WelcomeStatus, 'ok'> | 'not-found' | 'timeout' | 'network' | 'unsupported';

export class JoinFailure extends Error {
  constructor(readonly reason: JoinError) {
    super(reason);
  }
}

export interface RoomOptions {
  open: TransportOpener;
  profile: PlayerProfile;
  rng?: () => number;
  now?: () => number;
  settings?: GameSettings;
}
