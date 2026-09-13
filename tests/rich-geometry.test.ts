import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial } from 'three';
import type { RapierContext } from '@react-three/rapier';
import { DesignSchema, recolor, type DesignElement } from '../shared/design';
import { exampleDesign } from '../shared/example';
import { geometryParts, materialAppearance, meshGeometry } from '../shared/geometry';
import { createElementGeometry, createElementMaterial } from '../lib/design-geometry';
import { readNavigationWorld } from '../lib/navigation-world';
import { canWalkSegment, isWalkable } from '../shared/navigation';
import { DesignScopeError, mergeDesignProposal } from '../shared/collaboration';
const RAPIER: RapierContext['rapier'] = createRequire(createRequire(import.meta.url).resolve('@react-three/rapier'))('@dimforge/rapier3d-compat');

function roof(): DesignElement {
  return { ...exampleDesign().elements.find(e=>e.id==='roof')!, position:[0,2,0], size:[10,2,10], geometry:{type:'mesh',
    vertices:[[-.5,-.5,-.5],[-.5,-.5,.5],[.5,.5,.5],[.5,.5,-.5]], triangles:[[0,1,2],[0,2,3]]} };
}
function floor(): DesignElement {
  return { ...exampleDesign().elements[0], position:[0,-.1,0],size:[10,.2,10],geometry:{type:'mesh',
    vertices:[[-.5,.5,-.5],[-.5,.5,.5],[0,.5,.5],[0,.5,-.5],[0,.5,-.5],[0,.5,0],[.5,.5,0],[.5,.5,-.5]],
    triangles:[[0,1,2],[0,2,3],[4,5,6],[4,6,7]]} };
}
function world(elements:DesignElement[]) {
  const root=new Group();
  for(const element of elements) {
    const group=new Group();group.position.set(...element.position);group.rotation.y=element.rotation;
    for(const part of createElementGeometry(element)) {
      const mesh=new Mesh(part.geometry,new MeshBasicMaterial());mesh.position.set(...part.position);
      mesh.userData={walkObstacle:true,walkSurface:element.kind==='slab'};group.add(mesh);
    }
    root.add(group);
  }
  const navigation=readNavigationWorld(root);
  root.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();(object.material as MeshBasicMaterial).dispose();}});
  return navigation;
}

describe('supported architectural meshes',()=>{
  it('keeps mesh geometry through canonical validation without changing old designs',()=>{
    const legacy=exampleDesign();expect(DesignSchema.parse(legacy)).toEqual(legacy);
    const design={...legacy,elements:[roof(),floor()]};
    expect(DesignSchema.parse(design).elements).toEqual(design.elements);
    expect(geometryParts(roof())).toEqual([]);
    const explicitTread={...floor(),kind:'stair' as const};
    expect(geometryParts(explicitTread)).toEqual([]);
  });
  it('rejects malformed, degenerate, oversized, and ambiguous meshes',()=>{
    for(const mutate of [
      (e:DesignElement)=>{e.geometry!.vertices[0][0]=.51;},
      (e:DesignElement)=>{e.geometry!.triangles[0][0]=4;},
      (e:DesignElement)=>{e.geometry!.triangles[0][0]=.5;},
      (e:DesignElement)=>{e.geometry!.triangles[0]=[0,0,1];},
      (e:DesignElement)=>{e.geometry!.vertices=Array.from({length:2049},()=>[0,0,0]);},
      (e:DesignElement)=>{e.assetId='atelier-chair';},
    ]) {const element=roof();mutate(element);expect(DesignSchema.safeParse({...exampleDesign(),elements:[element]}).success).toBe(false);}
  });
  it('matches Blender vertex scale and coordinate conversion while preserving triangle normals',()=>{
    const element=roof(), canonical=meshGeometry(element)!;
    const python=JSON.parse(execFileSync('python3',['-c','import json,sys;from scripts.blender_compile import mesh_geometry;print(json.dumps(mesh_geometry(json.load(sys.stdin))))'],{input:JSON.stringify(element),encoding:'utf8'}));
    expect(python[0]).toEqual(element.geometry!.vertices.map(v=>[v[0]*10,v[2]*10,v[1]*2]));
    expect(python[1]).toEqual([[0,2,1],[0,3,2]]);
    const parts=createElementGeometry(element);
    expect(Array.from(parts[0].geometry.getAttribute('position').array)).toEqual(canonical.vertices);
    expect(Array.from(parts[0].geometry.index!.array)).toEqual(canonical.indices);
    expect(parts[0].geometry.getAttribute('normal').getY(0)).toBeGreaterThan(.9);
    parts[0].geometry.dispose();
  });
  it('preserves floor holes and sloping roof headroom in click-to-walk',()=>{
    const navigation=world([floor(),roof()]);
    expect(navigation.triangles).toHaveLength(6);
    expect(isWalkable(navigation,[3,0,-3])).toBe(true);
    expect(canWalkSegment(navigation,[1,0,-3],[4,0,-3])).toBe(true);
    expect(isWalkable(navigation,[3,0,3])).toBe(false); // The absent corner stays absent.
    expect(isWalkable(navigation,[-4,0,-3])).toBe(false); // Low side of the pitched roof.
    expect(canWalkSegment(navigation,[3,0,-3],[3,0,3])).toBe(false);
  });
  it('tracks translated and rotated mesh floors and prevents crossing arbitrarily thin mesh walls',()=>{
    const elements=[floor(),roof()].map(e=>({...e,position:[e.position[0]+20,e.position[1],e.position[2]-30] as [number,number,number],rotation:Math.PI/2}));
    const rotated=world(elements);
    expect(isWalkable(rotated,[17,0,-33])).toBe(true);
    expect(isWalkable(rotated,[23,0,-33])).toBe(false);
    const barrier:DesignElement={...floor(),id:'barrier',kind:'wall',position:[.013,1.5,0],size:[.01,3,10],geometry:{type:'mesh',vertices:[[0,-.5,-.5],[0,.5,-.5],[0,.5,.5],[0,-.5,.5]],triangles:[[0,1,2],[0,2,3]]}};
    const obstructed=world([floor(),barrier]);
    expect(isWalkable(obstructed,[-2,0,-3])).toBe(true);
    expect(isWalkable(obstructed,[2,0,-3])).toBe(true);
    expect(canWalkSegment(obstructed,[-2,0,-3],[2,0,-3])).toBe(false);
  });
  it('uses the same mesh for physical support and roof clearance',async()=>{
    await RAPIER.init();
    const physics=new RAPIER.World({x:0,y:-9.8,z:0});
    try {
      for(const element of [floor(),roof()]) {
        const mesh=meshGeometry(element)!;
        physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(mesh.vertices),new Uint32Array(mesh.indices)).setTranslation(...element.position));
      }
      physics.step();
      const hit=(x:number,z:number,y=4)=>physics.castRay(new RAPIER.Ray({x,y,z},{x:0,y:-1,z:0}),10,true);
      expect(hit(3,-3)?.timeOfImpact).toBeCloseTo(1.4);
      expect(hit(-4,-3)?.timeOfImpact).toBeCloseTo(2.8);
      expect(hit(3,-3,.5)?.timeOfImpact).toBeCloseTo(.5);
      expect(hit(3,3,.5)).toBeNull();
    } finally {physics.free();}
  });
});

describe('material appearance and ownership',()=>{
  it('lets explicit opaque window frames and doors override legacy transparency in both renderers',()=>{
    const base=exampleDesign().materials[0];
    const inputs=[{material:base,element:{kind:'window' as const}}, {material:{...base,opacity:1},element:{kind:'window' as const}}, {material:{...base,opacity:1},element:{kind:'door' as const}}, {material:{...base,transmission:.8},element:{kind:'window' as const}}];
    const python=JSON.parse(execFileSync('python3',['-c','import json,sys;from scripts.blender_compile import material_appearance;print(json.dumps([material_appearance(x["material"],x["element"]) for x in json.load(sys.stdin)]))'],{input:JSON.stringify(inputs),encoding:'utf8'}));
    expect(inputs.map(x=>materialAppearance(x.material,x.element))).toEqual(python);
    expect(python).toEqual([{opacity:.25,transmission:.9},{opacity:1,transmission:0},{opacity:1,transmission:0},{opacity:1,transmission:.8}]);
    const material=createElementMaterial({...base,opacity:1},{kind:'window'});expect(material.transparent).toBe(false);expect(material.transmission).toBe(0);material.dispose();
  });
  it('rejects Designer geometry additions to old structural elements but merges appearance changes with Architect meshes',()=>{
    const base=exampleDesign(), architecture=structuredClone(base), designer=structuredClone(base);
    architecture.elements.find(e=>e.id==='roof')!.geometry=roof().geometry;
    designer.elements.find(e=>e.id==='roof')!.geometry=roof().geometry;
    expect(()=>mergeDesignProposal(base,base,designer,'designer')).toThrow(DesignScopeError);
    const recolored=recolor(base,'roof','#cc3344');
    expect(mergeDesignProposal(base,architecture,recolored,'designer').elements.find(e=>e.id==='roof')!.geometry).toEqual(roof().geometry);
  });
  it('opts into a material override only when an imported asset is explicitly recolored',()=>{
    const design=exampleDesign();design.assets=[{id:'custom-chair',name:'Chair',artifactId:'test-artifact',author:'Atelier',license:'CC0'}];
    design.elements.find(e=>e.id==='sofa')!.assetId='custom-chair';
    expect(design.elements.find(e=>e.id==='sofa')!.assetMaterialOverride).toBeUndefined();
    const changed=recolor(design,'sofa','#aa2233');
    expect(changed.elements.find(e=>e.id==='sofa')!.assetMaterialOverride).toBe(true);
    expect(mergeDesignProposal(design,design,changed,'designer')).toEqual(changed);
  });
});
