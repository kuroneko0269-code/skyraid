// 防衛戦（7-2。協力）の表示（ホスト・クライアント共通）: ホストの判定の結果（state の防衛戦の部分と event）を、自機の
// FlightSession の入れ物（編隊の敵機・爆撃機・巡航ミサイル・基地）に映す。これで描画・HUD・レーダー・索敵はソロと同じものが動く。
// 判定はしない: 爆撃機・巡航ミサイルは出現の event から直進を再現（他機と同じ表示の時刻で）、爆弾・味方の対空砲は見た目だけ。
// 戦闘機は state の位置を時刻で補間する（半分ずつ届くので 2 つ前までを使い、途切れたら 0.5 秒まで外挿）。
// 波・補給・被弾・施設の喪失はソロと同じイベント（bus）にして HUD・音につなぐ。Three.js 非依存
import { EventBus } from '../core/event-bus';
import {
  BOMBER_CONFIG,
  ENEMY_BOMB_BLAST,
  FACILITY_KINDS,
  findDefenseMap,
  type DefenseMapDef,
} from '../data/defense';
import type { EnemyAircraft } from '../entities/enemy-aircraft';
import type { StraightFlyer } from '../entities/straight-flyer';
import { quatIdentity, vec3, type Quat, type Vec3 } from '../flight/math';
import { DefenseBase } from '../missions/defense/base';
import type { DefenseEvents, DefensePhase } from '../missions/defense/runner';
import type { FlightSession } from '../missions/flight-session';
import { DEFENSE_PHASES } from './defense-host';
import {
  DEFENSE_KIND,
  DKILL_ESCAPE,
  DKILL_IMPACT,
  type DefenseStateMsg,
  type EventMsg,
} from './protocol';
import { slerp } from './sync';

const TICK_HZ = 60;
/** 戦闘機を外挿する最大の秒数と、届かなくなったら消すまでの秒数 */
const MAX_EXTRAPOLATE = 0.5;
const STALE_SECONDS = 1.5;

interface FighterSample {
  tick: number;
  readonly position: Vec3;
  readonly orientation: Quat;
}

interface FighterTrack {
  readonly a: FighterSample;
  readonly b: FighterSample;
  count: number;
  firing: boolean;
}

function sample(): FighterSample {
  return { tick: 0, position: vec3(), orientation: quatIdentity() };
}

export class DefenseMirror {
  /** ソロと同じイベント（HUD の大きな文字・音） */
  readonly bus = new EventBus<DefenseEvents>();
  readonly base: DefenseBase;
  readonly map: DefenseMapDef;
  /** 最新の state（まだ届いていなければ null） */
  state: DefenseStateMsg | null = null;
  /** 自分の撃墜数（敵の撃墜の event から） */
  kills = 0;
  private readonly tracks: FighterTrack[];
  private readonly spawnTick = new Map<StraightFlyer, number>();
  private lastPhase: DefensePhase | null = null;
  private lastWave = 0;
  private lastHq = -1;
  private lastBits = -1;
  private readonly prevPos = vec3();
  /** 戦闘機の撃墜・撤退の tick（それより前の state で出し直さない。順不同の経路で遅れて届く） */
  private readonly goneTick: number[];
  /** 敵の通し番号順（DEFENSE_ID_BASE からの添字。ホストと同じ順: 戦闘機・爆撃機・巡航ミサイル） */
  readonly targets: readonly (EnemyAircraft | StraightFlyer)[];

  constructor(
    private readonly session: FlightSession,
    settings: { readonly mapId: string; readonly hard: boolean },
    private readonly localId: number,
  ) {
    this.map = findDefenseMap(settings.mapId);
    const props = session.props;
    this.base = new DefenseBase(props.baseTargets);
    this.base.deploy(this.map, settings.hard ? 'hard' : 'normal');
    this.tracks = session.enemies.map(() => ({
      a: sample(),
      b: sample(),
      count: 0,
      firing: false,
    }));
    this.goneTick = session.enemies.map(() => -1);
    this.targets = [...session.enemies, ...props.bombers, ...props.cruiseMissiles];
    // 見た目だけ: 爆弾は爆発、味方の対空砲は火花（ダメージはホストが決める）
    props.onEnemyBomb = (x, y, z) => {
      session.combat.reportExplosion(x, y, z, true, ENEMY_BOMB_BLAST.radius);
    };
    props.onFriendlyAaaHit = (hit) => {
      session.combat.reportImpact(hit.x, hit.y, hit.z, true);
    };
  }

  /** state の防衛戦の部分（tick はその state の tick） */
  onState(s: Readonly<DefenseStateMsg>, tick: number): void {
    this.state = s;
    for (const e of s.enemies) {
      const t = this.tracks[e.index];
      const enemy = this.session.enemies[e.index];
      if (!t || !enemy) continue;
      if ((t.count > 0 && tick <= t.b.tick) || tick <= (this.goneTick[e.index] ?? -1)) continue;
      // b を a に送り、新しい値を b に
      t.a.tick = t.b.tick;
      copy3(t.a.position, t.b.position);
      copy4(t.a.orientation, t.b.orientation);
      t.b.tick = tick;
      copy3(t.b.position, e.position);
      copy4(t.b.orientation, e.orientation);
      t.count = Math.min(2, t.count + 1);
      t.firing = e.firing;
      if (!enemy.deployed || enemy.isDestroyed) {
        // 新しく出た（または前の撃墜の後に出直した）: その位置に出す
        enemy.spawn({ x: e.position.x, y: e.position.y, z: e.position.z, headingDeg: 0 });
        t.count = 1;
        copy3(t.a.position, e.position);
        copy4(t.a.orientation, e.orientation);
        t.a.tick = tick;
      }
    }
    this.events(s);
  }

  /** 状態の変わり目をソロと同じイベントにする（波の始まり・クリア・終わり・司令部の被弾・施設の喪失） */
  private events(s: Readonly<DefenseStateMsg>): void {
    const phase = DEFENSE_PHASES[s.phase] ?? 'intermission';
    const bus = this.bus;
    if (this.lastPhase !== null) {
      if (phase === 'wave' && this.lastPhase === 'intermission')
        bus.emit('defense:wave', { wave: s.wave });
      if (phase === 'intermission' && s.wave > this.lastWave)
        bus.emit('defense:waveClear', { wave: this.lastWave });
      if ((phase === 'cleared' || phase === 'failed') && phase !== this.lastPhase)
        bus.emit('defense:end', { outcome: phase });
    }
    if (this.lastHq >= 0 && s.hqHp < this.lastHq)
      bus.emit('defense:hqHit', { amount: this.lastHq - s.hqHp });
    if (this.lastBits >= 0) {
      const lost = this.lastBits & ~s.aliveBits;
      FACILITY_KINDS.forEach((_, i) => {
        if (lost & (1 << i)) bus.emit('defense:facilityLost', { index: i });
      });
    }
    // 施設の HP は司令部だけ届く。ほかは壊れたら HP 0
    this.base.sites.forEach((g, i) => {
      if (i === 0) g.mirrorHp(s.hqHp);
      else if ((s.aliveBits & (1 << i)) === 0) g.mirrorHp(0);
    });
    this.lastPhase = phase;
    this.lastWave = s.wave;
    this.lastHq = s.hqHp;
    this.lastBits = s.aliveBits;
  }

  /** event（出現・消滅・補給） */
  handleEvent(e: Readonly<EventMsg>): void {
    const props = this.session.props;
    const combat = this.session.combat;
    if (e.kind === 'dspawn') {
      if (e.a === DEFENSE_KIND.bomber) {
        const b = props.bombers[e.b];
        const site = this.base.sites[e.n];
        if (!b || !site) return;
        const t = site.base;
        b.attack({ x: e.x, y: e.y, z: e.z }, t, e.n, BOMBER_CONFIG.despawnDistance, 0);
        this.spawnTick.set(b, e.tick);
        this.bus.emit('defense:spawn', { kind: 'bomber', index: e.b });
      } else if (e.a === DEFENSE_KIND.cruise) {
        const m = props.cruiseMissiles[e.b];
        const hq = this.base.hq;
        if (!m) return;
        m.aim({ x: e.x, y: e.y, z: e.z }, hq.position, hq.hitRadius, 0);
        this.spawnTick.set(m, e.tick);
        this.bus.emit('defense:spawn', { kind: 'cruise', index: e.b });
      }
      return;
    }
    if (e.kind === 'dsupply') {
      const fraction = e.n / 100;
      if (e.a === this.localId) combat.resupplyPart(fraction);
      this.bus.emit('defense:supply', { id: e.a, fraction });
      return;
    }
    if (e.kind !== 'dkill') return;
    const target =
      e.b === DEFENSE_KIND.fighter
        ? this.session.enemies[e.n]
        : e.b === DEFENSE_KIND.bomber
          ? props.bombers[e.n]
          : props.cruiseMissiles[e.n];
    if (!target) return;
    if (e.b === DEFENSE_KIND.fighter) this.goneTick[e.n] = e.tick;
    if (e.a === DKILL_ESCAPE) {
      target.withdraw();
      return;
    }
    if (e.a === DKILL_IMPACT) {
      target.withdraw();
      combat.reportExplosion(e.x, e.y, e.z, true, ENEMY_BOMB_BLAST.radius);
      this.bus.emit('defense:cruiseImpact', { index: e.n });
      return;
    }
    if (target.active) {
      target.applyDamage(target.hp);
      combat.notifyDestroyed(target);
    }
    if (e.a === this.localId) {
      this.kills++;
      combat.kills++;
    }
  }

  /** 固定ステップ 1 回分: 敵を表示の時刻（viewTick）に置き、見た目の爆弾・味方の対空砲・機銃を進める */
  step(dt: number, viewTick: number): void {
    const s = this.session;
    const props = s.props;
    // 爆撃機・巡航ミサイル: 出現からの時間 × 速さ
    for (const list of [
      props.bombers,
      props.cruiseMissiles,
    ] as readonly (readonly StraightFlyer[])[])
      for (const f of list) {
        if (!f.deployed) continue;
        if (f.flashTimer > 0) f.flashTimer = Math.max(0, f.flashTimer - dt);
        if (!f.active) {
          f.withdraw();
          continue;
        }
        const t0 = this.spawnTick.get(f) ?? viewTick;
        f.setTraveled(((viewTick - t0) / TICK_HZ) * f.spec.speed);
      }
    for (const b of props.bombers)
      for (let n = b.takeDrops(); n > 0; n--) props.enemyBombs.drop(b.position, b.velocity);
    props.enemyBombs.step(dt);
    for (const g of props.baseTargets) g.step(dt);
    props.friendlyAaa.stepFriendly(props.baseTargets, this.targets, dt);
    // 戦闘機
    s.enemies.forEach((e, i) => {
      const t = this.tracks[i];
      if (!t || !e.deployed) return;
      if (e.flashTimer > 0) e.flashTimer = Math.max(0, e.flashTimer - dt);
      if (e.isDestroyed) {
        e.withdraw();
        t.count = 0;
        return;
      }
      if (t.count === 0) return;
      if ((viewTick - t.b.tick) / TICK_HZ > STALE_SECONDS) {
        // 撃墜・撤退の event を取りこぼしたときのため、届かなくなったら消す
        e.withdraw();
        t.count = 0;
        return;
      }
      this.placeFighter(e, t, viewTick, dt);
      s.squadron.stepMirrorGun(i, t.firing, dt);
    });
  }

  private placeFighter(e: EnemyAircraft, t: FighterTrack, viewTick: number, dt: number): void {
    const st = e.aircraft.state;
    const prev = e.aircraft.prevPosition;
    copy3(this.prevPos, st.position);
    copy3(prev, st.position);
    const a = t.a;
    const b = t.b;
    const span = b.tick - a.tick;
    if (t.count < 2 || span <= 0) {
      copy3(st.position, b.position);
      copy4(st.orientation, b.orientation);
    } else {
      const k = Math.min(1 + (MAX_EXTRAPOLATE * TICK_HZ) / span, (viewTick - a.tick) / span);
      const u = Math.max(0, k);
      st.position.x = a.position.x + (b.position.x - a.position.x) * u;
      st.position.y = a.position.y + (b.position.y - a.position.y) * u;
      st.position.z = a.position.z + (b.position.z - a.position.z) * u;
      slerp(st.orientation, a.orientation, b.orientation, Math.min(1, u));
    }
    if (dt > 0) {
      e.velocity.x = (st.position.x - this.prevPos.x) / dt;
      e.velocity.y = (st.position.y - this.prevPos.y) / dt;
      e.velocity.z = (st.position.z - this.prevPos.z) / dt;
    }
  }

  /** 終わり: 入れ物を片付ける */
  dispose(): void {
    this.session.props.reset();
    for (const e of this.session.enemies) e.withdraw();
  }
}

function copy3(out: Vec3, v: Readonly<Vec3>): void {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
}

function copy4(out: Quat, q: Readonly<Quat>): void {
  out.x = q.x;
  out.y = q.y;
  out.z = q.z;
  out.w = q.w;
}
