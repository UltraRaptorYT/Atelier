'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { Group, Matrix3 } from 'three';
import { readNavigationWorld } from '@/lib/navigation-world';
import {
  canWalkSegment, findWalkPath, projectWalkPosition,
  type NavigationPoint, type NavigationWorld,
} from '@/shared/navigation';

type Props = {
  children: ReactNode;
  spawn: NavigationPoint;
  paused: boolean;
  onStatus: (message: string) => void;
};

function clearSpawn(world: NavigationWorld, spawn: NavigationPoint): NavigationPoint | null {
  const direct = projectWalkPosition(world, spawn, 3);
  if (direct) return direct;
  for (let radius = .4; radius <= 2; radius += .4) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const point = projectWalkPosition(world, [spawn[0] + Math.cos(angle) * radius, spawn[1], spawn[2] + Math.sin(angle) * radius], 3);
      if (point) return point;
    }
  }
  return null;
}

export default function ClickNavigation({ children, spawn, paused, onStatus }: Props) {
  const root = useRef<Group>(null);
  const visitor = useRef<Group>(null);
  const world = useRef<NavigationWorld>({ surfaces: [], obstacles: [] });
  const position = useRef<NavigationPoint | null>(null);
  const remaining = useRef<NavigationPoint[]>([]);
  const [route, setRoute] = useState<NavigationPoint[]>([]);
  const [ready, setReady] = useState(false);

  function stop(message: string) {
    remaining.current = [];
    setRoute([]);
    onStatus(message);
  }

  useLayoutEffect(() => {
    if (!root.current) return;
    world.current = readNavigationWorld(root.current);
    const start = clearSpawn(world.current, spawn);
    position.current = start;
    remaining.current = [];
    setRoute([]);
    setReady(Boolean(start));
    if (start) visitor.current?.position.set(...start);
    onStatus(start ? 'Click a clear floor to walk there. Drag to orbit. Esc stops walking.' : 'No clear starting point here. Choose another room or use Orbit.');
  }, [spawn[0], spawn[1], spawn[2], onStatus]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      remaining.current = [];
      setRoute([]);
      onStatus('Walking stopped. Click a floor to choose a new destination.');
    };
    const blur = () => {
      if (!remaining.current.length) return;
      remaining.current = []; setRoute([]);
      onStatus('Walking stopped. Click a floor to continue.');
    };
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', cancel); window.removeEventListener('blur', blur); };
  }, [onStatus]);

  useEffect(() => {
    if (paused && remaining.current.length) {
      remaining.current = []; setRoute([]);
      onStatus('Walking stopped. Close the dialog, then click a floor to continue.');
    }
  }, [paused, onStatus]);

  function chooseDestination(event: ThreeEvent<MouseEvent>) {
    if (paused || event.delta > 5 || event.button !== 0 || !position.current) return;
    event.stopPropagation();
    const hit = event.intersections.find(intersection => intersection.object.userData.walkObstacle);
    const normal = hit?.face?.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    if (!hit?.object.userData.walkSurface || !normal || normal.y < .9) {
      stop('Choose a clear spot on the floor.');
      return;
    }
    const destination: NavigationPoint = [hit.point.x, hit.point.y, hit.point.z];
    const path = findWalkPath(world.current, position.current, destination);
    if (!path) { stop('That spot is not reachable. Choose a connected, clear floor.'); return; }
    remaining.current = path;
    setRoute([position.current, ...path]);
    onStatus('Walking to your destination. Click another floor to change course, or press Esc to stop.');
  }

  useFrame((state, delta) => {
    if (!visitor.current || !position.current) return;
    let current = position.current;
    let distanceLeft = Math.min(delta, .05) * 3.2;
    while (!paused && remaining.current.length && distanceLeft > 0) {
      const next = remaining.current[0];
      const distance = Math.hypot(next[0] - current[0], next[2] - current[2]);
      const ratio = distance < .001 ? 1 : Math.min(1, distanceLeft / distance);
      const candidate: NavigationPoint = [current[0] + (next[0] - current[0]) * ratio, current[1], current[2] + (next[2] - current[2]) * ratio];
      const step = projectWalkPosition(world.current, candidate, .2);
      if (!step || !canWalkSegment(world.current, current, step)) { stop('The route is blocked. Choose another destination.'); break; }
      visitor.current.rotation.y = Math.atan2(next[0] - current[0], next[2] - current[2]);
      current = step;
      distanceLeft -= distance * ratio;
      if (ratio === 1) remaining.current.shift();
      else break;
      if (!remaining.current.length) { setRoute([]); onStatus('You have arrived. Click another floor to keep exploring.'); }
    }
    position.current = current;
    visitor.current.position.set(current[0], current[1] + (remaining.current.length ? Math.abs(Math.sin(state.clock.elapsedTime * 9)) * .025 : 0), current[2]);
  });

  const destination = route.at(-1);
  return <group ref={root} onClick={chooseDestination}>
    {children}
    <group ref={visitor} visible={ready} name="studio-visitor">
      <mesh position={[0, 1.48, 0]} castShadow><sphereGeometry args={[.18, 16, 12]} /><meshStandardMaterial color="#c39b7e" /></mesh>
      <mesh position={[0, 1, 0]} castShadow><capsuleGeometry args={[.22, .45, 4, 12]} /><meshStandardMaterial color="#526b43" /></mesh>
      {[-.12, .12].map(x => <mesh key={x} position={[x, .35, 0]} castShadow><boxGeometry args={[.17, .7, .2]} /><meshStandardMaterial color="#384437" /></mesh>)}
      {ready && <Html position={[0, 2.05, 0]} center style={{ pointerEvents: 'none' }}><span className="visitor-label">You</span></Html>}
    </group>
    {route.length > 1 && <Line points={route.map(p => [p[0], p[1] + .04, p[2]] as NavigationPoint)} color="#65894e" lineWidth={2} raycast={() => {}} />}
    {destination && <mesh position={[destination[0], destination[1] + .025, destination[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}><ringGeometry args={[.23, .32, 32]} /><meshBasicMaterial color="#526b43" /></mesh>}
  </group>;
}
