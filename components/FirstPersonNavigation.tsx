'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CapsuleCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierCollider, type RapierRigidBody } from '@react-three/rapier';
import { Euler, Vector3 } from 'three';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, EYE_OFFSET, clearWalkPosition, createWalkController, initialWalkLookTarget, stepWalk, type WalkController } from '@/shared/first-person';
import type { Design } from '@/shared/design';
import type { RoomId } from './World';
import styles from './FirstPersonNavigation.module.css';
import { presentationInRange } from '@/lib/presentation';

type Point = { x: number; y: number; z: number };
type Room = { id: RoomId; label: string; position: [number, number, number]; camera: [number, number, number] };
type Props = {
  target: [number, number, number];
  design?: Design | null;
  rooms: Room[];
  office: boolean;
  revision: string;
  paused: boolean;
  positions: React.RefObject<Partial<Record<RoomId, [number, number, number]>>>;
  meeting: boolean;
  onProximity: (id: RoomId | null) => void;
  onRoom: (id: RoomId) => void;
  onExit: () => void;
  presentationAvailable?: boolean;
};

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const INTERACTION_DISTANCE = 2.8;
const STARTUP_GRACE_SECONDS = 3;
const RECOVERY_RETRY_SECONDS = .25;

function editing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [role="textbox"]')));
}

export default function FirstPersonNavigation({ target, design, rooms, office, revision, paused, onRoom, onExit, positions, meeting, onProximity, presentationAvailable = false }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const controller = useRef<WalkController | null>(null);
  const keys = useRef(new Set<string>());
  const verticalSpeed = useRef(0);
  const needsTeleport = useRef(true);
  const recovery = useRef({ elapsed: 0, retryIn: 0 });
  const blocked = useRef(true);
  const voiceRoom = useRef<RoomId | null>(null);
  const nearbyRoom = useRef<Room | null>(null);
  const [roomLabel, setRoomLabel] = useState<string | null>(null);
  const [walkStatus, setWalkStatus] = useState<'loading' | 'ready' | 'blocked'>('loading');
  const { camera, gl } = useThree();
  const { world, rapier } = useRapier();
  const spawn: Point = { x: target[0], y: target[1] - EYE_OFFSET, z: target[2] };
  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const direction = useRef(new Vector3());
  // Read the latest bounds only when entering/teleporting, so design updates do not turn the user's camera.
  const facingDesign = useRef(design);
  facingDesign.current = design;

  function teleport(position: Point) {
    if (!body.current) return;
    body.current.setTranslation(position, true);
    body.current.setNextKinematicTranslation(position);
    verticalSpeed.current = 0;
    keys.current.clear();
    camera.position.set(position.x, position.y + EYE_OFFSET, position.z);
  }

  function exit() {
    keys.current.clear();
    if (document.pointerLockElement === gl.domElement) document.exitPointerLock();
  }

  function requestRecovery() {
    blocked.current = true;
    recovery.current = { elapsed: 0, retryIn: 0 };
    keys.current.clear();
    setWalkStatus('loading');
  }

  useEffect(() => {
    const next = createWalkController(world);
    controller.current = next;
    return () => { controller.current = null; world.removeCharacterController(next); };
  }, [world]);

  useEffect(() => {
    // Initialize in the physics callback, where the body is guaranteed to exist.
    // An effect can run before Rapier has mounted the player on a cold page load.
    needsTeleport.current = true;
    requestRecovery();
  }, [target[0], target[1], target[2], camera, office]);

  useEffect(() => { requestRecovery(); }, [revision]);
  useEffect(() => { if (paused) { keys.current.clear(); if (document.pointerLockElement) document.exitPointerLock(); } }, [paused]);

  useEffect(() => {
    const clear = () => keys.current.clear();
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); exit(); if (blocked.current && !paused) onExit(); return; }
      if (paused || blocked.current || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || editing(event.target)) return;
      if (movementKeys.has(event.code)) { event.preventDefault(); keys.current.add(event.code); }
      if (event.code === 'KeyE' && office && !event.repeat && nearbyRoom.current) {
        event.preventDefault();
        const room = nearbyRoom.current;
        exit();
        onRoom(room.id);
      }
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const focus = (event: FocusEvent) => { if (editing(event.target)) clear(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    document.addEventListener('focusin', focus);
    document.addEventListener('pointerlockchange', clear);
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear);
      document.removeEventListener('focusin', focus); document.removeEventListener('pointerlockchange', clear);
      clear();
    };
  }, [paused, office, onRoom, onExit, gl]);

  useEffect(() => {
    let dragging = false;
    let wasLocked = document.pointerLockElement === gl.domElement;
    const down = (event: MouseEvent) => { dragging = !paused && event.button === 0; };
    const up = () => { dragging = false; };
    const move = (event: MouseEvent) => {
      if (paused || (document.pointerLockElement !== gl.domElement && !dragging)) return;
      const euler = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      euler.y -= event.movementX * .002;
      euler.x = Math.max(-1.45, Math.min(1.45, euler.x - event.movementY * .002));
      camera.quaternion.setFromEuler(euler);
    };
    const lock = () => {
      const locked = document.pointerLockElement === gl.domElement;
      if (!locked && wasLocked) { keys.current.clear(); }
      wasLocked = locked;
    };
    gl.domElement.addEventListener('mousedown', down);
    document.addEventListener('mouseup', up); document.addEventListener('mousemove', move);
    document.addEventListener('pointerlockchange', lock); window.addEventListener('blur', up);
    return () => {
      gl.domElement.removeEventListener('mousedown', down); document.removeEventListener('mouseup', up);
      document.removeEventListener('mousemove', move); document.removeEventListener('pointerlockchange', lock);
      window.removeEventListener('blur', up);
    };
  }, [camera, gl, onExit, paused]);

  // Check actual physics geometry, including headroom, before reusing a position
  // after a design revision. Search only near the design's supplied spawn.
  function clearPosition(nominal: Point): Point | null {
    if (!body.current || !collider.current) return null;
    return clearWalkPosition(world, rapier, body.current, collider.current, nominal);
  }

  function recover() {
    // Preserve the user's position after a revision if it is still safe.
    let position = body.current && clearPosition(body.current.translation()) || clearPosition(spawn);
    for (let radius = .4; !position && radius <= 2; radius += .4) {
      for (let angle = 0; !position && angle < Math.PI * 2; angle += Math.PI / 4) {
        position = clearPosition({ x: spawn.x + Math.cos(angle) * radius, y: spawn.y, z: spawn.z + Math.sin(angle) * radius });
      }
    }
    blocked.current = !position;
    if (position) {
      teleport(position);
      setWalkStatus('ready');
    } else if (recovery.current.elapsed >= STARTUP_GRACE_SECONDS) {
      setWalkStatus('blocked');
    }
  }

  useBeforePhysicsStep(() => {
    if (paused || !body.current || !collider.current || !controller.current) return;
    if (needsTeleport.current) {
      teleport(spawn);
      camera.lookAt(...initialWalkLookTarget(target, office ? null : facingDesign.current));
      needsTeleport.current = false;
      return;
    }
    if (body.current.translation().y < -3 && !blocked.current) { requestRecovery(); return; }
    if (blocked.current) return;
    camera.getWorldDirection(forward.current);
    forward.current.y = 0; forward.current.normalize();
    right.current.set(-forward.current.z, 0, forward.current.x);
    direction.current.set(0, 0, 0);
    if (!paused && !editing(document.activeElement)) {
      if (keys.current.has('KeyW') || keys.current.has('ArrowUp')) direction.current.add(forward.current);
      if (keys.current.has('KeyS') || keys.current.has('ArrowDown')) direction.current.sub(forward.current);
      if (keys.current.has('KeyD') || keys.current.has('ArrowRight')) direction.current.add(right.current);
      if (keys.current.has('KeyA') || keys.current.has('ArrowLeft')) direction.current.sub(right.current);
    }
    const result = stepWalk(controller.current, body.current, collider.current, direction.current, verticalSpeed.current, world.timestep);
    verticalSpeed.current = result.verticalSpeed;
  });

  useAfterPhysicsStep(() => {
    if (paused || needsTeleport.current || !blocked.current || !body.current || !collider.current || !controller.current) return;
    // Query only after Rapier has stepped and indexed newly mounted colliders.
    // Keep retrying if geometry is late; a failed cold-start check is not final.
    const elapsed = Math.max(0, Math.min(world.timestep, .05));
    recovery.current.elapsed += elapsed;
    recovery.current.retryIn -= elapsed;
    if (recovery.current.retryIn > 0) return;
    recover();
    recovery.current.retryIn = recovery.current.elapsed < STARTUP_GRACE_SECONDS ? RECOVERY_RETRY_SECONDS : 1;
  });

  useFrame(() => {
    if (!body.current) return;
    const p = body.current.translation();
    camera.position.set(p.x, p.y + EYE_OFFSET, p.z);
    if (paused) return;
    const room = office && !paused && !blocked.current ? rooms.reduce<Room | null>((closest, candidate) => {
      const point = candidate.id === 'reception' ? [0,0,5.8] : positions.current[candidate.id];
      if (!point || (meeting && candidate.id !== 'reception')) return closest;
      const distance = Math.hypot(p.x-point[0],p.z-point[2]);
      const previous = closest?.id === 'reception' ? [0,0,5.8] : closest ? positions.current[closest.id] : null;
      return distance <= (candidate.id === 'reception' ? 3.2 : INTERACTION_DISTANCE) && (!previous || distance < Math.hypot(p.x-previous[0],p.z-previous[2])) ? candidate : closest;
    }, null) : null;
    if ((room?.id || null) !== voiceRoom.current) { voiceRoom.current = room?.id || null; onProximity(voiceRoom.current); }
    const interaction = office ? rooms.find(r => r.id === 'presentation' ? presentationInRange(p, r.position, presentationAvailable) : r.id === 'reception'
      ? Math.hypot(p.x, p.z-5.8) < 2.8
      : Math.hypot(p.x-r.position[0],p.z-r.position[2]) < 2.8) || null : null;
    if (interaction?.id !== nearbyRoom.current?.id) { nearbyRoom.current = interaction; setRoomLabel(interaction?.label || null); }
  });

  return <>
    <RigidBody ref={body} type="kinematicPosition" colliders={false} enabledRotations={[false, false, false]} position={[spawn.x, spawn.y, spawn.z]}>
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
    </RigidBody>
    {!paused && (walkStatus !== 'ready' || roomLabel) && <Html fullscreen style={{ pointerEvents: 'none' }}><div className={styles.hint} role="status">{walkStatus === 'loading' ? 'Preparing your walking position…' : walkStatus === 'blocked' ? 'Waiting for a clear place to stand. Retrying automatically — press Esc to choose another view.' : <><kbd>E</kbd> {nearbyRoom.current?.id === 'presentation' ? 'Walk inside saved design' : `Talk / workstation: ${roomLabel}`}</>}</div></Html>}
  </>;
}
