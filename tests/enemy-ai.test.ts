import { describe, expect, it } from 'vitest';
import { createCommand, type AiSelf, type AiSenses } from '../src/ai/ai-types';
import { EnemyFighterAI } from '../src/ai/enemy-fighter';
import {
  canDetect,
  canFireGun,
  gunLeadPoint,
  hasRearPosition,
  inAttackWindow,
  interceptTime,
  needsGroundAvoid,
  predictPosition,
  pursuitPoint,
  tailAngleDeg,
} from '../src/ai/perception';
import { pitchLimitForG, steerToward } from '../src/ai/steering';
import { AI_CONFIG, DIFFICULTIES, DIFFICULTY_PRESETS, type DifficultySpec } from '../src/data/ai';
import { ENEMY_FIGHTER } from '../src/data/aircraft';
import { ENEMY_GUN_CONFIG } from '../src/data/weapons';
import { vec3, type Vec3 } from '../src/flight/math';
import { DT, lookQuat } from './combat-helpers';

const FORWARD: Vec3 = { x: 0, y: 0, z: -1 };

/** 判断を毎ステップ行い、確率の判定がすべて通る（rng = 0）AI の難易度 */
const INSTANT: DifficultySpec = {
  ...DIFFICULTY_PRESETS.normal,
  reactionSeconds: DT,
  evadeMissileChance: 1,
  evadeHitChance: 1,
  missileChance: 1,
  flareChance: 1,
};

type MutableSelf = { -readonly [K in keyof AiSelf]: AiSelf[K] };

function makeSelf(position: Vec3 = vec3(0, 1000, 0), dir: Vec3 = FORWARD): MutableSelf {
  return {
    position,
    orientation: lookQuat(dir),
    angularRate: vec3(),
    speed: 250,
    afterburnerGauge: 1,
    hpRatio: 1,
    agl: 1000,
    verticalSpeed: 0,
  };
}

function makeSenses(
  self: AiSelf,
  targetPos: Vec3 | null,
  targetVel: Vec3 = vec3(0, 0, -250),
): { -readonly [K in keyof AiSenses]: AiSenses[K] } {
  return {
    self,
    target: targetPos ? { position: targetPos, velocity: targetVel, active: true } : null,
    threat: null,
    damageTaken: 0,
    locked: false,
    missileReady: true,
    flareReady: true,
  };
}

function makeAi(d: DifficultySpec = INSTANT, rng: () => number = () => 0): EnemyFighterAI {
  return new EnemyFighterAI(ENEMY_FIGHTER, d, [{ x: 0, y: 1000, z: -5000 }], rng);
}

describe('発見判定', () => {
  it('索敵距離の中・機首から視野角以内なら見つける', () => {
    expect(canDetect(vec3(), FORWARD, vec3(0, 0, -4000))).toBe(true);
    // 機首から 60°（視野 ±70° の内側）
    const a = (60 * Math.PI) / 180;
    expect(canDetect(vec3(), FORWARD, vec3(Math.sin(a) * 3000, 0, -Math.cos(a) * 3000))).toBe(true);
  });

  it('視野の外・索敵距離の外は見つけない', () => {
    // 真後ろ 3km
    expect(canDetect(vec3(), FORWARD, vec3(0, 0, 3000))).toBe(false);
    // 正面 5km（索敵 4.5km の外）
    expect(canDetect(vec3(), FORWARD, vec3(0, 0, -5000))).toBe(false);
  });

  it('近距離（closeRange 以内）なら向きによらず見つける', () => {
    expect(canDetect(vec3(), FORWARD, vec3(0, 0, AI_CONFIG.detection.closeRange - 10))).toBe(true);
  });
});

describe('予測位置', () => {
  it('等速直線の t 秒後の位置', () => {
    const out = predictPosition(vec3(), vec3(100, 0, 0), vec3(10, 0, -20), 3);
    expect(out).toEqual({ x: 130, y: 0, z: -60 });
  });

  it('迎撃の予測時間: 横切る相手に追いつく時間は今の距離 ÷ 速さより長い', () => {
    const t = interceptTime(vec3(), 300, vec3(0, 0, -3000), vec3(200, 0, 0), 30, vec3());
    expect(t).toBeGreaterThan(3000 / 300);
    // 解の検算: t 秒後の相手の位置までの距離 = 300 t
    const p = predictPosition(vec3(), vec3(0, 0, -3000), vec3(200, 0, 0), t);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(300 * t, 3);
  });

  it('追尾の狙いは相手の今の位置ではなく予測位置（の後ろ）。純追尾ではない', () => {
    const target = vec3(0, 0, -3000);
    const vel = vec3(200, 0, 0);
    const aim = pursuitPoint(vec3(), vec3(), 300, target, vel, 250, 3);
    // 相手の進行方向（+X）へ先回りしている
    expect(aim.x).toBeGreaterThan(200);
    // 予測位置よりは後ろ（-X）にずらしている
    expect(aim.x).toBeLessThan(200 * 3);
  });

  it('機銃の予測照準点: 旋回中の相手は加速度の分だけ先を狙う', () => {
    const plain = vec3();
    const turning = vec3();
    const pos = vec3(0, 0, -800);
    const vel = vec3(200, 0, 0);
    const acc = vec3(0, 0, 60);
    const t = gunLeadPoint(plain, vec3(), 250, pos, vel, ENEMY_GUN_CONFIG);
    gunLeadPoint(turning, vec3(), 250, pos, vel, ENEMY_GUN_CONFIG, acc, 1);
    expect(t).toBeGreaterThan(0);
    expect(turning.z - plain.z).toBeCloseTo(0.5 * 60 * t * t, 6);
  });
});

describe('後方の判定・射撃条件', () => {
  it('相手の真後ろは 0°、真正面は 180°', () => {
    expect(tailAngleDeg(vec3(0, 0, 500), vec3(), FORWARD)).toBeCloseTo(0);
    expect(tailAngleDeg(vec3(0, 0, -500), vec3(), FORWARD)).toBeCloseTo(180);
    expect(hasRearPosition(vec3(0, 0, 500), vec3(), FORWARD)).toBe(true);
    expect(hasRearPosition(vec3(0, 0, -500), vec3(), FORWARD)).toBe(false);
  });

  it('機銃は予測照準点が機首から gunConeDeg 以内・gunRange 以内で撃つ', () => {
    const d = DIFFICULTY_PRESETS.normal;
    expect(canFireGun(d.gunConeDeg - 0.1, 800, d)).toBe(true);
    expect(canFireGun(d.gunConeDeg + 0.1, 800, d)).toBe(false);
    expect(canFireGun(0, AI_CONFIG.attack.gunRange + 1, d)).toBe(false);
  });

  it('攻撃の窓は入るときより出るときが広い（行き来しない）', () => {
    const a = AI_CONFIG.attack;
    expect(inAttackWindow(a.coneDeg + 1, 1000, true)).toBe(false);
    expect(inAttackWindow(a.coneDeg + 1, 1000, false)).toBe(true);
    expect(inAttackWindow(5, a.range * 1.1, true)).toBe(false);
    expect(inAttackWindow(5, a.range * 1.1, false)).toBe(true);
  });

  it('地表から 150m を切る・切りそうなら回避', () => {
    expect(needsGroundAvoid(140, 0)).toBe(true);
    expect(needsGroundAvoid(400, 0)).toBe(false);
    // 400m でも毎秒 100m 降下していれば 3 秒後に切る
    expect(needsGroundAvoid(400, -100)).toBe(true);
  });
});

describe('操縦', () => {
  it('右の狙いへは右ロール、頭上の狙いへは機首上げ', () => {
    const out = { pitch: 0, roll: 0, yaw: 0 };
    steerToward(out, lookQuat(FORWARD), vec3(), vec3(1, 0, -0.2), 1);
    expect(out.roll).toBeGreaterThan(0.5);
    steerToward(out, lookQuat(FORWARD), vec3(), vec3(0, 1, -1), 1);
    expect(out.pitch).toBeGreaterThan(0.5);
    expect(Math.abs(out.roll)).toBeLessThan(0.05);
  });

  it('最大 G でピッチ入力を頭打ちにする（巡航で 20G なら入力 約 0.6）', () => {
    const limit = pitchLimitForG(ENEMY_FIGHTER, 250, 20);
    // G = 速度 × ピッチ角速度 / 9.8 = 250 × (70° × 1.0 × limit) / 9.8
    expect((250 * ((70 * Math.PI) / 180) * limit) / 9.8).toBeCloseTo(20, 5);
    expect(pitchLimitForG(ENEMY_FIGHTER, 250, 1000)).toBe(1);
  });
});

describe('状態遷移', () => {
  it('巡航 → 視野内に発見で追尾', () => {
    const ai = makeAi();
    const self = makeSelf();
    const out = createCommand();
    ai.step(makeSenses(self, null), DT, out);
    expect(ai.state).toBe('patrol');
    ai.step(makeSenses(self, vec3(0, 1000, -3000)), DT, out);
    expect(ai.state).toBe('engage');
  });

  it('真後ろの遠い相手は見つけず巡航のまま', () => {
    const ai = makeAi();
    const self = makeSelf();
    ai.step(makeSenses(self, vec3(0, 1000, 3000)), DT, createCommand());
    expect(ai.state).toBe('patrol');
  });

  it('追尾 → 射程・角度に入ったら攻撃して機銃を撃ち、外れたら追尾へ戻る', () => {
    const ai = makeAi();
    const self = makeSelf(vec3(0, 1000, 0));
    const out = createCommand();
    // 正面 600m を同じ向きに飛ぶ相手（予測照準点はほぼ機首の先）
    const senses = makeSenses(self, vec3(0, 1000, -600), vec3(0, 0, -250));
    ai.step(senses, DT, out);
    expect(ai.state).toBe('engage');
    ai.step(senses, DT, out);
    expect(ai.state).toBe('attack');
    expect(out.trigger).toBe(true);
    // 相手が真横 1km に外れる
    const away = makeSenses(self, vec3(1000, 1000, 0), vec3(250, 0, 0));
    ai.step(away, DT, out);
    expect(ai.state).toBe('engage');
  });

  it('ロック完了で（確率・間隔の条件を満たせば）ミサイルを撃つ', () => {
    const ai = makeAi();
    const self = makeSelf();
    const out = createCommand();
    const senses = makeSenses(self, vec3(0, 1000, -2000));
    ai.step(senses, DT, out);
    senses.locked = true;
    ai.step(senses, DT, out);
    expect(out.missile).toBe(true);
    // 次は missileIntervalSeconds 経つまで撃たない
    ai.step(senses, DT, out);
    expect(out.missile).toBe(false);
  });

  it('ミサイルに追われたら回避し、フレアを撒く。脅威が消えて時間が経ったら追尾へ戻る', () => {
    const ai = makeAi();
    const self = makeSelf();
    const out = createCommand();
    const senses = makeSenses(self, vec3(0, 1000, -3000));
    ai.step(senses, DT, out);
    senses.threat = vec3(0, 1000, 1500);
    ai.step(senses, DT, out);
    expect(ai.state).toBe('evade');
    ai.step(senses, DT, out);
    expect(out.flare).toBe(true);
    expect(out.afterburner).toBe(true);
    senses.threat = null;
    const steps = Math.ceil(AI_CONFIG.evade.seconds / DT) + 1;
    for (let i = 0; i < steps; i++) ai.step(senses, DT, out);
    expect(ai.state).toBe('engage');
  });

  it('被弾が続いたら回避（1 発だけなら回避しない）', () => {
    const ai = makeAi();
    const self = makeSelf();
    const out = createCommand();
    const senses = makeSenses(self, vec3(0, 1000, -3000));
    ai.step(senses, DT, out);
    senses.damageTaken = 10;
    ai.step(senses, DT, out);
    senses.damageTaken = 0;
    ai.step(senses, DT, out);
    expect(ai.state).toBe('engage');
    for (let i = 0; i < 3; i++) {
      senses.damageTaken = 10;
      ai.step(senses, DT, out);
    }
    expect(ai.state).toBe('evade');
  });

  it('HP が低いと離脱し、一定時間で立て直して追尾へ戻る（離脱は 1 回の出撃で 1 度だけ）', () => {
    const ai = makeAi();
    const self = makeSelf();
    const out = createCommand();
    const senses = makeSenses(self, vec3(0, 1000, -3000));
    ai.step(senses, DT, out);
    self.hpRatio = AI_CONFIG.disengage.hpRatio - 0.01;
    ai.step(senses, DT, out);
    expect(ai.state).toBe('disengage');
    expect(out.afterburner).toBe(true);
    const steps = Math.ceil(AI_CONFIG.disengage.seconds / DT) + 1;
    for (let i = 0; i < steps; i++) ai.step(senses, DT, out);
    expect(ai.state).toBe('engage');
    ai.step(senses, DT, out);
    expect(ai.state).not.toBe('disengage');
  });

  it('追尾し続けても後方を取れなければ離脱する', () => {
    const ai = makeAi();
    const self = makeSelf();
    const out = createCommand();
    // 相手は正面 4km をこちらへ向かってくる（ずっと後方は取れない。攻撃の窓にも入らない）
    const senses = makeSenses(self, vec3(3000, 1000, -3000), vec3(0, 0, 250));
    const steps = Math.ceil(AI_CONFIG.engage.timeoutSeconds / DT) + 2;
    let disengaged = false;
    for (let i = 0; i < steps && !disengaged; i++) {
      ai.step(senses, DT, out);
      disengaged = ai.state === 'disengage';
    }
    expect(disengaged).toBe(true);
  });

  it('地表から 150m を切ったら、どの状態でも上昇を優先する', () => {
    const ai = makeAi();
    const self = makeSelf(vec3(0, 120, 0), { x: 0, y: -0.3, z: -1 });
    self.agl = 120;
    const out = createCommand();
    // 相手は下（海面すれすれ）にいる
    ai.step(makeSenses(self, vec3(0, 20, -800)), DT, out);
    expect(out.pitch).toBeGreaterThan(0.3);
    expect(out.trigger).toBe(false);
  });
});

describe('難易度', () => {
  it('hard ほど反応が速く、狙いが正確で、ミサイルをよく使い、強く引ける', () => {
    const [rookie, easy, normal, hard] = DIFFICULTIES.map((d) => DIFFICULTY_PRESETS[d]);
    if (!rookie || !easy || !normal || !hard) throw new Error('難易度が足りない');
    expect(hard.reactionSeconds).toBeLessThan(normal.reactionSeconds);
    expect(normal.reactionSeconds).toBeLessThan(easy.reactionSeconds);
    expect(hard.aimErrorDeg).toBeLessThan(normal.aimErrorDeg);
    expect(normal.aimErrorDeg).toBeLessThan(easy.aimErrorDeg);
    expect(hard.missileChance).toBeGreaterThan(normal.missileChance);
    expect(normal.missileChance).toBeGreaterThan(easy.missileChance);
    expect(hard.missileIntervalSeconds).toBeLessThan(easy.missileIntervalSeconds);
    expect(hard.maxG).toBeGreaterThan(normal.maxG);
    expect(normal.maxG).toBeGreaterThan(easy.maxG);
    expect(easy.maxG).toBeGreaterThan(rookie.maxG);
  });

  it('発見から追尾に移るまでの時間は反応時間で決まる（hard は easy より速い）', () => {
    const reactionSteps = (d: DifficultySpec): number => {
      const ai = makeAi(d);
      const self = makeSelf();
      const out = createCommand();
      // 最初の判断は相手なしで済ませ、そのあと相手が現れる
      ai.step(makeSenses(self, null), DT, out);
      const senses = makeSenses(self, vec3(0, 1000, -3000));
      for (let i = 1; i < 600; i++) {
        ai.step(senses, DT, out);
        if (ai.state === 'engage') return i;
      }
      return Infinity;
    };
    const easy = reactionSteps(DIFFICULTY_PRESETS.easy);
    const hard = reactionSteps(DIFFICULTY_PRESETS.hard);
    expect(hard).toBeLessThan(easy);
    expect(easy * DT).toBeCloseTo(DIFFICULTY_PRESETS.easy.reactionSeconds, 1);
  });

  it('最大 G の差がピッチ入力の上限になる', () => {
    const easy = pitchLimitForG(ENEMY_FIGHTER, 250, DIFFICULTY_PRESETS.easy.maxG);
    const hard = pitchLimitForG(ENEMY_FIGHTER, 250, DIFFICULTY_PRESETS.hard.maxG);
    expect(easy).toBeLessThan(hard);
  });
});
