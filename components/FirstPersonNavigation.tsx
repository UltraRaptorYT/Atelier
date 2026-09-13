'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CapsuleCollider, RigidBody, useBeforePhysicsStep, useRapier, type RapierCollider, type RapierRigidBody } from '@react-three/rapier';
import { Euler, Vector3 } from 'three';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, EYE_OFFSET, clearWalkPosition, createWalkController, stepWalk, type WalkController } from '@/shared/first-person';
import type { RoomId } from './World';
import styles from './FirstPersonNavigation.module.css';

type Point = { x: number; y: number; z: number };
type Room = { id: RoomId; label: string; camera: [number, number, number] };
type Props = {
  target: [number, number, number];
  rooms: Room[];
  office: boolean;
  revision: string;
  paused: boolean;
  onRoom: (id: RoomId) => void;
  onExit: () => void;
};

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const INTERACTION_DISTANCE = 2.2;

function editing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [role="textbox"]')));
}

export default function FirstPersonNavigation({ target, rooms, office, revision, paused, onRoom, onExit }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const controller = useRef<WalkController | null>(null);
  const keys = useRef(new Set<string>());
  const verticalSpeed = useRef(0);
  const geometryCheck = useRef(2);
  const blocked = useRef(false);
  const nearbyRoom = useRef<Room | null>(null);
  const [roomLabel, setRoomLabel] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const { camera, gl } = useThree();
  const { world, rapier } = useRapier();
  const spawn: Point = { x: target[0], y: target[1] - EYE_OFFSET, z: target[2] };
  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const direction = useRef(new Vector3());

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
    onExit();
  }

  useEffect(() => {
    const next = createWalkController(world);
    controller.current = next;
    return () => { controller.current = null; world.removeCharacterController(next); };
  }, [world]);

  useEffect(() => {
    teleport(spawn);
    camera.lookAt(target[0], target[1], target[2] - 5);
    geometryCheck.current = 2;
    blocked.current = false;
    setUnavailable(false);
  }, [target[0], target[1], target[2], camera]);

  useEffect(() => { geometryCheck.current = 2; }, [revision]);
  useEffect(() => { if (paused) keys.current.clear(); }, [paused]);

  useEffect(() => {
    const clear = () => keys.current.clear();
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); exit(); return; }
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
      if (!locked && wasLocked) { keys.current.clear(); onExit(); }
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
    let position = clearPosition(spawn);
    for (let radius = .4; !position && radius <= 2; radius += .4) {
      for (let angle = 0; !position && angle < Math.PI * 2; angle += Math.PI / 4) {
        position = clearPosition({ x: spawn.x + Math.cos(angle) * radius, y: spawn.y, z: spawn.z + Math.sin(angle) * radius });
      }
    }
    blocked.current = !position;
    setUnavailable(!position);
    if (position) teleport(position);
  }

  useBeforePhysicsStep(() => {
    if (!body.current || !collider.current || !controller.current) return;
    if (geometryCheck.current > 0) {
      // Allow replacement colliders to reach Rapier's query structures first.
      if (--geometryCheck.current === 0) {
        const current = clearPosition(body.current.translation());
        if (current) { blocked.current = false; setUnavailable(false); teleport(current); }
        else recover();
      }
      return;
    }
    if (body.current.translation().y < -3) { recover(); return; }
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

  useFrame(() => {
    if (!body.current) return;
    const p = body.current.translation();
    camera.position.set(p.x, p.y + EYE_OFFSET, p.z);
    const room = office && !paused && !blocked.current ? rooms.reduce<Room | null>((closest, candidate) => {
      const distance = Math.hypot(p.x - candidate.camera[0], p.z - candidate.camera[2]);
      return distance <= INTERACTION_DISTANCE && (!closest || distance < Math.hypot(p.x - closest.camera[0], p.z - closest.camera[2])) ? candidate : closest;
    }, null) : null;
    if (room?.id !== nearbyRoom.current?.id) { nearbyRoom.current = room; setRoomLabel(room?.label || null); }
  });

  return <>
    <RigidBody ref={body} type="kinematicPosition" colliders={false} enabledRotations={[false, false, false]} position={[spawn.x, spawn.y, spawn.z]}>
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
    </RigidBody>
    {!paused && (unavailable || roomLabel) && <Html fullscreen style={{ pointerEvents: 'none' }}><div className={styles.hint} role="status">{unavailable ? 'No clear place to stand here. Press Esc and choose another room or review the model.' : <><kbd>E</kbd> Open {roomLabel}</>}</div></Html>}
  </>;
}
