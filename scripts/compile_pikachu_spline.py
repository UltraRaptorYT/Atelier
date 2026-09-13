"""Compile the canonical house into editable Spline DSL batches (no DCC dependency)."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "project/spline"
OUT.mkdir(parents=True, exist_ok=True)
D = json.loads((ROOT / "project/design.json").read_text())
S = 50
WALL_PARTS = {}
prior_walls=[]
for e in D['elements']:
    if e['kind']!='wall' or e['blender']['shape']!='box' or e['rotation']: continue
    bounds=[[e['position'][i]-e['size'][i]/2,e['position'][i]+e['size'][i]/2] for i in range(3)]
    parts=[bounds]
    for prior in prior_walls:
        result=[]
        for part in parts:
            overlap=[[max(part[i][0],prior[i][0]),min(part[i][1],prior[i][1])] for i in range(3)]
            if any(v[1]-v[0]<1e-7 for v in overlap):result.append(part);continue
            core=[list(v) for v in part]
            for axis in range(3):
                lo,hi=overlap[axis]
                if lo>core[axis][0]+.001:
                    slab=[list(v) for v in core];slab[axis][1]=lo-.012
                    if slab[axis][1]>slab[axis][0]:result.append(slab)
                if hi<core[axis][1]-.001:
                    slab=[list(v) for v in core];slab[axis][0]=hi+.012
                    if slab[axis][1]>slab[axis][0]:result.append(slab)
                core[axis]=[lo,hi]
        parts=result
    if parts!=[bounds]:WALL_PARTS[e['id']]=parts
    prior_walls.append(bounds)


def triangulate(vertices, face):
    """Ear clipping preserves concave floor outlines and source winding."""
    a, b, c = [vertices[i] for i in face[:3]]
    u, v = [b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)]
    n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
    axis = max(range(3), key=lambda i: abs(n[i]))
    pts = {i: [x for k,x in enumerate(vertices[i]) if k != axis] for i in face}
    def cross(i,j,k):
        a,b,c=pts[i],pts[j],pts[k]
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    area=sum(pts[i][0]*pts[j][1]-pts[j][0]*pts[i][1] for i,j in zip(face,face[1:]+face[:1]))
    sign=1 if area>0 else -1
    remaining=list(face); triangles=[]
    while len(remaining)>3:
        for k,j in enumerate(remaining):
            i,h=remaining[k-1],remaining[(k+1)%len(remaining)]
            if cross(i,j,h)*sign<=1e-9: continue
            inside=any(all(cross(x,y,p)*sign>=-1e-9 for x,y in [(i,j),(j,h),(h,i)]) for p in remaining if p not in [i,j,h])
            if inside: continue
            triangles.append([i,j,h]); remaining.pop(k); break
        else: raise ValueError(f"Cannot triangulate {face}")
    triangles.append(remaining)
    return triangles


def record(e):
    b=e['blender']  # Existing shape metadata; no Blender process or API is used.
    name=f"PH26 | {e['id']} | {e['name']}"
    p=e['position']; dims=e['size']; shape=b['shape']
    data={"n":name,"m":e['materialId'],"p":[p[0]*S,p[1]*S,-p[2]*S],"s":[v*S for v in dims],"r":-e['rotation']*180/math.pi,"t":shape}
    # Join window bars between head and sill, avoiding coincident front faces.
    for suffix in [' left jamb',' right jamb',' mullion']:
        if e['name'].endswith(suffix):
            base=e['name'][:-len(suffix)]
            head=next((x for x in D['elements'] if x['name']==base+' head'),None)
            sill=next((x for x in D['elements'] if x['name']==base+' sill'),None)
            if head and sill:
                low=sill['position'][1]+sill['size'][1]/2+0.012
                high=head['position'][1]-head['size'][1]/2-0.012
                data['p'][1]=(high+low)*S/2
                data['s'][1]=(high-low)*S
    if shape=='mesh':
        verts=[list(v) for v in b['vertices']];faces=[list(f) for f in b['faces']]
        if b.get('solidify'):
            thick=b['solidify']; count=len(verts)
            verts += [[x,y+thick,z] for x,y,z in verts]
            f=faces[0];faces=[list(reversed(f)),[i+count for i in f]]+[[i,j,j+count,i+count] for i,j in zip(f,f[1:]+f[:1])]
        data['v']=[[x*S,z*S,-y*S] for x,y,z in verts]
        data['f']=[tri for f in faces for tri in triangulate(verts,f)]
    elif shape=='rod':
        a,bp=b['start'],b['end'];data['a']=[a[0]*S,a[2]*S,-a[1]*S];data['b']=[bp[0]*S,bp[2]*S,-bp[1]*S];data['rad']=b['radius']*S
    elif shape in ['tree','plant','shrub']:
        data['seed']=b['seed'];data['base']=b.get('base_z',0)*S
    data['rev']=b.get('revision',1)
    if e['id'] in WALL_PARTS:
        data['t']='joinedwall'
        data['parts']=[[[a[0]*S,a[1]*S] for a in p] for p in WALL_PARTS[e['id']]]
    return data


def dump(obj):
    return json.dumps(obj,separators=(',',':'),ensure_ascii=False)


MATERIALS = """unselect();
const mats = MATERIAL_DATA;
for (const m of mats) {
  createMaterial('PH26 '+m.id,{layers:[{type:'color',color:m.color},{type:'light',category:'physical',roughness:m.roughness,metalness:m.metalness}]});
}
updateMaterial('PH26 glass',{layers:[{type:'color',color:'#c4dcd1',alpha:0.2},{type:'transmission',alpha:1,roughness:0.04,ior:1.45,thickness:0.6}]});
updateMaterial('PH26 light',{layers:[{type:'light',category:'phong',emissive:'#ffe1a3'}]});
""".replace('MATERIAL_DATA',dump([{k:v for k,v in m.items() if k!='blender'} for m in D['materials']]))

BUILD = """const data = [
RECORDS
];
for (const q of data) {
  if (q.t === 'joinedwall') {
    const v=[];
    const tris=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    for (const b of q.parts) {
      const p=[[b[0][0],b[1][0],-b[2][1]],[b[0][1],b[1][0],-b[2][1]],[b[0][1],b[1][0],-b[2][0]],[b[0][0],b[1][0],-b[2][0]],[b[0][0],b[1][1],-b[2][1]],[b[0][1],b[1][1],-b[2][1]],[b[0][1],b[1][1],-b[2][0]],[b[0][0],b[1][1],-b[2][0]]];
      for (const t of tris) { for (const i of t) { v.push(p[i][0],p[i][1],p[i][2]); } }
    }
    customMesh({vertices:v});
    position({x:0,y:0,z:0});
    visibility({side:'double'});
  } else if (q.t === 'mesh') {
    const v = [];
    for (const f of q.f) { for (const i of f) { v.push(q.v[i][0],q.v[i][1],q.v[i][2]); } }
    customMesh({vertices:v});
    position({x:0,y:0,z:0});
  } else if (q.t === 'rod') {
    const dx=q.b[0]-q.a[0],dy=q.b[1]-q.a[1],dz=q.b[2]-q.a[2];
    const len=Math.sqrt(dx*dx+dy*dy+dz*dz);
    mesh('Cylinder',{radius:q.rad,height:len,cornerRadius:0});
    position({x:(q.a[0]+q.b[0])/2,y:(q.a[1]+q.b[1])/2,z:(q.a[2]+q.b[2])/2});
    rotation({x:Math.acos(dy/len)*180/Math.PI,y:Math.atan2(dx,dz)*180/Math.PI,z:0});
  } else if (q.t === 'tree' || q.t === 'plant' || q.t === 'shrub') {
    tree({kind:q.t==='tree' ? (q.seed%3===0 ? 'palm' : 'oak') : 'bush',height:q.s[1],seed:q.seed,leafiness:0.85,style:'realistic',trunkColor:'#78654c',leafColor:q.t==='tree'?'#526b43':'#6e8253',name:q.n,position:[q.p[0],q.base,q.p[2]]});
  } else {
    if (q.t === 'ellipsoid') { mesh('Sphere',{width:q.s[0],height:q.s[1],depth:q.s[2]}); }
    else if (q.t === 'cylinder') { mesh('Cylinder',{radius:q.s[0]/2,height:q.s[1],cornerRadius:0.4}); }
    else { mesh('Cube',{width:q.s[0],height:q.s[1],depth:q.s[2],cornerRadius:0}); }
    position({x:q.p[0],y:q.p[1],z:q.p[2]});
    rotation({x:0,y:q.r,z:0});
  }
  rename(q.n);
  if (q.t !== 'tree' && q.t !== 'plant' && q.t !== 'shrub') { applyMaterial('PH26 '+q.m); }
  moveInto('GROUP_NAME');
}
"""

groups=['10 Ground floor','20 Upper floor','30 Folded roof','21 Privacy screens','11 Ground interiors','22 Upper interiors','40 Site and hardscape','50 Tropical garden','60 Lighting']
native_groups={g:'PH26 '+g[3:] for g in groups}
manifest={"source":"project/design.json","unitsPerMetre":S,"coordinateMapping":"(east,up,north) -> (X,Y,-Z)","batches":[],"groups":native_groups}
init=MATERIALS+''.join("add('Empty');\nrename("+dump(native_groups[g])+");\nposition({x:0,y:0,z:0});\n" for g in groups)
(OUT/'00-materials-groups.js').write_text(init)
for group in groups:
    elements=[e for e in D['elements'] if e['blender']['group']==group]
    for part,start in enumerate(range(0,len(elements),40),1):
        portion=elements[start:start+40]
        filename=f"{group[:2]}-{group[3:].lower().replace(' ','-')}-{part}.js"
        code=BUILD.replace('RECORDS',',\n'.join(dump(record(e)) for e in portion)).replace('GROUP_NAME',native_groups[group])
        (OUT/filename).write_text(code)
        manifest['batches'].append({"file":filename,"group":group,"elements":len(portion),"sourceIds":[e['id'] for e in portion]})
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
fix=[e for e in D['elements'][:80] if e['id'] in WALL_PARTS]
names=[record(e)['n'] for e in fix]
repair='const names='+dump(names)+";\nselect(o => names.includes(o.name));\nremove();\n"+BUILD.replace('RECORDS',',\n'.join(dump(record(e)) for e in fix)).replace('GROUP_NAME',native_groups['10 Ground floor'])
(OUT/'01-joints.js').write_text(repair)
print(f"Wrote material/group setup and {len(manifest['batches'])} bounded batches for {sum(b['elements'] for b in manifest['batches'])} source elements.")
