import type { RapierCollider, RapierContext, RapierRigidBody } from '@react-three/rapier';

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
export type WalkStep = { verticalSpeed: number; position: { x: number; y: number; z: number } };

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
