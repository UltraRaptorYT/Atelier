import type { RapierCollider, RapierContext, RapierRigidBody } from '@react-three/rapier';
import type { Design } from './design';

export const CAPSULE_HALF_HEIGHT = .66;
export const CAPSULE_RADIUS = .24;
export const COLLISION_SKIN = .01;
export const BODY_HEIGHT_FROM_FEET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + COLLISION_SKIN;
export const EYE_HEIGHT = 1.7;
export const EYE_OFFSET = EYE_HEIGHT - BODY_HEIGHT_FROM_FEET;
export const WALK_SPEED = 3.5;
export const GRAVITY = -20;
export const MAX_TIMESTEP = .05;
export const MAX_STEP_HEIGHT = .22;
export const SNAP_TO_GROUND = .25;
const TERMINAL_SPEED = 50;
// QueryFilterFlags.EXCLUDE_SENSORS. Keep Rapier runtime values supplied by the
// renderer: importing a value here could load a different hoisted WASM version.
const EXCLUDE_SENSORS = 8;

export type WalkController = ReturnType<RapierContext['world']['createCharacterController']>;
export type WalkDirection = { x: number; z: number };
export type WalkPosition = { x: number; y: number; z: number };
export type WalkStep = { verticalSpeed: number; position: WalkPosition };

/** Face the building on entry, at eye level; office navigation keeps its existing bearing. */
export function initialWalkLookTarget(spawn: [number, number, number], design?: Pick<Design, 'elements'> | null): [number, number, number] {
  const fallback: [number, number, number] = [spawn[0], spawn[1], spawn[2] - 5];
  if (!design?.elements.length) return fallback;
  const shell = design.elements.filter(element => ['wall', 'roof', 'door', 'window', 'stair'].includes(element.kind));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const element of shell.length ? shell : design.elements) {
    const cosine = Math.abs(Math.cos(element.rotation)), sine = Math.abs(Math.sin(element.rotation));
    const halfX = (element.size[0] * cosine + element.size[2] * sine) / 2;
    const halfZ = (element.size[0] * sine + element.size[2] * cosine) / 2;
    minX = Math.min(minX, element.position[0] - halfX); maxX = Math.max(maxX, element.position[0] + halfX);
    minZ = Math.min(minZ, element.position[2] - halfZ); maxZ = Math.max(maxZ, element.position[2] + halfZ);
  }
  const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
  return Math.hypot(x - spawn[0], z - spawn[2]) < .01 ? fallback : [x, spawn[1], z];
}

/** Check a nominal body center against current floor support and full standing clearance. */
export function clearWalkPosition(world: RapierContext['world'], rapier: Pick<RapierContext['rapier'], 'Ray'>, body: RapierRigidBody, collider: RapierCollider, nominal: WalkPosition): WalkPosition | null {
  if (![nominal.x, nominal.y, nominal.z].every(n => Number.isFinite(n) && Math.abs(n) <= 10000)) return null;
  const origin = { ...nominal, y: nominal.y + .25 };
  const floor = world.castRayAndGetNormal(new rapier.Ray(origin, { x: 0, y: -1, z: 0 }), BODY_HEIGHT_FROM_FEET + .7, true, EXCLUDE_SENSORS, undefined, collider, body);
  if (!floor || floor.normal.y < .5) return null;
  const floorY = origin.y - floor.timeOfImpact, nominalFeet = nominal.y - BODY_HEIGHT_FROM_FEET;
  if (floorY > nominalFeet + MAX_STEP_HEIGHT || floorY < nominalFeet - .45) return null;
  const position = { x: nominal.x, y: floorY + BODY_HEIGHT_FROM_FEET, z: nominal.z };
  // Query arguments exclude the entire player body as well as sensors; no
  // filter callbacks need to reenter WASM while its collider set is borrowed.
  const obstruction = world.intersectionWithShape(position, body.rotation(), collider.shape, EXCLUDE_SENSORS, undefined, collider, body);
  return obstruction ? null : position;
}

/** The caller owns disposal with world.removeCharacterController(controller). */
export function createWalkController(world: RapierContext['world']): WalkController {
  const controller = world.createCharacterController(COLLISION_SKIN);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setSlideEnabled(true);
  controller.enableAutostep(MAX_STEP_HEIGHT, .12, false);
  controller.enableSnapToGround(SNAP_TO_GROUND);
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 4);
  controller.setApplyImpulsesToDynamicBodies(false);
  return controller;
}

/** Advance once before the physics step; the body's collider supplies all clearance checks. */
export function stepWalk(controller: WalkController, body: RapierRigidBody, collider: RapierCollider, direction: WalkDirection, verticalSpeed: number, dt: number): WalkStep {
  const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, MAX_TIMESTEP)) : 0;
  const x = Number.isFinite(direction.x) ? direction.x : 0, z = Number.isFinite(direction.z) ? direction.z : 0;
  const magnitude = Math.hypot(x, z), scale = WALK_SPEED * elapsed / Math.max(1, magnitude);
  const falling = Number.isFinite(verticalSpeed) ? Math.max(-TERMINAL_SPEED, Math.min(0, verticalSpeed)) : 0;
  const nextVerticalSpeed = Math.max(-TERMINAL_SPEED, falling + GRAVITY * elapsed);
  const ownColliders = new Set([collider.handle]);
  for (let i = 0; i < body.numColliders(); i++) ownColliders.add(body.collider(i).handle);
  // Do not call WASM getters inside the filter: the physics sets are borrowed
  // during this callback. Handle comparison needs no reentrant WASM access.
  controller.computeColliderMovement(collider, { x: x * scale, y: nextVerticalSpeed * elapsed, z: z * scale }, EXCLUDE_SENSORS, undefined,
    obstacle => !ownColliders.has(obstacle.handle));
  const movement = controller.computedMovement(), current = body.translation();
  const position = { x: current.x + movement.x, y: current.y + movement.y, z: current.z + movement.z };
  body.setNextKinematicTranslation(position);
  return { verticalSpeed: controller.computedGrounded() ? 0 : nextVerticalSpeed, position };
}
