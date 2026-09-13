'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, PerformanceMonitor, useGLTF, useTexture } from '@react-three/drei';
import { Physics, RigidBody } from '@react-three/rapier';
import { Vector3, Group, PCFShadowMap, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { agents, type AgentId, type Design, type Task } from '@/shared/design';
import { geometryParts } from '@/shared/geometry';
import ClickNavigation from './ClickNavigation';
import FirstPersonNavigation from './FirstPersonNavigation';

export type RoomId = 'reception' | AgentId | 'presentation';
export const rooms: { id: RoomId; label: string; position: [number, number, number]; camera: [number, number, number] }[] = [
  { id: 'reception', label: 'Meeting room', position: [0, 0, 4], camera: [0, 1.7, 7] },
  { id: 'principal', label: 'Principal', position: [-7.5, 0, 4], camera: [-7.5, 1.7, 6.8] },
  { id: 'architect', label: 'Architecture', position: [-7.5, 0, -4], camera: [-7.5, 1.7, -.8] },
  { id: 'designer', label: 'Interiors', position: [0, 0, -4], camera: [0, 1.7, -.8] },
  { id: 'critic', label: 'Design review', position: [7.5, 0, -4], camera: [7.5, 1.7, -.8] },
  { id: 'presentation', label: 'Presentation', position: [7.5, 0, 4], camera: [7.5, 1.7, 7] },
];
type Preview = {agent:AgentId;url:string;createdAt:string};
type Props = { room: RoomId; mode: 'office' | 'model'; walking: boolean; clickToWalk: boolean; paused: boolean; onWalkStatus: (status: string) => void; design: Design | null; projectId: string | null; previews:Preview[]; onFrameRate:(fps:number)=>void; selected: string | null; onSelect: (id: string) => void; onRoom: (id: RoomId) => void; tasks: Task[]; onUnlock: () => void; cutaway: boolean; revision: number; captureRef: React.RefObject<(() => string) | null> };
function FrameRate({onMeasure}:{onMeasure:(fps:number)=>void}) {
  const sample=useRef({frames:0,elapsed:0});
  useFrame((_,delta)=>{if(document.hidden){sample.current={frames:0,elapsed:0};return;}sample.current.frames++;sample.current.elapsed+=delta;if(sample.current.elapsed>=3){onMeasure(Math.round(sample.current.frames/sample.current.elapsed));sample.current={frames:0,elapsed:0};}});
  return null;
}
function MonitorPreview({preview}:{preview:Preview}){
  const texture=useTexture(preview.url);texture.colorSpace=SRGBColorSpace;
  return <group><mesh position={[0,1.35,-.225]}><planeGeometry args={[.92,.55]}/><meshBasicMaterial map={texture}/></mesh><Html position={[0,1.76,-.25]} center distanceFactor={5}><span className="monitor-stamp">{new Date(preview.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></Html></group>;
}
function Box({ p, s, color = '#c7b69e', collision = false, surface = false, rotation = 0, ...rest }: { p: [number, number, number]; s: [number, number, number]; color?: string; collision?: boolean; surface?: boolean; rotation?: number; onClick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const mesh = <mesh position={p} rotation={[0, rotation, 0]} castShadow receiveShadow userData={{ walkObstacle: collision, walkSurface: surface }} {...rest}><boxGeometry args={s} /><meshStandardMaterial color={color} roughness={.8} /></mesh>;
  return collision ? <RigidBody type="fixed" colliders="cuboid">{mesh}</RigidBody> : mesh;
}
function Plant({ p, scale = 1 }: { p: [number, number, number]; scale?: number }) {
  return <group position={p} scale={scale}><mesh position={[0, .3, 0]} castShadow><cylinderGeometry args={[.3, .23, .6, 16]} /><meshStandardMaterial color="#b8a78d" /></mesh><mesh position={[0, 1, 0]} castShadow><sphereGeometry args={[.48, 10, 8]} /><meshStandardMaterial color="#586b46" roughness={1} /></mesh><mesh position={[.2, 1.35, 0]}><sphereGeometry args={[.3, 10, 8]} /><meshStandardMaterial color="#708357" /></mesh></group>;
}
function Chair({ p, angle = 0 }: { p: [number, number, number]; angle?: number }) {
  return <group position={p} rotation={[0, angle, 0]}><Box p={[0, .5, 0]} s={[.65, .16, .6]} color="#d0c5b2" /><Box p={[0, .9, -.28]} s={[.65, .7, .1]} color="#d0c5b2" />{[-.24, .24].flatMap(x => [-.22, .22].map(z => <Box key={`${x}${z}`} p={[x, .25, z]} s={[.05, .5, .05]} color="#76634f" />))}</group>;
}
function Desk({ p, accent }: { p: [number, number, number]; accent: string }) {
  return <group position={p}><Box p={[0, .8, 0]} s={[2.6, .12, 1.05]} color="#ad885d" collision /><Box p={[-1, .4, 0]} s={[.08, .8, .85]} color="#4e514c" /><Box p={[1, .4, 0]} s={[.08, .8, .85]} color="#4e514c" /><Box p={[0, 1.35, -.28]} s={[1.02, .66, .06]} color="#333b37" /><Box p={[0, 1.35, -.24]} s={[.91, .54, .015]} color={accent} /><Box p={[0, .87, .18]} s={[.7, .03, .25]} color="#e0ded4" /><Box p={[0, 1.02, -.28]} s={[.05, .35, .05]} color="#42463f" /><Box p={[.9, .91, .1]} s={[.38, .06, .5]} color="#eeebdf" /><Chair p={[0, 0, 1]} angle={Math.PI} /></group>;
}
function Avatar({ agent, active, at }: { agent: AgentId; active: boolean; at: [number, number, number] }) {
  const group = useRef<Group>(null);
  const target = useRef(new Vector3(...at));
  useEffect(() => { target.current.set(...(active ? at : [at[0] * .5, 0, 3] as [number, number, number])); }, [active, at]);
  useFrame((state, dt) => {
    if (!group.current) return;
    const moving = group.current.position.distanceTo(target.current) > .05;
    group.current.position.lerp(target.current, Math.min(dt * 1.1, 1));
    group.current.position.y = moving ? Math.abs(Math.sin(state.clock.elapsedTime * 6)) * .06 : 0;
  });
  return <group ref={group} position={at}><mesh position={[0, 1.37, 0]} castShadow><sphereGeometry args={[.18, 16, 16]} /><meshStandardMaterial color="#bc9274" /></mesh><mesh position={[0, .96, 0]} castShadow><capsuleGeometry args={[.2, .4, 4, 8]} /><meshStandardMaterial color={agents[agent].color} /></mesh>{[-.12, .12].map(x => <Box key={x} p={[x, .36, 0]} s={[.16, .65, .19]} color="#424741" />)}</group>;
}
function Maquette({design}:{design:Design}) {
  const radius=Math.max(...design.elements.map(e=>Math.max(Math.abs(e.position[0])+e.size[0]/2,Math.abs(e.position[2])+e.size[2]/2)),1);
  return <group position={[7.5,1.12,4]} scale={1.2/radius}>{design.elements.filter(e=>e.kind!=='roof').map(e=><group key={e.id} position={e.position} rotation={[0,e.rotation,0]}>{geometryParts(e).map((p,i)=><mesh key={i} position={p.position} castShadow><boxGeometry args={p.size}/><meshStandardMaterial color={design.materials.find(m=>m.id===e.materialId)?.color}/></mesh>)}</group>)}</group>;
}
function Office({ onRoom, room, tasks, design, previews }: Pick<Props, 'onRoom' | 'room' | 'tasks' | 'design' | 'previews'>) {
  return <group>
    <Box p={[0, -.18, 0]} s={[24, .35, 17]} color="#c9bba3" collision surface />
    <Box p={[0, -.38, 0]} s={[24.4, .1, 17.4]} color="#9a927e" />
    {Array.from({ length: 30 }, (_, i) => <Box key={i} p={[-11.7 + i * .8, .002, 0]} s={[.014, .01, 17]} color="#b7a58a" />)}
    <Box p={[0, 1.5, -8.5]} s={[24, 3, .2]} color="#d9d6c9" collision />
    <Box p={[-12, 1.5, 0]} s={[.18, 3, 17]} color="#dedbce" collision />
    <Box p={[12, .6, 0]} s={[.18, 1.2, 17]} color="#d9d6c9" collision />
    {[-11, -8, -5, -2, 1, 4, 7, 10].map(x => <group key={x}><Box p={[x, 1.9, -8.36]} s={[2.4, 1.8, .025]} color="#e6eee6" /><Box p={[x, 1.9, -8.32]} s={[.05, 1.8, .04]} color="#858b7c" /></group>)}
    {[-3.7, 3.7].map(x => <group key={x}><Box p={[x, .5, -4.5]} s={[.12, 1, 7.6]} color="#c9c7b9" collision /><Box p={[x, 2.1, -4.5]} s={[.055, .045, 7.6]} color="#8b8f81" />{[-7.8, -4.5, -.7].map(z => <Box key={z} p={[x, 1.5, z]} s={[.07, 3, .07]} color="#848b7c" />)}</group>)}
    {[-10.5,-4.9,2.7,10.5].map((x,i) => <Box key={x} p={[x,.65,0]} s={[[3,1.3,.15],[4.2,1.3,.15],[3.4,1.3,.15],[3,1.3,.15]][i] as [number,number,number]} color="#d4d1c2" collision />)}
    {[-4, 4].map(x => <Box key={x} p={[x, 1.5, 4.4]} s={[.12, 3, 7.3]} color="#d9d5c7" collision />)}
    <Box p={[0, .77, 3.8]} s={[4.2, .18, 1.7]} color="#a78056" collision />
    {[-1.4, 0, 1.4].flatMap(x => [2.45, 5.1].map(z => <Chair key={`${x}${z}`} p={[x, 0, z]} angle={z < 3 ? 0 : Math.PI} />))}
    <Box p={[0, .91, 3.8]} s={[1, .06, .65]} color="#f0ede3" />
    <Box p={[.15, 1.06, 3.8]} s={[.45, .3, .4]} color="#d2cbb9" />
    {(['principal', 'architect', 'designer', 'critic'] as AgentId[]).map(agent => {
      const r = rooms.find(r => r.id === agent)!;
      const active = tasks.some(t => t.agent === agent && t.status === 'in_progress');
      const preview=previews.find(p=>p.agent===agent);
      return <group key={agent}><Desk p={[r.position[0], 0, r.position[2] - 1]} accent={active ? '#afbc9d' : '#64776d'} />{preview && <group position={[r.position[0],0,r.position[2]-1]}><Suspense fallback={null}><MonitorPreview preview={preview}/></Suspense></group>}<Avatar agent={agent} active={active} at={[r.position[0] + 1.8, 0, r.position[2] - .5]} /><Box p={[r.position[0] - 2.5, 1.1, r.position[2] - 2.6]} s={[.9, 2.2, .5]} color="#a88b65" />{[.5, 1, 1.5].map(y => <Box key={y} p={[r.position[0] - 2.5, y, r.position[2] - 2.32]} s={[.75, .06, .08]} color="#e1dac6" />)}</group>;
    })}
    <Box p={[7.5, .55, 4]} s={[3.8, 1.1, 2.8]} color="#dfd9cb" collision />
    {design && <Maquette design={design}/>}
    {[[-10.9, 0, 7], [10.8, 0, -7.4], [-10.8, 0, -7.3], [2.7, 0, -7.3], [10.8, 0, 7]] .map((p, i) => <Plant key={i} p={p as [number, number, number]} scale={i % 2 ? 1.2 : 1} />)}
    {rooms.map(r => <Html key={r.id} position={[r.position[0], .25, r.position[2] + 2]} center distanceFactor={22} occlude={false}><button className={`world-room ${room === r.id ? 'current' : ''}`} onClick={() => onRoom(r.id)}><span>{String(rooms.indexOf(r) + 1).padStart(2, '0')}</span>{r.label}</button></Html>)}
  </group>;
}
function PublishedAsset({url,color,roughness,metalness,onClick}:{url:string;color:string;roughness:number;metalness:number;onClick:(event:ThreeEvent<MouseEvent>)=>void}) {
  const {scene}=useGLTF(url);
  const copy=useMemo(()=>{const cloned=scene.clone(true); cloned.traverse(o=>{if(o instanceof Mesh){o.material=new MeshStandardMaterial({color,roughness,metalness});o.castShadow=true;o.receiveShadow=true;}});return cloned;},[scene,color,roughness,metalness]);
  useEffect(()=>()=>{copy.traverse(o=>{if(o instanceof Mesh && o.material instanceof MeshStandardMaterial)o.material.dispose();});},[copy]);
  return <primitive object={copy} onClick={onClick}/>;
}
function Building({ design, selected, onSelect, cutaway, projectId, clickToWalk }: { design: Design; selected: string | null; onSelect: Props['onSelect']; cutaway: boolean; projectId:string|null; clickToWalk: boolean }) {
  return <group>{design.elements.filter(e => !(cutaway && e.kind === 'roof')).map(e => {
    const material = design.materials.find(m => m.id === e.materialId)!;
    const geometryKey=`${e.id}:${e.position.join(',')}:${e.size.join(',')}:${e.rotation}:${e.assetId}`;
    const collision = !['light', 'window', 'door'].includes(e.kind);
    const asset=design.assets.find(a=>a.id===e.assetId);
    if(asset && projectId) return <RigidBody key={`${geometryKey}:${asset.artifactId}`} type="fixed" colliders="trimesh"><group position={e.position} rotation={[0,e.rotation,0]} scale={e.size}><PublishedAsset url={`/api/studio/projects/${projectId}/artifacts/${asset.artifactId}`} {...material} onClick={event=>{event.stopPropagation();onSelect(e.id);}}/></group></RigidBody>;
    const shapes = <group position={e.position} rotation={[0, e.rotation, 0]}>{geometryParts(e).map((part, i) => <mesh key={i} position={part.position} castShadow receiveShadow userData={{ walkObstacle: collision, walkSurface: ['slab', 'stair'].includes(e.kind) }} onClick={event => { if (clickToWalk) return; event.stopPropagation(); onSelect(e.id); }}><boxGeometry args={part.size} /><meshStandardMaterial color={material.color} roughness={material.roughness} metalness={material.metalness} transparent={e.kind === 'window' || e.kind === 'door'} opacity={e.kind === 'window' ? .25 : e.kind === 'door' ? .4 : 1} emissive={selected === e.id ? '#bd824e' : '#000000'} emissiveIntensity={selected === e.id ? .25 : 0} /></mesh>)}</group>;
    return collision ? <RigidBody key={geometryKey} type="fixed" colliders="cuboid">{shapes}</RigidBody> : <group key={e.id}>{shapes}</group>;
  })}<Box p={[0, -.4, 0]} s={[80, .1, 80]} color="#b8bbaa" collision surface /></group>;
}
function CameraRig({ walking, mode, captureRef }: Pick<Props, 'walking' | 'mode' | 'captureRef'>) {
  const { camera, gl, scene } = useThree();
  useEffect(() => { if (!walking) { camera.position.set(...(mode === 'office' ? [24, 26, 30] : [18, 15, 20]) as [number, number, number]); camera.lookAt(0, 0, 0); } }, [walking, mode, camera]);
  useEffect(() => { captureRef.current = () => { gl.render(scene, camera); return gl.domElement.toDataURL('image/png'); }; return () => { captureRef.current = null; }; }, [gl, scene, camera, captureRef]);
  return null;
}
export default function World(props: Props) {
  const [quality, setQuality] = useState(1.5);
  useEffect(()=>{if(!props.walking && document.pointerLockElement) document.exitPointerLock();},[props.walking]);
  const target = props.mode === 'model' && props.design ? props.design.spawn : rooms.find(r => r.id === props.room)!.camera;
  const geometry = props.mode === 'office'
    ? <Office onRoom={props.onRoom} room={props.room} tasks={props.tasks} design={props.design} previews={props.previews} />
    : props.design && <Building projectId={props.projectId} design={props.design} selected={props.selected} onSelect={props.onSelect} cutaway={props.cutaway} clickToWalk={props.clickToWalk} />;
  return <Canvas fallback={<div className="loading-world"><p>3D is unavailable in this browser. Your project panel, conversations and files are still available.</p></div>} shadows={{ type: PCFShadowMap }} dpr={[1, quality]} camera={{ position: [24, 26, 30], fov: 40 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
    <color attach="background" args={['#e4e3d9']} /><fog attach="fog" args={['#e4e3d9', 50, 110]} />
    <ambientLight intensity={.9} /><hemisphereLight args={['#fff7df', '#939783', 1.6]} />
    <directionalLight position={[10, 25, 8]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={25} shadow-camera-bottom={-25} shadow-bias={-.0005} />
    <PerformanceMonitor onDecline={() => setQuality(1)} />
    <FrameRate onMeasure={props.onFrameRate}/>
    <Suspense fallback={<Html center><div className="scene-loading">Opening the studio…</div></Html>}><Physics gravity={[0, -20, 0]}>
      {props.clickToWalk ? <ClickNavigation key={`${props.mode}-${props.revision}-${props.cutaway}`} spawn={target} paused={props.paused} onStatus={props.onWalkStatus}>{geometry}</ClickNavigation> : geometry}
      {props.walking && <FirstPersonNavigation key={props.mode} target={target} rooms={rooms} revision={`${props.revision}-${props.cutaway}`} paused={props.paused} onRoom={props.onRoom} onExit={props.onUnlock} office={props.mode === 'office'} />}
    </Physics></Suspense>
    <ContactShadows position={[0, -.5, 0]} opacity={.3} scale={65} blur={2} far={20} resolution={256} />
    {!props.walking && <OrbitControls makeDefault minDistance={8} maxDistance={65} maxPolarAngle={Math.PI / 2.1} target={[0, 0, 0]} />}
    <CameraRig walking={props.walking} mode={props.mode} captureRef={props.captureRef} />
  </Canvas>;
}
