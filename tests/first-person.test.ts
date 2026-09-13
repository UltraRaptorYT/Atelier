import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RapierContext } from '@react-three/rapier';
import { BODY_HEIGHT_FROM_FEET, CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, EYE_HEIGHT, EYE_OFFSET, MAX_TIMESTEP, WALK_SPEED, clearWalkPosition, createWalkController, stepWalk, type WalkDirection } from '../shared/first-person';
import { exampleDesign } from '../shared/example';
import { geometryParts } from '../shared/geometry';

// Test the WASM version used by the renderer, not a different hoisted Rapier.
const RAPIER: RapierContext['rapier'] = createRequire(createRequire(import.meta.url).resolve('@react-three/rapier'))('@dimforge/rapier3d-compat');
const worlds: RapierContext['world'][] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const world of worlds.splice(0)) world.free(); });

function fixture(position = { x: 0, y: BODY_HEIGHT_FROM_FEET, z: 0 }) {
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  worlds.push(world);
  world.timestep = 1 / 60;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS), body);
  const controller = createWalkController(world);
  let velocity = 0;
  const addBox = (x: number, y: number, z: number, width: number, height: number, depth: number, angle = 0, sensor = false) => world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }).setSensor(sensor));
  const step = (direction: WalkDirection = { x: 0, z: 0 }, dt = world.timestep) => {
    const result = stepWalk(controller, body, collider, direction, velocity, dt);
    velocity = result.verticalSpeed;
    world.step();
    return body.translation();
  };
  const run = (frames: number, direction: WalkDirection = { x: 0, z: 0 }) => { let p = body.translation(); for (let i = 0; i < frames; i++) p = step(direction); return p; };
  const clear = (nominal = body.translation()) => clearWalkPosition(world, RAPIER, body, collider, nominal);
  return { world, body, collider, controller, addBox, step, run, clear, velocity: () => velocity };
}

describe('first-person character physics', () => {
  it('settles with a 1.7m eye height and keeps gravity stable while idle', () => {
    const player = fixture({ x: 0, y: 2, z: 0 });
    player.addBox(0, -.1, 0, 20, .2, 20);
    const settled = player.run(180);
    expect(settled.y + EYE_OFFSET).toBeCloseTo(EYE_HEIGHT, 2);
    expect(player.velocity()).toBe(0);
    const later = player.run(300);
    expect(later.y).toBeCloseTo(settled.y, 5);
  });

  it.each([0, Math.PI / 6])('climbs and descends seventeen generated steps through 3m at rotation %s', angle => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotate = (x: number, z: number) => ({ x: x * c + z * s, z: -x * s + z * c });
    const start = rotate(0, -4);
    const player = fixture({ ...start, y: BODY_HEIGHT_FROM_FEET });
    const add = (x: number, y: number, z: number, width: number, height: number, depth: number) => { const p = rotate(x, z); player.addBox(p.x, y, p.z, width, height, depth, angle); };
    add(0, -.1, -4, 5, .2, 3);
    const rise = 3 / 17, tread = 5 / 17;
    for (let i = 0; i < 17; i++) add(0, rise * (i + 1) / 2, -2.5 + tread * (i + .5), 1.2, rise * (i + 1), tread);
    add(0, 2.9, 4, 5, .2, 3);
    player.run(10);
    const uphill = rotate(0, 1);
    const top = player.run(160, uphill);
    expect(top.y + EYE_OFFSET).toBeCloseTo(3 + EYE_HEIGHT, 2);
    expect(top.x * s + top.z * c).toBeGreaterThan(3);
    const bottom = player.run(150, rotate(0, -1));
    player.run(15);
    expect(bottom.y + EYE_OFFSET).toBeCloseTo(EYE_HEIGHT, 2);
    expect(bottom.x * s + bottom.z * c).toBeLessThan(-3);
  });

  it('cannot tunnel through thin walls and slides along them', () => {
    const player = fixture({ x: -2, y: BODY_HEIGHT_FROM_FEET, z: -2 });
    player.addBox(0, -.1, 0, 20, .2, 20);
    player.addBox(0, 1.5, 0, .005, 3, 16);
    player.run(10);
    const p = player.run(120, { x: 1, z: 1 });
    expect(p.x).toBeLessThan(-.24);
    expect(p.x).toBeGreaterThan(-.3);
    expect(p.z).toBeGreaterThan(2);
    expect(p.y + EYE_OFFSET).toBeCloseTo(EYE_HEIGHT, 2);
  });

  it('requires standing headroom and cannot autostep onto taller barriers', () => {
    const player = fixture({ x: -3, y: BODY_HEIGHT_FROM_FEET, z: 0 });
    player.addBox(0, -.1, 0, 20, .2, 20);
    player.addBox(1, 1.8, 0, 2, .2, 4);
    player.run(10);
    const blocked = player.run(120, { x: 1, z: 0 });
    expect(blocked.x).toBeLessThan(0);
    expect(blocked.y + EYE_OFFSET).toBeCloseTo(EYE_HEIGHT, 2);
    const curb = fixture({ x: -2, y: BODY_HEIGHT_FROM_FEET, z: 0 });
    curb.addBox(0, -.1, 0, 20, .2, 20);
    curb.addBox(1, .3, 0, 2, .6, 4);
    curb.run(10);
    expect(curb.run(100, { x: 1, z: 0 }).x).toBeLessThan(0);
  });

  it('ignores sensors and the character’s own attached colliders', () => {
    const player = fixture({ x: -2, y: BODY_HEIGHT_FROM_FEET, z: 0 });
    player.addBox(0, -.1, 0, 20, .2, 20);
    player.addBox(0, 1.5, 0, .2, 3, 8, 0, true);
    player.world.createCollider(RAPIER.ColliderDesc.ball(.1).setTranslation(.1, 0, 0), player.body);
    player.run(10);
    expect(player.run(80, { x: 1, z: 0 }).x).toBeGreaterThan(2);
  });

  it('normalizes diagonal speed, bounds stalled frames, and falls off unsupported floors', () => {
    const player = fixture();
    player.addBox(0, -.1, 0, 3, .2, 3);
    player.run(10);
    const before = player.body.translation();
    const next = player.step({ x: 50, z: 50 }, 10);
    expect(Math.hypot(next.x - before.x, next.z - before.z)).toBeCloseTo(WALK_SPEED * MAX_TIMESTEP, 5);
    const fallen = player.run(90, { x: 1, z: 0 });
    expect(fallen.x).toBeGreaterThan(3);
    expect(fallen.y).toBeLessThan(-2);
    expect(player.velocity()).toBeLessThan(0);
  });
});

describe('first-person spawn and recovery clearance', () => {
  it.each([0, -.35, 3])('resolves a supported body center and 1.7m eyes above floor %sm', floorY => {
    const player = fixture({ x: 0, y: floorY + BODY_HEIGHT_FROM_FEET + .1, z: 0 });
    player.addBox(0, floorY - .1, 0, 12, .2, 12);
    if (floorY > 0) player.addBox(0, -.1, 0, 12, .2, 12);
    player.world.step();
    const point = player.clear();
    expect(point).not.toBeNull();
    expect(point!.y + EYE_OFFSET).toBeCloseTo(floorY + EYE_HEIGHT, 5);
    expect(point!.x).toBe(0); expect(point!.z).toBe(0);
    if (floorY === 0) expect(player.clear({ x: 0, y: BODY_HEIGHT_FROM_FEET - .18, z: 0 })).not.toBeNull();
  });

  it.each([
    { name: 'furniture', x: 0, y: .4, width: 1, height: .8 },
    { name: 'a nearby wall missed by the floor ray', x: .35, y: 1.5, width: .25, height: 3 },
    { name: 'a low ceiling', x: 0, y: 1.85, width: 3, height: .2 },
  ])('rejects standing inside $name', obstruction => {
    const player = fixture();
    player.addBox(0, -.1, 0, 12, .2, 12);
    player.addBox(obstruction.x, obstruction.y, 0, obstruction.width, obstruction.height, 3);
    player.world.step();
    expect(player.clear()).toBeNull();
  });

  it('rejects missing floors, excessive steps or drops, and invalid coordinates', () => {
    const player = fixture();
    player.world.step();
    expect(player.clear()).toBeNull();
    player.addBox(0, -.1, 0, 12, .2, 12);
    player.world.step();
    expect(player.clear({ x: 0, y: BODY_HEIGHT_FROM_FEET + .46, z: 0 })).toBeNull();
    expect(player.clear({ x: 0, y: BODY_HEIGHT_FROM_FEET - .23, z: 0 })).toBeNull();
    for (const x of [NaN, Infinity, 1e100]) expect(player.clear({ x, y: BODY_HEIGHT_FROM_FEET, z: 0 })).toBeNull();
  });

  it('ignores sensor floors, sensor walls, and all of the player’s attached colliders', () => {
    const player = fixture();
    player.addBox(0, -.1, 0, 12, .2, 12);
    player.addBox(0, .4, 0, 3, .2, 3, 0, true);
    player.addBox(.35, 1.5, 0, .25, 3, 3, 0, true);
    player.world.createCollider(RAPIER.ColliderDesc.ball(.1).setTranslation(.1, 0, 0), player.body);
    player.world.step();
    const point = player.clear();
    expect(point).not.toBeNull();
    expect(point!.y + EYE_OFFSET).toBeCloseTo(EYE_HEIGHT, 5);
  });

  it('rejects a steep surface rather than treating a wall-like normal as a floor', () => {
    const player = fixture(), angle = Math.PI * 70 / 180;
    player.world.createCollider(RAPIER.ColliderDesc.cuboid(5, .1, 5).setTranslation(0, -.1, 0).setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }));
    player.world.step();
    expect(player.clear()).toBeNull();
  });

  it('accepts the sample design spawn and rejects its sofa using actual rendered box geometry', () => {
    const design = exampleDesign(), player = fixture({ x: design.spawn[0], y: design.spawn[1] - EYE_OFFSET, z: design.spawn[2] });
    for (const element of design.elements) {
      if (['light', 'window', 'door'].includes(element.kind)) continue;
      const c = Math.cos(element.rotation), s = Math.sin(element.rotation);
      for (const part of geometryParts(element)) player.addBox(element.position[0] + part.position[0] * c + part.position[2] * s, element.position[1] + part.position[1], element.position[2] - part.position[0] * s + part.position[2] * c, ...part.size, element.rotation);
    }
    player.addBox(0, -.4, 0, 80, .1, 80);
    player.world.step();
    expect(player.clear()?.y).toBeCloseTo(BODY_HEIGHT_FROM_FEET, 5);
    expect(player.clear({ x: -3.8, y: BODY_HEIGHT_FROM_FEET, z: 0 })).toBeNull();
    expect(player.clear({ x: 20, y: BODY_HEIGHT_FROM_FEET, z: 20 })?.y).toBeCloseTo(BODY_HEIGHT_FROM_FEET - .35, 5);
  });
});
