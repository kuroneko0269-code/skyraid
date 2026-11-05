// 9-6c: 協力レイドのクライアントのネフィルガ（写し）。ホストの state のネフィルガの状態を Kaiju2Raid（mirror: ダメージを受けない）に
// 写し、描画・HUD・音（ソロと同じ Kaiju2Object・Kaiju2Hud・Kaiju2SoundWatch）と、ロックの対象（部位）にする。
// 位置・向き・傾きは「届いた値 + 届いてからの秒数 × 速さ」へ毎ステップ寄せ、状態の経過は届くまで進める。
// 見た目の姿勢（羽ばたき・翼をたたむ・掲げる・喉の光・尾）は状態から同じ計算（updateKaiju2Pose）で作る。
// 雷球は届いた位置と速度から進める（当たりはホストが決める）。Three.js 非依存
import { KAIJU2_ATTACKS, KAIJU2_CONFIG, KAIJU2_PARTS, KAIJU2_STATES } from '../data/kaiju2';
import { KAIJU2_RAID_CONFIG as R } from '../data/kaiju2-raid';
import { updateKaiju2Pose } from '../entities/kaiju2/kaiju2-pose';
import { approachFactor, vec3 } from '../flight/math';
import { Kaiju2Raid } from '../missions/kaiju2-raid';
import type { Kaiju2StateMsg } from './codec-kaiju2';
import { NO_ATTACK } from './protocol';

/** 位置を寄せる速さ（1/秒） */
const FOLLOW = 8;

export class Kaiju2Mirror {
  readonly raid: Kaiju2Raid;
  /** 狙われている人（予兆・攻撃の間だけ。なしは null） */
  targetId: number | null = null;
  private received = false;
  private sinceReceive = 0;
  private readonly at = vec3();
  private readonly dir = vec3(0, 0, -1);
  private bankGoal = 0;
  private speed = 0;
  private lastHp = -1;

  constructor(ground: (x: number, z: number) => number = () => 0) {
    this.raid = new Kaiju2Raid(ground, { hit: () => undefined }, true);
    this.raid.body.visible = false;
  }

  /** 届いた状態を写す（新しい state が来たときだけ） */
  receive(m: Readonly<Kaiju2StateMsg>): void {
    const r = this.raid;
    const k = r.body;
    if (!this.received) {
      r.reset(true, m.hard ? 'hard' : 'normal');
      k.position.x = k.prevPosition.x = m.position.x;
      k.position.y = k.prevPosition.y = m.position.y;
      k.position.z = k.prevPosition.z = m.position.z;
      k.forward.x = k.prevForward.x = m.forward.x;
      k.forward.y = k.prevForward.y = m.forward.y;
      k.forward.z = k.prevForward.z = m.forward.z;
      k.bank = k.prevBank = m.bank;
      this.received = true;
    }
    this.sinceReceive = 0;
    this.at.x = m.position.x;
    this.at.y = m.position.y;
    this.at.z = m.position.z;
    this.dir.x = m.forward.x;
    this.dir.y = m.forward.y;
    this.dir.z = m.forward.z;
    this.bankGoal = m.bank;
    this.speed = m.speed;
    k.visible = m.visible;
    const state = KAIJU2_STATES[m.state] ?? 'cruise';
    const attack = m.attack === NO_ATTACK ? null : (KAIJU2_ATTACKS[m.attack] ?? null);
    k.state = state;
    k.attack = attack;
    k.stateTime = m.stateTime;
    k.speed = m.speed;
    if (this.lastHp >= 0 && m.hp < this.lastHp) r.flash = R.flashSeconds;
    this.lastHp = m.hp;
    r.maxHp = Math.max(1, m.maxHp);
    r.hp = m.hp;
    k.setHpRatio(r.hp / r.maxHp);
    k.phase = Math.max(1, Math.min(3, m.phase));
    if (m.dead && !r.dead) {
      r.dead = true;
      for (const o of k.orbs) o.active = false;
    }
    // 壊れた部位（新しく壊れたら数と最後の部位を進める: HUD・音の合図）
    KAIJU2_PARTS.forEach((p, i) => {
      const broken = (m.broken & (1 << i)) !== 0;
      if (broken && !k.broken[p]) {
        k.broken[p] = true;
        r.brokenCount++;
        r.lastBroken = p;
        if (k.broken.wingL && k.broken.wingR && (p === 'wingL' || p === 'wingR'))
          r.lastBroken = 'both';
      }
    });
    for (const t of r.targets) {
      const i = (KAIJU2_PARTS as readonly string[]).indexOf(t.id);
      const share = R.targets[t.id].hpShare;
      if (i < 0 || share <= 0) continue;
      t.partMaxHp = Math.max(1, Math.round(r.maxHp * share));
      t.partHp = (m.parts[i] ?? 0) * t.partMaxHp;
    }
    r.elapsed = m.elapsed;
    r.stormAt = m.stormAt ?? -1;
    r.timeUp = m.timeUp === 1 ? 'storm' : m.timeUp === 2 ? 'total' : null;
    r.stormReached = r.timeUp !== null;
    r.shout = m.shout;
    k.flinch = m.flinch;
    this.targetId = m.targetId >= 4 ? null : m.targetId;
    // 雷球: 届いたものだけ出す（位置と速度を写す）
    const seen = new Set<number>();
    for (const o of m.orbs) {
      const orb = k.orbs[o.index];
      if (!orb) continue;
      seen.add(o.index);
      if (!orb.active) {
        orb.prevPosition.x = o.position.x;
        orb.prevPosition.y = o.position.y;
        orb.prevPosition.z = o.position.z;
      }
      orb.active = true;
      orb.position.x = o.position.x;
      orb.position.y = o.position.y;
      orb.position.z = o.position.z;
      orb.velocity.x = o.velocity.x;
      orb.velocity.y = o.velocity.y;
      orb.velocity.z = o.velocity.z;
    }
    k.orbs.forEach((orb, i) => {
      if (!seen.has(i)) orb.active = false;
    });
  }

  /** 固定ステップ 1 回分: 位置・向きを寄せ、経過を進め、姿勢と部位の位置を出す */
  step(dt: number): void {
    const r = this.raid;
    const k = r.body;
    k.beginStep();
    for (const t of r.targets) t.beginStep();
    if (!this.received) return;
    this.sinceReceive += dt;
    r.flash = Math.max(0, r.flash - dt);
    r.shout = Math.max(0, r.shout - dt);
    k.flinch = Math.max(0, k.flinch - dt);
    if (!r.dead && r.timeUp === null) r.elapsed += dt;
    k.stateTime += dt;
    k.time += dt;
    const a = approachFactor(FOLLOW, dt);
    // 届いた位置から速さで進めた所へ寄せる（0.5 秒より先は外挿しない）
    const lead = Math.min(0.5, this.sinceReceive) * this.speed;
    const p = k.position;
    p.x += (this.at.x + this.dir.x * lead - p.x) * a;
    p.y += (this.at.y + this.dir.y * lead - p.y) * a;
    p.z += (this.at.z + this.dir.z * lead - p.z) * a;
    const f = k.forward;
    f.x += (this.dir.x - f.x) * a;
    f.y += (this.dir.y - f.y) * a;
    f.z += (this.dir.z - f.z) * a;
    const l = Math.hypot(f.x, f.y, f.z) || 1;
    f.x /= l;
    f.y /= l;
    f.z /= l;
    k.bank += (this.bankGoal - k.bank) * a;
    for (const o of k.orbs) {
      if (!o.active) continue;
      o.position.x += o.velocity.x * dt;
      o.position.y += o.velocity.y * dt;
      o.position.z += o.velocity.z * dt;
    }
    // 止まり木の高さ（降りる途中に脚を出す見た目）は足元の床から
    k.perch.y = k.floorAt(p.x, p.z) + KAIJU2_CONFIG.perch.standHeight;
    updateKaiju2Pose(k, dt);
    if (r.dead) {
      // 倒した後はたたんで落ちる見た目（位置はホストから）
      k.pose.wingFold += (1 - k.pose.wingFold) * Math.min(1, dt * 2);
      k.pose.flapAmount = 0;
      k.pose.throatGlow = 0;
    }
    const s = k.state === 'perched' ? 0 : this.speed;
    r.velocity.x = f.x * s;
    r.velocity.y = f.y * s;
    r.velocity.z = f.z * s;
    for (const t of r.targets) t.place(k);
  }
}
