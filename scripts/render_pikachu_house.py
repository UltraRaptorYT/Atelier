"""Compile project/design.json into a native, organized Blender scene.

Execute build() through Blender MCP. Render views separately so Blender stays
responsive between operations. No third-party textures or model assets needed.
"""
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector, Quaternion

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'project'/'output'
OUT.mkdir(parents=True,exist_ok=True)
SCENE_NAME='Pikachu House | Folded Light'
MAT={}
COL={}
SCENE=None


def linear(color):
    rgb=[int(color[i:i+2],16)/255 for i in (1,3,5)]
    return [c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]


def collection(name):
    if name not in COL:
        c=bpy.data.collections.new(name)
        SCENE.collection.children.link(c)
        COL[name]=c
    return COL[name]


def link(obj,group):
    collection(group).objects.link(obj)
    return obj


def make_material(spec):
    m=bpy.data.materials.new('PH | '+spec['name'])
    m.use_nodes=True
    m.diffuse_color=(*linear(spec['color']),1)
    n=m.node_tree.nodes; links=m.node_tree.links
    p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*linear(spec['color']),1)
    p.inputs['Roughness'].default_value=spec['roughness']
    p.inputs['Metallic'].default_value=spec['metalness']
    ext=spec.get('blender',{})
    if ext.get('transmission'):
        p.inputs['Transmission Weight'].default_value=ext['transmission']
        p.inputs['IOR'].default_value=1.46
    if ext.get('emission'):
        p.inputs['Emission Color'].default_value=(*linear(spec['color']),1)
        p.inputs['Emission Strength'].default_value=ext['emission']
    if ext.get('texture'):
        tex=n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=5
        tex.inputs['Detail'].default_value=3
        coord=n.new('ShaderNodeTexCoord')
        mapping=n.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
        scales={'wood':(3,55,4),'stone':(8,8,8),'plaster':(90,90,90),'fabric':(130,130,130),'grass':(3,3,3)}
        mapping.inputs[1].default_value=scales[ext['texture']]
        links.new(coord.outputs['Generated'],mapping.inputs[0]); links.new(mapping.outputs[0],tex.inputs[0])
        ramp=n.new('ShaderNodeValToRGB')
        rgb=linear(spec['color'])
        ramp.color_ramp.elements[0].position=.12
        ramp.color_ramp.elements[0].color=(*[c*.78 for c in rgb],1)
        ramp.color_ramp.elements[1].position=.87
        ramp.color_ramp.elements[1].color=(*[min(1,c*1.11) for c in rgb],1)
        links.new(tex.outputs['Fac'],ramp.inputs[0]); links.new(ramp.outputs[0],p.inputs['Base Color'])
        bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.12
        bump.inputs['Distance'].default_value=.025 if ext['texture']=='grass' else .012
        links.new(tex.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs[0],p.inputs['Normal'])
    MAT[spec['id']]=m
    return m


def mesh_obj(name,vertices,faces,mat,group):
    data=bpy.data.meshes.new(name)
    data.from_pydata(vertices,[],faces); data.update()
    obj=bpy.data.objects.new(name,data)
    link(obj,group)
    obj.data.materials.append(MAT[mat])
    return obj


def simple_box(name,dims,mat,group):
    x,y,z=[d/2 for d in dims]
    vs=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    return mesh_obj(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,group)


def cylinder_mesh(start,end,radius,verts,faces,steps=10,r2=None):
    a,b=Vector(start),Vector(end); axis=(b-a).normalized()
    u=axis.cross(Vector((0,0,1)))
    if u.length<.01: u=axis.cross(Vector((0,1,0)))
    u.normalize(); v=axis.cross(u)
    offset=len(verts)
    for pt,r in [(a,radius),(b,r2 if r2 is not None else radius)]:
        for i in range(steps): verts.append(tuple(pt+r*(math.cos(i*math.tau/steps)*u+math.sin(i*math.tau/steps)*v)))
    faces.extend([tuple(offset+i for i in reversed(range(steps))),tuple(offset+steps+i for i in range(steps))])
    for i in range(steps): faces.append((offset+i,offset+(i+1)%steps,offset+(i+1)%steps+steps,offset+i+steps))


def vegetation(e,loc,dims):
    ex=e['blender']; rng=random.Random(ex['seed']); group=ex['group']; typ=ex['shape']
    vs=[]; fs=[]; trunkv=[]; trunkf=[]
    if typ=='tree':
        height=ex['height']; r=ex['radius']; base=ex['base_z']
        trunk=(loc[0],loc[1],base)
        fork=(loc[0]+.12,loc[1]-.08,base+height*.56)
        cylinder_mesh(trunk,fork,.10,trunkv,trunkf,12,.055)
        clusters=[]
        for i in range(9):
            ang=i*math.tau/9+.5
            p=Vector((loc[0]+math.cos(ang)*r*rng.uniform(.4,.85),loc[1]+math.sin(ang)*r*rng.uniform(.4,.85),base+height*rng.uniform(.67,.91)))
            cylinder_mesh(fork,p,.043,trunkv,trunkf,8,.009)
            clusters.append(p)
        for p in clusters:
            for j in range(120):
                theta=rng.random()*math.tau; rr=math.sqrt(rng.random())*r*.60
                center=p+Vector((math.cos(theta)*rr,math.sin(theta)*rr,rng.uniform(-.45,.5)))
                ang=rng.random()*math.tau; length=rng.uniform(.13,.29); width=length*.38
                u=Vector((math.cos(ang),math.sin(ang),rng.uniform(-.4,.6))).normalized()*length
                v=Vector((-math.sin(ang),math.cos(ang),0))*width
                k=len(vs)
                vs.extend([tuple(center-u),tuple(center+v),tuple(center+u),tuple(center-v),tuple(center+Vector((0,0,.028)))])
                fs.extend([(k,k+1,k+4),(k+1,k+2,k+4),(k+2,k+3,k+4),(k+3,k,k+4)])
    elif typ=='plant':
        scale=dims[2]/1.1; base=ex['base_z']; origin=Vector((loc[0],loc[1],base))
        for i in range(14):
            ang=i*2.399; length=rng.uniform(.65,1.25)*scale
            direction=Vector((math.cos(ang),math.sin(ang),0))
            widthvec=Vector((-math.sin(ang),math.cos(ang),0))
            reach=rng.uniform(.45,.85)*scale; ht=rng.uniform(.55,1.2)*scale
            center=origin+direction*reach*.35+Vector((0,0,ht*.55))
            cylinder_mesh(origin,center,.009*scale,trunkv,trunkf,6,.004*scale)
            k=len(vs)
            for j in range(7):
                t=j/6
                p=origin+direction*(reach*t)+Vector((0,0,ht*math.sin(t*1.6)))
                w=math.sin(math.pi*t)*.16*scale
                vs.extend([tuple(p-widthvec*w),tuple(p+Vector((0,0,.024*scale))),tuple(p+widthvec*w)])
            for j in range(6):
                for side in range(2):
                    a=k+j*3+side; fs.append((a,a+3,a+4,a+1))
    else:
        for j in range(300):
            theta=rng.random()*math.tau; rr=math.sqrt(rng.random())
            p=Vector((loc[0]+math.cos(theta)*rr*dims[0]/2,loc[1]+math.sin(theta)*rr*dims[1]/2,loc[2]+rng.uniform(-.2,.5)*dims[2]))
            a=rng.random()*math.tau; u=Vector((math.cos(a),math.sin(a),.25))*.11; v=Vector((-math.sin(a),math.cos(a),0))*.055
            k=len(vs); vs.extend([tuple(p-u),tuple(p+v),tuple(p+u),tuple(p-v)]); fs.append((k,k+1,k+2,k+3))
    leaves=mesh_obj(e['name'],vs,fs,e['materialId'],group)
    leaves.data.materials.append(MAT['leaf_light'])
    for p in leaves.data.polygons: p.material_index=1 if rng.random()<.25 else 0; p.use_smooth=True
    if trunkv:
        trunk=mesh_obj(e['name']+' stems',trunkv,trunkf,'timber_dark',group)
        trunk['atelier_source_id']=e['id']
        for p in trunk.data.polygons:p.use_smooth=True
    return leaves


def compile_element(e):
    ex=e['blender']; group=ex['group']; shape=ex['shape']
    p=e['position']; loc=(p[0],p[2],p[1]); s=e['size']; dims=(s[0],s[2],s[1])
    if shape in ['tree','plant','shrub']:
        obj=vegetation(e,loc,dims)
    elif shape=='mesh':
        obj=mesh_obj(e['name'],ex['vertices'],ex['faces'],e['materialId'],group)
        if ex.get('solidify'):
            mod=obj.modifiers.new('Solid roof gable infill','SOLIDIFY'); mod.thickness=ex['solidify']
    elif shape=='rod':
        vs=[];fs=[];cylinder_mesh(ex['start'],ex['end'],ex['radius'],vs,fs,12)
        obj=mesh_obj(e['name'],vs,fs,e['materialId'],group)
        for poly in obj.data.polygons:poly.use_smooth=True
    elif shape=='ellipsoid':
        vs=[];fs=[];n=24;m=12
        for j in range(m+1):
            th=math.pi*j/m
            for i in range(n):
                a=i*math.tau/n
                vs.append((math.sin(th)*math.cos(a)*dims[0]/2,math.sin(th)*math.sin(a)*dims[1]/2,math.cos(th)*dims[2]/2))
        for j in range(m):
            for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
        obj=mesh_obj(e['name'],vs,fs,e['materialId'],group);obj.location=loc
        for poly in obj.data.polygons:poly.use_smooth=True
    elif shape=='cylinder':
        vs=[];fs=[];cylinder_mesh((0,0,-dims[2]/2),(0,0,dims[2]/2),dims[0]/2,vs,fs,32)
        obj=mesh_obj(e['name'],vs,fs,e['materialId'],group);obj.location=loc
        obj.scale.y=dims[1]/dims[0]
    else:
        obj=simple_box(e['name'],dims,e['materialId'],group);obj.location=loc
    obj['atelier_source_id']=e['id'];obj['floor']=e['floor'];obj['kind']=e['kind']
    obj['overhead']=ex.get('overhead',False);obj['revision']=ex.get('revision',1)
    obj.rotation_euler.z=ex.get('rotation_z',-e['rotation'])
    if shape in ['box','cylinder']:
        width=min(ex.get('bevel',.015),min(dims)*.22)
        if width:
            bevel=obj.modifiers.new('Crafted edges','BEVEL');bevel.width=width;bevel.segments=3
            norm=obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');norm.keep_sharp=True
    return obj


def camera(name,location,target,lens=40,ortho=None):
    data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data)
    link(obj,'80 Cameras');obj.location=location
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    data.lens=lens;data.clip_start=.05;data.clip_end=400
    if ortho:data.type='ORTHO';data.ortho_scale=ortho
    return obj


def light(name,location,target,energy,size,color=(1,.88,.73)):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);link(obj,'70 Render lighting');obj.location=location
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def label(body,loc,size,group):
    data=bpy.data.curves.new(body,'FONT');data.body=body;data.size=size;data.align_x='CENTER';data.align_y='CENTER';data.space_line=1.3
    obj=bpy.data.objects.new(body,data);link(obj,group);obj.location=loc;obj.data.materials.append(MAT['ink'])
    return obj


def build(path=None):
    global SCENE,COL,MAT
    path=Path(path or ROOT/'project'/'design.json');d=json.loads(path.read_text())
    old=bpy.data.scenes.get(SCENE_NAME)
    if old:old.name=SCENE_NAME+' | previous build'
    SCENE=bpy.data.scenes.new(SCENE_NAME);bpy.context.window.scene=SCENE
    COL={};MAT={}
    SCENE.unit_settings.system='METRIC';SCENE.unit_settings.length_unit='METERS'
    SCENE['canonical_design']=str(path);SCENE['design_revision']=d['blender']['revision']
    for m in d['materials']:make_material(m)
    for e in d['elements']:compile_element(e)
    world=bpy.data.worlds.new('PH | Tropical morning');world.use_nodes=True;SCENE.world=world
    n=world.node_tree.nodes;links=world.node_tree.links
    sky=n.new('ShaderNodeTexSky')
    sky_types={i.identifier for i in sky.bl_rna.properties['sky_type'].enum_items}
    sky.sky_type='MULTIPLE_SCATTERING' if 'MULTIPLE_SCATTERING' in sky_types else 'NISHITA'
    sky.sun_elevation=math.radians(34);sky.sun_rotation=math.radians(135);sky.air_density=1.1
    links.new(sky.outputs[0],n.get('Background').inputs[0]);n.get('Background').inputs['Strength'].default_value=.24
    backdrop=n.new('ShaderNodeBackground');backdrop.inputs[0].default_value=(.72,.74,.70,1);backdrop.inputs[1].default_value=2.5
    lightpath=n.new('ShaderNodeLightPath');mix=n.new('ShaderNodeMixShader')
    links.new(lightpath.outputs['Is Camera Ray'],mix.inputs[0]);links.new(n.get('Background').outputs[0],mix.inputs[1]);links.new(backdrop.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],n.get('World Output').inputs['Surface'])
    sun_data=bpy.data.lights.new('PH | Morning sun','SUN');sun_data.energy=2.0;sun_data.angle=math.radians(7)
    sun=bpy.data.objects.new('PH | Morning sun',sun_data);link(sun,'70 Render lighting');sun.rotation_euler=(math.radians(28),math.radians(-35),math.radians(-35))
    light('Large soft sky bounce',(1,-12,12),(0,0,2),1900,12,(.85,.93,1))
    light('Living bounce',(-2,1,2.95),(-2,1,0),170,4)
    light('Kitchen bounce',(5,-1,2.95),(5,-1,0),110,2)
    light('Upper lounge bounce',(2,1,6.1),(2,1,3.5),140,3)
    light('Entrance wash',(-.8,-7.5,2.9),(-.8,-7.1,1.1),70,2)
    for c in d['blender']['cameras']:camera(c['name'],c['position'],c['target'],c['lens'])
    camera('Site plan',(0,0,42),(0,0,0),ortho=37)
    camera('Ground floor plan',(0,-2,32),(0,-2,0),ortho=19.5)
    camera('Upper floor plan',(0,-2,32),(0,-2,0),ortho=19.5)
    for r in d['blender']['rooms']:
        x0,y0,x1,y1=r['bounds'];g='91 Ground labels' if r['floor']==0 else '92 Upper labels'
        title=r['name'].upper().replace(' / ',' /\n')
        text=title+f"\n{r['area']:g} m²"
        size=.22 if len(r['name'])<19 else .18
        label(text,((x0+x1)/2,(y0+y1)/2,3.28 if r['floor']==0 else 6.6),size,g)
    for floor,g in [(0,'91 Ground labels'),(1,'92 Upper labels')]:
        z=3.28 if floor==0 else 6.6
        label('GROUND FLOOR  /  164.4 m²' if floor==0 else 'UPPER FLOOR  /  155.6 m²',(0,-9.0,z),.36,g)
        label('N  ↑',(8.4,3.2,z),.36,g)
        label('15.00 m',(0,4.7,z),.22,g)
        label('12.00 m',(8.4,-2,z),.22,g)
        label('FOLDED LIGHT  /  PIKACHU HOUSE  /  CONCEPT V2',(0,-9.65,z),.16,g)
    label('JOO CHIAT  /  HYPOTHETICAL 20 × 30 m SITE',(0,-16.4,.12),.37,'93 Site labels')
    label('N  ↑',(8,12,6.5),.6,'93 Site labels')
    label('CONNECTED FAMILY GARDEN',(.2,10.8,6.5),.29,'93 Site labels')
    label('STREET  /  SOUTH',(0,-17.5,.12),.26,'93 Site labels')
    SCENE.render.engine='CYCLES';SCENE.cycles.samples=48;SCENE.cycles.use_denoising=True
    prefs=bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type='METAL';prefs.get_devices()
        for device in prefs.devices:device.use=(device.type=='METAL')
        SCENE.cycles.device='GPU'
    except Exception:SCENE.cycles.device='CPU'
    SCENE.cycles.max_bounces=8;SCENE.cycles.transparent_max_bounces=8
    SCENE.render.resolution_x=1600;SCENE.render.resolution_y=1100;SCENE.render.resolution_percentage=100
    SCENE.render.image_settings.file_format='PNG';SCENE.render.film_transparent=False
    SCENE.view_settings.view_transform='AgX';SCENE.view_settings.look='AgX - Medium High Contrast';SCENE.view_settings.exposure=-1.4
    for c in COL.values():
        if c.name.startswith(('91 ','92 ','93 ')):c.hide_render=True;c.hide_viewport=True
    SCENE.camera=next(o for o in SCENE.objects if o.type=='CAMERA' and o.name.startswith('Street perspective'))
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
                area.spaces.active.overlay.show_overlays=False
                area.spaces.active.shading.type='MATERIAL'
    for o in SCENE.objects:o.select_set(False)
    bpy.context.view_layer.objects.active=None
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'pikachu-house-v2.blend'))
    print(json.dumps({'saved':str(OUT/'pikachu-house-v2.blend'),'objects':len(SCENE.objects),'source_elements':len(d['elements']),'device':SCENE.cycles.device}))
    return SCENE


def render(view='Street perspective',filename=None,width=1600,height=1100,samples=48,revision=2):
    scene=bpy.data.scenes.get(SCENE_NAME);bpy.context.window.scene=scene
    scene.camera=next(o for o in scene.objects if o.type=='CAMERA' and o.name.startswith(view))
    hidden_objs={o:o.hide_render for o in scene.objects}
    hidden_cols={c:(c.hide_render,c.hide_viewport) for c in scene.collection.children}
    prevengine=scene.render.engine
    prevview=(scene.view_settings.view_transform,scene.view_settings.look,scene.view_settings.exposure)
    try:
        for o in scene.objects:
            if o.get('revision',1)>revision:o.hide_render=True
        is_plan='plan' in view
        if is_plan:
            scene.render.engine='BLENDER_WORKBENCH'
            scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0
            scene.display.shading.light='FLAT';scene.display.shading.studiolight_rotate_z=0
            scene.display.shading.color_type='MATERIAL';scene.display.shading.show_shadows=False
            scene.display.shading.show_cavity=True;scene.display.shading.cavity_type='BOTH'
            scene.display.shading.show_object_outline=True;scene.display.shading.object_outline_color=(.08,.13,.11)
            scene.display.shading.background_type='WORLD';scene.world.color=(.89,.90,.87)
            for c in scene.collection.children:
                name=c.name
                if view=='Ground floor plan':
                    hide=name.startswith(('20 ','21 ','22 ','30 ','50 ','92 ','93 '))
                elif view=='Upper floor plan':
                    hide=name.startswith(('11 ','30 ','50 ','91 ','93 '))
                else:hide=name.startswith(('91 ','92 '))
                c.hide_render=hide;c.hide_viewport=hide
            for o in scene.objects:
                if view!='Site plan' and (o.get('overhead') or o.name.startswith('Car')):o.hide_render=True;o.hide_set(True)
                if view=='Upper floor plan' and any(c.name.startswith('10 ') for c in o.users_collection) and not o.name.startswith('Stair'):
                    o.hide_render=True;o.hide_set(True)
            for c in scene.collection.children:
                if (view=='Ground floor plan' and c.name.startswith('91 ')) or (view=='Upper floor plan' and c.name.startswith('92 ')) or (view=='Site plan' and c.name.startswith('93 ')):
                    c.hide_render=False;c.hide_viewport=False
        scene.render.resolution_x=width;scene.render.resolution_y=height;scene.cycles.samples=samples
        scene.render.filepath=str(OUT/(filename or view.lower().replace(' ','-')+'.png'))
        bpy.ops.render.render(write_still=True)
        print(json.dumps({'render':scene.render.filepath,'view':view}))
    finally:
        scene.render.engine=prevengine
        scene.view_settings.view_transform=prevview[0];scene.view_settings.look=prevview[1];scene.view_settings.exposure=prevview[2]
        for o,hidden in hidden_objs.items():o.hide_render=hidden;o.hide_set(False)
        for c,(hr,hv) in hidden_cols.items():c.hide_render=hr;c.hide_viewport=hv
        scene.camera=next(o for o in scene.objects if o.type=='CAMERA' and o.name.startswith('Street perspective'))


if __name__=='__main__':
    build()
