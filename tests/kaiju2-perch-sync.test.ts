// 9-6d: 協力の写しでも止まり木の降り方（旋回しながら降りる・寄せて着地・翼をたたむ・羽ばたいて上がる）がホストと同じに見える
import { describe, expect, it } from 'vitest';
import { PvpArena } from '../src/combat/pvp-arena';
import { RAID_CONFIG } from '../src/data/kaiju';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { Aircraft } from '../src/entities/aircraft';
import { fighterSpec } from '../src/net/host-state';
import { Kaiju2Host } from '../src/net/kaiju2-host';
import { Kaiju2Mirror } from '../src/net/kaiju2-mirror';
import { netLoadout } from '../src/net/loadout';
import { decodeMessage, encodeMessage, type StateMsg } from '../src/net/protocol';
import { createHeightField } from '../src/render/terrain-height';
import { DT } from './pvp-match';

const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

describe('止まり木の同期（9-6d）', () => {
  it('15Hz の state を受けた写しの翼・脚・位置がホストと合う（降りる途中に翼をたたまない）', () => {
    const arena = new PvpArena(
      () => undefined,
      null,
      () => 0.5,
    );
    arena.add(
      0,
      new Aircraft(netLoadout('kestrel', undefined).flight),
      fighterSpec(netLoadout('kestrel', undefined)),
    );
    const h = new Kaiju2Host(arena, 1, {
      ground,
      difficulty: 'normal',
      center: { x: 0, z: 0 },
      start: RAID_CONFIG.start,
      seed: 7,
    });
    const m = new Kaiju2Mirror(ground);
    const k = h.raid.body;
    k.stamina = 0.01;
    k.attackCooldown = 999;
    let worstFold = 0;
    let worstPos = 0;
    let seenPerched = false;
    let mirrorFoldedInAir = false;
    for (let tick = 0; tick < 90 * 60; tick++) {
      h.step(DT);
      if (tick % 4 === 0) {
        const msg: StateMsg = {
          type: 'state',
          tick,
          aircraft: [],
          missiles: [],
          kaiju: null,
          defense: null,
          kaiju2: h.state(),
        };
        const back = decodeMessage(encodeMessage(msg));
        if (back?.type !== 'state' || !back.kaiju2) throw new Error('decode');
        m.receive(back.kaiju2);
      }
      m.step(DT);
      const mk = m.raid.body;
      if (tick > 60 && (k.state === 'landing' || k.state === 'perched' || k.state === 'takeoff')) {
        worstFold = Math.max(worstFold, Math.abs(mk.pose.wingFold - k.pose.wingFold));
        worstPos = Math.max(
          worstPos,
          Math.hypot(
            mk.position.x - k.position.x,
            mk.position.y - k.position.y,
            mk.position.z - k.position.z,
          ),
        );
        if (mk.state === 'landing' && mk.pose.wingFold > 0.5) mirrorFoldedInAir = true;
      }
      if (k.state === 'perched') seenPerched = true;
      if (seenPerched && k.state === 'cruise') break;
    }
    expect(seenPerched).toBe(true);
    expect(mirrorFoldedInAir).toBe(false);
    expect(worstFold).toBeLessThan(0.25);
    expect(worstPos).toBeLessThan(40);
  });
});
