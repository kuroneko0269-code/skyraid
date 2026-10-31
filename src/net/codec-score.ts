// 成績（score）の直列化（5-3。6-6 で message-codec.ts から分けた）: 残り時間 1/10 秒・終わりの旗・1 人分（撃墜・被撃墜・
// 機銃の発射数と命中数・最長連続撃墜）。6-6: レイドの部位別の与ダメージ（u16 × 部位数。PvP は 0 個）とブレイクの回数。Three.js 非依存
import type { ByteReader, ByteWriter } from './codec';
import type { ScoreEntry, ScoreMsg } from './protocol';

function clamp16(v: number): number {
  return Math.round(Math.min(65535, Math.max(0, v)));
}

export function writeScore(w: ByteWriter, msg: Readonly<ScoreMsg>): void {
  w.u16(clamp16(msg.remainingSeconds * 10))
    .u8(msg.over ? 1 : 0)
    .u8(msg.players.length);
  for (const p of msg.players) {
    w.u8(p.id).u8(Math.min(255, p.kills)).u8(Math.min(255, p.deaths));
    w.u16(clamp16(p.shots)).u16(clamp16(p.hits)).u8(Math.min(255, p.bestStreak));
    w.u8(p.partDamage.length);
    for (const d of p.partDamage) w.u16(clamp16(d));
    w.u8(Math.min(255, p.breaks));
  }
}

export function readScore(r: ByteReader): ScoreMsg {
  const remainingSeconds = r.u16() / 10;
  const over = r.u8() === 1;
  const n = r.u8();
  const players: ScoreEntry[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.u8();
    const kills = r.u8();
    const deaths = r.u8();
    const shots = r.u16();
    const hits = r.u16();
    const bestStreak = r.u8();
    const parts = Math.min(8, r.u8());
    const partDamage: number[] = [];
    for (let j = 0; j < parts; j++) partDamage.push(r.u16());
    const breaks = r.u8();
    players.push({ id, kills, deaths, shots, hits, bestStreak, partDamage, breaks });
  }
  return { type: 'score', remainingSeconds, over, players };
}
