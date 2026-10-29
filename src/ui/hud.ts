import './hud.css';
import { HUD_CONFIG } from '../data/hud';
import { applyCssVariables, el, gauge } from './hud-dom';
import type { HudFrame } from './hud-frame';
import { HudRadar } from './hud-radar';
import { HudWeapons } from './hud-weapons';
import {
  attitudeFromQuat,
  changed,
  formatAltitude,
  formatSpeed,
  isGroundWarning,
  isStallWarning,
  ladderRungs,
  ladderTransform,
  type Attitude,
  type LadderTransform,
} from './hud-math';

export type { HudFrame } from './hud-frame';

/**
 * 戦闘機風の HUD（DOM + CSS）。update() は毎フレーム呼んでよいが、
 * DOM は表示が変わったときだけ書き換える（テキストは文字列、位置・角度は epsilon 以上の変化）
 */
export class Hud {
  readonly root: HTMLDivElement;
  private shown = true;
  private compact = false;
  private readonly ladder: HTMLDivElement;
  private readonly fpm: HTMLDivElement;
  private readonly speedText: HTMLSpanElement;
  private readonly altText: HTMLSpanElement;
  private readonly throttleFill: HTMLDivElement;
  private readonly abFill: HTMLDivElement;
  private readonly heatFill: HTMLDivElement;
  private readonly killsText: HTMLSpanElement;
  private readonly hpFill: HTMLDivElement;
  private readonly radar: HudRadar;
  private readonly weapons: HudWeapons;

  private readonly attitude: Attitude = { pitch: 0, roll: 0, heading: 0 };
  private readonly ladderXf: LadderTransform = { rotateDeg: 0, offsetPx: 0 };
  // 前回書いた値。NaN / '' は「未表示」で、次の update() で必ず書く
  private last = {
    speed: '',
    alt: '',
    throttle: NaN,
    ab: NaN,
    abState: '',
    ground: false,
    stall: false,
    pitch: NaN,
    roll: NaN,
    fpmX: NaN,
    fpmY: NaN,
    fpmShown: true,
    heat: NaN,
    hp: NaN,
    lowHp: false,
    missile: false,
    overheat: false,
    hit: false,
    kills: '',
  };

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';
    applyCssVariables(root);
    this.root = root;

    // 中央: ピッチラダー（楕円の窓で切り抜き、中身を回す）と進行方向マーカー
    const window_ = el('div', 'hud-ladder-window', root);
    this.ladder = el('div', 'hud-ladder', window_);
    for (const deg of ladderRungs(HUD_CONFIG.ladder.stepDeg)) {
      const kind = deg === 0 ? 'is-horizon' : deg > 0 ? 'is-up' : 'is-down';
      const rung = el('div', `hud-rung ${kind}`, this.ladder);
      rung.style.setProperty('--deg', String(deg));
      const label = deg === 0 ? '' : String(Math.abs(deg));
      el('span', 'hud-rung-label', rung, label);
      el('span', 'hud-rung-line hud-rung-left', rung);
      el('span', 'hud-rung-gap', rung);
      el('span', 'hud-rung-line hud-rung-right', rung);
      el('span', 'hud-rung-label', rung, label);
    }
    this.fpm = el('div', 'hud-fpm', root);
    el('div', 'hud-hitmarker', root);
    el('div', 'hud-warn hud-stall', root, 'STALL');
    el('div', 'hud-warn hud-missile', root, 'MISSILE');

    // 左: スロットル・AB ゲージと速度
    const left = el('div', 'hud-side hud-left', root);
    const gauges = el('div', 'hud-gauges', left);
    // HP（2-3。残りが少ないと赤く点滅）
    this.hpFill = gauge(gauges, 'HP', 'hud-hp');
    this.throttleFill = gauge(gauges, 'THR');
    this.abFill = gauge(gauges, 'AB');
    // 機銃の熱ゲージ（オーバーヒートで赤く点滅）
    this.heatFill = gauge(gauges, 'GUN', 'hud-heat');
    // 索敵マーカー（中央のレイヤー）と残弾（ゲージ列の右）
    this.weapons = new HudWeapons(root, gauges);
    const speedBox = el('div', 'hud-box', left);
    el('div', 'hud-box-label', speedBox, 'SPD');
    this.speedText = el('span', 'hud-box-value', speedBox);
    el('div', 'hud-box-unit', speedBox, 'm/s');

    // 右: 高度（海面基準）と地面接近警告
    const right = el('div', 'hud-side hud-right', root);
    const altBox = el('div', 'hud-box', right);
    el('div', 'hud-box-label', altBox, 'ALT');
    this.altText = el('span', 'hud-box-value', altBox);
    el('div', 'hud-box-unit', altBox, 'm');
    el('div', 'hud-warn hud-ground', right, 'PULL UP');
    const kills = el('div', 'hud-kills', right);
    el('span', 'hud-kills-label', kills, 'KILL');
    this.killsText = el('span', 'hud-kills-value', kills);

    // 下: レーダー（機首方向が上）。島の中心・敵機・自機を追うミサイル
    this.radar = new HudRadar(root);

    parent.appendChild(root);

    const l = HUD_CONFIG;
    const query =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(
            `(max-width: ${l.compactMaxWidth}px), (max-height: ${l.compactMaxHeight}px)`,
          )
        : null;
    const refreshCompact = (): void => {
      this.compact = query?.matches ?? false;
      root.classList.toggle('hud-compact', this.compact);
      // 1 度あたりの px が変わるので、ラダーを書き直す
      this.last.pitch = NaN;
    };
    refreshCompact();
    query?.addEventListener('change', refreshCompact);
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.root.hidden = !visible;
    // 隠している間は書き換えないので、再表示したら全部書き直す
    if (visible) this.invalidate();
  }

  toggle(): void {
    this.setVisible(!this.shown);
  }

  update(f: Readonly<HudFrame>): void {
    if (!this.shown) return;
    const last = this.last;
    const eps = HUD_CONFIG.epsilon;

    const speed = formatSpeed(f.speed);
    if (speed !== last.speed) this.speedText.textContent = last.speed = speed;
    const alt = formatAltitude(f.y);
    if (alt !== last.alt) this.altText.textContent = last.alt = alt;

    if (changed(last.throttle, f.throttle, eps.gauge)) {
      last.throttle = f.throttle;
      this.throttleFill.style.transform = `scaleY(${f.throttle.toFixed(3)})`;
    }
    if (changed(last.ab, f.afterburnerGauge, eps.gauge)) {
      last.ab = f.afterburnerGauge;
      this.abFill.style.transform = `scaleY(${f.afterburnerGauge.toFixed(3)})`;
    }
    const abState = f.afterburnerLocked ? 'is-locked' : f.afterburnerActive ? 'is-active' : '';
    if (abState !== last.abState) {
      this.abFill.classList.remove('is-locked', 'is-active');
      if (abState) this.abFill.classList.add(abState);
      last.abState = abState;
    }

    this.updateCombat(f);

    const ground = isGroundWarning(f.altitudeAboveGround, HUD_CONFIG.groundWarningAgl);
    if (ground !== last.ground) {
      last.ground = ground;
      this.root.classList.toggle('is-ground-warning', ground);
    }
    const stall = isStallWarning(f.stall, HUD_CONFIG.stallThreshold);
    if (stall !== last.stall) {
      last.stall = stall;
      this.root.classList.toggle('is-stall', stall);
    }

    const att = attitudeFromQuat(this.attitude, f.orientation);
    if (
      changed(last.pitch, att.pitch, eps.angleDeg) ||
      changed(last.roll, att.roll, eps.angleDeg)
    ) {
      last.pitch = att.pitch;
      last.roll = att.roll;
      const ppd = this.compact ? HUD_CONFIG.ladder.compactPxPerDeg : HUD_CONFIG.ladder.pxPerDeg;
      const xf = ladderTransform(this.ladderXf, att.pitch, att.roll, ppd);
      this.ladder.style.transform = `rotate(${xf.rotateDeg.toFixed(2)}deg) translateY(${xf.offsetPx.toFixed(1)}px)`;
    }

    this.updateFlightPath(f.flightPath);
    this.radar.update(f.x, f.z, att.heading, f.radar);
  }

  private updateCombat(f: Readonly<HudFrame>): void {
    const last = this.last;
    if (changed(last.heat, f.gunHeat, HUD_CONFIG.epsilon.gauge)) {
      last.heat = f.gunHeat;
      this.heatFill.style.transform = `scaleY(${f.gunHeat.toFixed(3)})`;
    }
    if (f.gunOverheated !== last.overheat) {
      last.overheat = f.gunOverheated;
      this.root.classList.toggle('is-overheat', f.gunOverheated);
    }
    if (f.hitMarker !== last.hit) {
      last.hit = f.hitMarker;
      this.root.classList.toggle('is-hit', f.hitMarker);
    }
    const kills = String(f.kills);
    if (kills !== last.kills) this.killsText.textContent = last.kills = kills;
    const hp = f.maxHp > 0 ? f.hp / f.maxHp : 0;
    if (changed(last.hp, hp, HUD_CONFIG.epsilon.gauge)) {
      last.hp = hp;
      this.hpFill.style.transform = `scaleY(${hp.toFixed(3)})`;
    }
    const lowHp = hp < HUD_CONFIG.damage.lowHpRatio;
    if (lowHp !== last.lowHp) {
      last.lowHp = lowHp;
      this.root.classList.toggle('is-low-hp', lowHp);
    }
    if (f.missileWarning !== last.missile) {
      last.missile = f.missileWarning;
      this.root.classList.toggle('is-missile', f.missileWarning);
    }
    this.weapons.update(f.weapons);
  }

  private updateFlightPath(pos: { x: number; y: number } | null): void {
    const last = this.last;
    const shown = pos !== null;
    if (shown !== last.fpmShown) {
      last.fpmShown = shown;
      this.fpm.hidden = !shown;
    }
    if (!pos) return;
    const eps = HUD_CONFIG.epsilon.px;
    if (changed(last.fpmX, pos.x, eps) || changed(last.fpmY, pos.y, eps)) {
      last.fpmX = pos.x;
      last.fpmY = pos.y;
      this.fpm.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
    }
  }

  private invalidate(): void {
    const last = this.last;
    last.speed = last.alt = last.kills = '';
    last.throttle = last.ab = last.heat = last.hp = last.pitch = last.roll = NaN;
    last.fpmX = last.fpmY = NaN;
    this.radar.invalidate();
    this.weapons.invalidate();
  }
}
