"""Author a versioned, metric concept model in Atelier's canonical JSON format.

The optional per-element `blender` extension adds mesh/curve/plant primitives.
Coordinates in the canonical contract are X east, Y up, Z north, in metres.
"""
import copy
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'project'
OUT.mkdir(exist_ok=True)
(OUT / 'versions').mkdir(exist_ok=True)
E = []
M = []
ROOMS = []
GROUP = '10 Ground floor'


def material(key, name, color, rough=.55, metal=0, **extra):
    M.append(dict(id=key, name=name, color=color, roughness=rough, metalness=metal, blender=extra))


material('plaster', 'Warm ivory mineral plaster', '#EAE6DA', .8, texture='plaster')
material('concrete', 'Honed warm limestone', '#C6C3B3', .72, texture='stone')
material('yellow', 'Ochre yellow enamel', '#EDB829', .36)
material('timber', 'Pale oak and tropical timber', '#BF9466', .5, texture='wood')
material('timber_dark', 'End grain / warm cedar', '#866248', .62, texture='wood')
material('roof', 'Graphite standing seam aluminium', '#343C3A', .37, .5)
material('frame', 'Bronze black window frames', '#333D39', .34, .65)
material('glass', 'Clear low tint glazing', '#D4E5DD', .08, transmission=1)
material('linen', 'Natural linen upholstery', '#E3DCCB', .95, texture='fabric')
material('sage', 'Soft sage upholstery', '#8F9C83', .92, texture='fabric')
material('clay', 'Terracotta accent', '#A85B41', .75)
material('ceramic', 'Off white ceramic', '#F2EEE4', .22)
material('water', 'Reflective water', '#6EAAA1', .08, transmission=.6)
material('lawn', 'Garden groundcover', '#73885C', .95, texture='grass')
material('leaf', 'Tropical foliage', '#486846', .82)
material('leaf_light', 'Young foliage', '#759353', .85)
material('soil', 'Planting soil', '#574C3B', .95)
material('gravel', 'Pale gravel', '#BDBAAF', .92, texture='stone')
material('asphalt', 'Street', '#626866', .98, texture='stone')
material('ink', 'Drawing ink', '#283B36', .8)
material('light', 'Warm diffused lighting', '#FFE5B0', .3, emission=4)


def add(name, loc, size, mat, kind='asset', shape='box', floor=0, group=None, **extra):
    ident = 'ph_' + str(len(E)).zfill(4)
    # Authoring helpers use Blender XYZ, serialize to canonical X-upY-northZ.
    E.append(dict(id=ident, kind=kind, name=name, position=[loc[0], loc[2], loc[1]],
                  size=[size[0], size[2], size[1]], rotation=0, materialId=mat,
                  floor=floor, assetId=None,
                  blender=dict(group=group or GROUP, shape=shape, **extra)))
    return E[-1]


def box(name, a, b, mat='plaster', kind='wall', **kw):
    return add(name, [(a[i]+b[i])/2 for i in range(3)], [b[i]-a[i] for i in range(3)], mat, kind, **kw)


def mesh(name, verts, faces, mat, kind='asset', **kw):
    lo = [min(v[i] for v in verts) for i in range(3)]
    hi = [max(v[i] for v in verts) for i in range(3)]
    return add(name, [(a+b)/2 for a,b in zip(lo,hi)], [max(.01,b-a) for a,b in zip(lo,hi)], mat, kind,
               shape='mesh', vertices=verts, faces=faces, **kw)


def slab(name, poly, bottom, top, mat='concrete', **kw):
    n = len(poly)
    vs = [(x,y,z) for z in (bottom,top) for x,y in poly]
    fs = [list(reversed(range(n))), list(range(n,2*n))]
    fs += [[i,(i+1)%n,(i+1)%n+n,i+n] for i in range(n)]
    return mesh(name,vs,fs,mat,'slab',**kw)


def rod(name, start, end, radius=.025, mat='frame', **kw):
    lo = [min(a,b)-radius for a,b in zip(start,end)]
    hi = [max(a,b)+radius for a,b in zip(start,end)]
    return add(name,[(a+b)/2 for a,b in zip(lo,hi)],[b-a for a,b in zip(lo,hi)],mat,
               shape='rod',start=start,end=end,radius=radius,**kw)


def wall(name, axis, c, a, b, z0, z1, openings=(), mat='plaster', thick=.2, floor=0):
    """Split around real rectangular openings; no hidden solid walls behind glass."""
    cuts = sorted(set([a,b]+[v for op in openings for v in op[:2]]))
    for i,(u,v) in enumerate(zip(cuts,cuts[1:])):
        opening = next((o for o in openings if o[0] <= (u+v)/2 <= o[1]), None)
        bands = [(z0,z1)] if not opening else [(z0,opening[2]),(opening[3],z1)]
        for j,(low,high) in enumerate(bands):
            if high-low < .01: continue
            p0,p1 = ((u,c-thick/2,low),(v,c+thick/2,high)) if axis=='x' else ((c-thick/2,u,low),(c+thick/2,v,high))
            box(f'{name} {i}.{j}',p0,p1,mat,floor=floor,overhead=bool(opening and j==1))


def window(name, axis, c, a, b, low, high, panels=3, floor=0, open_center=False):
    """Mullions and glass occupy the openings declared in the wall helper."""
    def part(label,u,v,z0,z1,mat,depth):
        p0,p1 = ((u,c-depth/2,z0),(v,c+depth/2,z1)) if axis=='x' else ((c-depth/2,u,z0),(c+depth/2,v,z1))
        return box(name+' '+label,p0,p1,mat,'window',floor=floor,bevel=.006)
    part('head',a,b,high-.065,high,'frame',.12)
    part('sill',a,b,low,low+.055,'frame',.12)
    part('left jamb',a,a+.055,low,high,'frame',.12)
    part('right jamb',b-.055,b,low,high,'frame',.12)
    for i in range(panels):
        u=a+(b-a)*i/panels; v=a+(b-a)*(i+1)/panels
        if open_center and 0<i<panels-1: continue
        if i: part('mullion',u-.025,u+.025,low,high,'frame',.09)
        part('glass',u+.03,v-.03,low+.06,high-.065,'glass',.015)


def door(name, axis, c, a, b, z=.18, floor=0, mat='timber', angle=0):
    width=b-a
    if axis=='x':
        leaf=add(name,((a+b)/2,c,z+1.18),(width,.055,2.36),mat,'door',floor=floor,bevel=.008)
    else:
        leaf=add(name,(c,(a+b)/2,z+1.18),(.055,width,2.36),mat,'door',floor=floor,bevel=.008)
    if angle: leaf['blender']['rotation_z']=angle


def room(name, bounds, floor, area=None):
    x0,y0,x1,y1=bounds
    z=.18 if floor==0 else 3.42
    ROOMS.append(dict(name=name,bounds=bounds,floor=floor,area=round(area or (x1-x0)*(y1-y0),2)))


# The roof, covered terrace and entry remain inside a 15 x 12 m projection.
ground_outline=[(-7.5,-8),(-3.1,-8),(-3.1,-7.2),(1.4,-7.2),(1.4,-8),(7.5,-8),(7.5,1),(3.5,1),(3.5,4),(-7.5,4)]
slab('Ground enclosed floor | 164.40 m2',ground_outline,-.04,.18)
box('Covered entry paving',(-3.1,-8,-.04),(1.4,-7.2,.18),'concrete','slab')
box('Covered garden room | 12 m2',(3.5,1,-.04),(7.5,4,.18),'timber','slab')
box('Ground ceiling west',(-7.5,-8,3.19),(-1.65,4,3.21),'plaster','slab',overhead=True)
box('Ground ceiling east',(-.05,-8,3.19),(7.5,4,3.21),'plaster','slab',overhead=True)
box('Ground ceiling south of stair',(-1.65,-8,3.19),(-.05,-3.8,3.21),'plaster','slab',overhead=True)
box('Ground ceiling north of stair',(-1.65,.2,3.19),(-.05,4,3.21),'plaster','slab',overhead=True)
wall('South guest facade','x',-7.9,-7.5,-3.1,.18,3.2,[(-6.8,-4.0,1.05,2.65)])
window('Guest street window','x',-7.91,-6.8,-4.,1.05,2.65)
wall('South study facade','x',-7.9,1.4,7.5,.18,3.2,[(4.1,6.9,1.05,2.65)])
window('Study street window','x',-7.91,4.1,6.9,1.05,2.65)
wall('Recessed yellow entrance','x',-7.1,-3.1,1.4,.18,3.2,[(-2.65,-1.7,.38,2.8),(-1.5,-.25,.18,2.8)],'yellow')
door('Entry pivot door','x',-7.14,-1.5,-.25)
window('Entry sidelight','x',-7.15,-2.65,-1.7,.38,2.8,panels=1)
wall('Entry west return','y',-3.2,-8,-7.0,.18,3.2,mat='yellow')
wall('Entry east return','y',1.5,-8,-7.0,.18,3.2,mat='yellow')
box('Entry oak canopy',(-3.1,-8,2.98),(1.4,-7.2,3.2),'timber','roof',overhead=True)
wall('West privacy wall','y',-7.4,-8,4,.18,3.2,[(-2.7,-1.3,2.3,2.85)])
window('Shower high level window','y',-7.41,-2.7,-1.3,2.3,2.85,panels=2)
wall('East service wall','y',7.4,-8,1,.18,3.2,[(-3.5,-.3,2.25,2.85)])
window('Kitchen high level window','y',7.41,-3.5,-.3,2.25,2.85,panels=4)
wall('Garden living facade','x',3.9,-7.5,3.5,.18,3.2,[(-6.9,2.9,.18,2.95)])
window('Living garden sliding wall','x',3.91,-6.9,2.9,.18,2.95,panels=5,open_center=True)
wall('Living to covered threshold','y',3.4,1,4,.18,3.2,[(1.3,3.65,.18,2.95)])
window('Living threshold slider','y',3.41,1.3,3.65,.18,2.95,panels=3,open_center=True)
wall('Kitchen to threshold','x',.9,3.5,7.5,.18,3.2,[(4.,6.9,.18,2.95)])
window('Kitchen terrace doors','x',.91,4.,6.9,.18,2.95,panels=3,open_center=True)
for x,y in [(7.36,3.85),(7.36,1.15)]:
    add('Garden threshold column',(x,y,1.69),(.14,.14,3.02),'frame','wall')

# Partition lines and opening schedule.
wall('Guest east partition','y',-3.2,-7.2,-3.2,.18,3.2,[(-6.35,-5.25,.18,2.6)],thick=.2)
wall('Guest north partition','x',-3.2,-7.3,-3.1,.18,3.2,thick=.2)
door('Guest bedroom door','y',-3.2,-6.35,-5.25,angle=.8)
wall('Shower east partition','y',-4.7,-3.1,-.6,.18,3.2,[(-2.85,-1.75,.18,2.6)],thick=.2)
wall('Shower north partition','x',-.6,-7.3,-4.6,.18,3.2,thick=.2)
door('Entry level shower door','y',-4.7,-2.85,-1.75,angle=-.65)
wall('Utility west partition','y',1.5,-7.2,-4.1,.18,3.2,[(-6.5,-5.6,.18,2.6)])
wall('Study west partition','y',3.8,-7.8,-4.1,.18,3.2,thick=.2)
wall('Study north partition','x',-4.1,3.7,7.3,.18,3.2,[(4.05,5.0,.18,2.6)],thick=.2)
door('Study door','x',-4.1,4.05,5.0,angle=.7)
wall('Utility north partition','x',-4.1,1.4,3.8,.18,3.2,thick=.2)
wall('Powder east partition','y',3.0,-3.9,-2.2,.18,3.2,thick=.15)
wall('Powder north partition','x',-2.2,1.5,3.1,.18,3.2,[(1.7,2.6,.18,2.6)],thick=.15)
wall('Powder west partition','y',1.5,-4.1,-2.2,.18,3.2,thick=.15)
door('Powder door','x',-2.2,1.7,2.6,angle=.65)

room('Guest bedroom',(-7.3,-7.8,-3.3,-3.3),0)
room('Entry level shower',(-7.3,-3.0,-4.8,-.7),0)
room('Study',(3.9,-7.8,7.3,-4.2),0)
room('Kitchen',(3.5,-4.0,7.3,.8),0)
room('Laundry / pantry',(1.6,-7.2,3.7,-4.2),0)
room('Powder',(1.6,-4.,2.9,-2.3),0)
room('Living / dining',(-7.3,-.5,3.3,3.8),0)
room('Covered garden room',(3.5,1,7.5,4),0)

# 18 rises of 180 mm; stair headroom opening starts above the fourth tread.
for i in range(18):
    y=-4.84+i*.28
    box(f'Stair tread {i+1:02d}',(-1.45,y,.18),(-.25,y+.28,.18+(i+1)*.18),'timber','stair',bevel=.008)
rod('Stair handrail west',(-1.5,-4.84,1.1),(-1.5,.2,4.34),.035,'timber_dark')
rod('Stair handrail east',(-.2,-4.84,1.1),(-.2,.2,4.34),.035,'timber_dark')
for i in range(0,18,2):
    y=-4.70+i*.28; z=.18+(i+1)*.18
    for x in [-1.5,-.2]: rod('Stair baluster',(x,y,z),(x,y,z+.92),.016)

GROUP='20 Upper floor'
# 162 m2 outer upper plate, minus a 1.6 x 4.0 m stair void = 155.6 m2.
for name,a,b in [
 ('Upper west slab',(-7.5,-8,3.2),(-1.65,4,3.42)),
 ('Upper east slab',(-.05,-8,3.2),(6,4,3.42)),
 ('Upper south slab',(-1.65,-8,3.2),(-.05,-3.8,3.42)),
 ('Upper north landing',(-1.65,.2,3.2),(-.05,4,3.42))]:
    box(name,a,b,'timber','slab',floor=1)
box('Screened east terrace | outside GFA',(6,-8,3.2),(7.5,4,3.42),'timber','slab',floor=1)
wall('Upper south','x',-7.9,-7.5,6,3.42,6.3,[(-6.8,-2.8,4.15,5.95),(.4,5.4,3.95,5.95)],floor=1)
window('Child screened window','x',-7.91,-6.8,-2.8,4.15,5.95,panels=4,floor=1)
window('Hobby room window','x',-7.91,.4,5.4,3.95,5.95,panels=4,floor=1)
wall('Upper north','x',3.9,-7.5,6,3.42,6.3,[(-6.8,-2.8,4.05,6.05),(.35,5.55,3.65,6.05)],floor=1)
window('Primary garden window','x',3.91,-6.8,-2.8,4.05,6.05,panels=4,floor=1)
window('Family lounge garden window','x',3.91,.35,5.55,3.65,6.05,panels=4,floor=1)
wall('Upper solid west side','y',-7.4,-8,4,3.42,6.64,floor=1)
wall('Upper east terrace facade','y',5.9,-8,4,3.42,6.82,[(-6.6,-5.5,3.42,5.95),(.4,2.8,3.42,6.1)],floor=1)
window('Lounge to screened terrace','y',5.91,.4,2.8,3.42,6.1,panels=3,floor=1)
door('Upper terrace access','y',5.91,-6.6,-5.5,3.42,floor=1)
wall('Private wing east wall','y',-2.2,-7.8,3.8,3.42,6.35,[(-5.2,-4.2,3.42,5.82),(1.6,2.6,3.42,5.82)],floor=1)
wall('Child north wall','x',-3.7,-7.3,-2.3,3.42,6.35,floor=1)
wall('Primary south wall','x',-1.9,-7.3,-2.3,3.42,6.35,[(-6.6,-5.65,3.42,5.82)],floor=1)
wall('Ensuite east wall','y',-4.1,-3.6,-2.,3.42,6.35,floor=1)
door('Child bedroom door','y',-2.2,-5.2,-4.2,3.42,floor=1,angle=.65)
door('Primary bedroom door','y',-2.2,1.6,2.6,3.42,floor=1,angle=-.65)
door('Ensuite pocket door','x',-1.9,-6.6,-5.65,3.42,floor=1)
wall('Shared bath west','y',2.85,-4.55,-1.5,3.42,6.35,[(-3.5,-2.55,3.42,5.82)],floor=1)
wall('Shared bath south','x',-4.6,2.75,5.8,3.42,6.35,floor=1)
wall('Shared bath north','x',-1.45,2.75,5.8,3.42,6.35,floor=1)
door('Upper bathroom door','y',2.85,-3.5,-2.55,3.42,floor=1,angle=.6)
wall('Hobby gallery north','x',-4.6,.1,2.85,3.42,6.35,[(.45,1.55,3.42,5.82)],floor=1)
for x in [-1.65,-.05]:
    rod('Upper stair guard top',(x,-3.8,4.45),(x,.2,4.45),.035,'timber_dark',floor=1)
    for i in range(27):
        y=-3.8+i*.15
        rod('Upper stair guard spindle',(x,y,3.42),(x,y,4.43),.014,floor=1)
# Independent ceilings close all bedrooms, including the spaces above partitions.
for name,a,b in [('Child private ceiling',(-7.5,-8,6.3),(-2.1,-3.6,6.4)),
                 ('Primary private ceiling',(-7.5,-2,6.3),(-2.1,4,6.4)),
                 ('Ensuite ceiling',(-7.5,-3.8,6.3),(-2.1,-1.8,6.4)),
                 ('Shared bathroom ceiling',(2.75,-4.7,6.3),(6,-1.35,6.4))]:
    box(name,a,b,'plaster','slab',floor=1,overhead=True)
room('Primary bedroom',(-7.3,-1.8,-2.3,3.8),1)
room('Child bedroom',(-7.3,-7.8,-2.3,-3.8),1)
room('Ensuite',(-7.3,-3.6,-4.2,-2),1)
room('Family bathroom',(2.95,-4.5,5.8,-1.55),1)
room('Family lounge',(.1,-1.3,5.8,3.8),1)
room('Hobby / display gallery',(.1,-7.8,5.8,-4.7),1)
room('Linen',(-4.,-3.6,-2.3,-2.),1)

# Roof: a broad off-centre fold; no applied mascot elements.
GROUP='30 Folded roof'
def roof_z(x):
    return 6.62+(x+7.5)*(1.13/4.7) if x<=-2.8 else 7.75-(x+2.8)*(1.1/10.3)

# Build real openings around a 2.2 x 1.8 m rooflight above the family lounge.
xs=[-7.5,-2.8,1.2,3.4,7.5]; ys=[-8,1,2.8,4]
for x0,x1 in zip(xs,xs[1:]):
    for y0,y1 in zip(ys,ys[1:]):
        is_light=(x0==1.2 and y0==1)
        vs=[(x0,y0,roof_z(x0)),(x1,y0,roof_z(x1)),(x1,y1,roof_z(x1)),(x0,y1,roof_z(x0))]
        vs += [(x,y,z+.13) for x,y,z in vs]
        mesh('Rooflight glazing' if is_light else 'Folded roof plane',vs,[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],'glass' if is_light else 'roof','roof',floor=1,overhead=True)
        if not is_light:
            mesh('Timber roof soffit',[(x,y,z-.035) for x,y,z in vs[:4]],[[0,1,2,3]],'timber','roof',floor=1,overhead=True)
for y in [-8,4]:
    for a,b in [(-7.5,-2.8),(-2.8,6.0)]:
        mesh('Closed roof gable',[(a,y,6.28),(b,y,6.28),(b,y,roof_z(b)-.035),(a,y,roof_z(a)-.035)],[[0,1,2,3]],'plaster','wall',floor=1,overhead=True,solidify=.16)
    for a,b in zip([-7.5,-2.8],[-2.8,7.5]):
        fy=y+.075 if y<0 else y-.075
        rod('Crisp folded fascia',(a+.025,fy,roof_z(a)+.06),(b-.025,fy,roof_z(b)+.06),.075,'roof',floor=1,overhead=True)
for i in range(31):
    x=-7.45+i*.495
    segments=[(-8,4)] if not 1.2<x<3.4 else [(-8,1),(2.8,4)]
    for a,b in segments: rod('Standing seam',(x,a,roof_z(x)+.145),(x,b,roof_z(x)+.145),.012,'roof',floor=1,overhead=True)
for a,b in [((1.2,1),(3.4,1)),((1.2,2.8),(3.4,2.8)),((1.2,1),(1.2,2.8)),((3.4,1),(3.4,2.8))]:
    rod('Rooflight bronze kerb',(a[0],a[1],roof_z(a[0])+.15),(b[0],b[1],roof_z(b[0])+.15),.055,'frame',floor=1,overhead=True)

GROUP='21 Privacy screens'
for i in range(57):
    y=-7.85+i*.21
    add('East terrace cedar privacy fin',(7.30,y,5.02),(.12,.075,3.2),'timber','wall',floor=1,rotation_z=.32,revision=2)
box('East terrace solid guard',(7.23,-8,3.42),(7.43,4,4.48),'plaster','wall',floor=1)
box('Upper terrace planter',(6.4,-7.5,3.43),(7.15,-5.6,4.0),'concrete','furniture',floor=1)
for i in range(15):
    x=-6.95+i*.30
    add('Child room timber shading fin',(x,-7.78,5.13),(.07,.22,2.3),'timber','wall',floor=1,rotation_z=.40,revision=2)
for i in range(10):
    x=1.8+i*.36
    add('Gallery yellow screen accent',(x,-7.76,5.0),(.045,.15,1.5),'yellow','wall',floor=1,rotation_z=.3,revision=2)


# Furniture helpers: all dimensions and instances are persisted as elements.
def furnish(name,loc,size,mat='timber',shape='box',floor=0,**kw):
    return add(name,loc,size,mat,'furniture',shape=shape,floor=floor,bevel=.045,**kw)


def chair(x,y,z,floor=0,rot=0,mat='linen'):
    furnish('Dining chair cushion',(x,y,z+.46),(.5,.52,.12),mat,floor=floor)
    furnish('Curved chair back',(x,y+.22,z+.73),(.53,.09,.44),'timber',floor=floor)
    for dx in [-.19,.19]:
        for dy in [-.18,.18]: rod('Chair leg',(x+dx,y+dy,z),(x+dx,y+dy,z+.43),.023,'timber_dark',floor=floor)


def bed(x,y,z,w,length=2.1,floor=0,accent='sage'):
    furnish('Oak bed platform',(x,y,z+.2),(w+.15,length+.15,.3),'timber',floor=floor)
    furnish('Soft mattress',(x,y,z+.42),(w,length,.25),'linen',floor=floor)
    furnish('Bed cover',(x,y-.28,z+.57),(w+.025,length*.69,.07),accent,floor=floor)
    furnish('Timber headboard',(x,y+length/2+.12,z+.65),(w+.35,.12,1.2),'timber',floor=floor)
    for dx in [-w/4,w/4]: furnish('Linen pillow',(x+dx,y+length*.29,z+.64),(w*.43,.44,.14),'ceramic',floor=floor)
    for dx in [-w/2-.42,w/2+.42]:
        furnish('Bedside cabinet',(x+dx,y+.7,z+.28),(.48,.50,.56),'timber',floor=floor)
        furnish('Bedside ceramic lamp',(x+dx,y+.7,z+.76),(.23,.23,.32),'ceramic','ellipsoid',floor=floor)


def sofa(x,y,z,width=2.8,floor=0,mat='linen'):
    furnish('Sofa lower plinth',(x,y,z+.18),(width,1.0,.23),'timber_dark',floor=floor)
    for i in range(3): furnish('Sofa seat cushion',(x-width/2+width*(i+.5)/3,y-.05,z+.42),(width/3-.04,.82,.25),mat,floor=floor)
    furnish('Sofa back',(x,y+.43,z+.68),(width,.22,.65),mat,floor=floor)
    for dx in [-width/2,width/2]: furnish('Sofa arm',(x+dx,y,z+.52),(.19,1.0,.5),mat,floor=floor)
    furnish('Ochre cushion',(x-width*.27,y+.15,z+.72),(.44,.19,.43),'yellow',floor=floor,rotation_z=.13)
    furnish('Sage cushion',(x+width*.26,y+.15,z+.72),(.46,.19,.44),'sage',floor=floor,rotation_z=-.18)


def bath(x,y,z,floor=0):
    furnish('Wall hung ceramic WC',(x,y,z+.38),(.4,.65,.44),'ceramic','ellipsoid',floor=floor)
    furnish('Concealed WC tank',(x,y+.32,z+.7),(.48,.16,.8),'plaster',floor=floor)


def plant(x,y,z,scale=.8,floor=0,pot=True):
    if pot: furnish('Terracotta planter',(x,y,z+.21*scale),(.58*scale,.58*scale,.42*scale),'clay','cylinder',floor=floor)
    add('Tropical broad leaf plant',(x,y,z+.75*scale),(1.15*scale,1.15*scale,1.1*scale),'leaf',shape='plant',floor=floor,seed=len(E),base_z=z+(.4*scale if pot else 0))


GROUP='11 Ground interiors'
bed(-5.3,-5.65,.18,1.6,accent='linen')
furnish('Guest wardrobe',(-7.0,-4.3,1.43),(.56,1.6,2.5))
furnish('Guest woven rug',(-5.3,-5.5,.195),(2.9,3.15,.025),'linen')
furnish('Guest reading chair',(-3.85,-3.95,.60),(.68,.68,.8),'sage')
bath(-5.35,-1.1,.18)
furnish('Accessible shower tray',(-6.55,-2.25,.20),(1.35,1.35,.025),'concrete')
furnish('Shower screen',(-5.83,-2.37,1.25),(.015,1.25,2.1),'glass')
furnish('Shower vanity',(-6.55,-.97,.68),(1.2,.48,.68),'timber')
furnish('Shower basin',(-6.55,-.97,1.02),(.62,.37,.13),'ceramic','ellipsoid')
rod('Rain shower riser',(-7.18,-2.5,1.1),(-7.18,-2.5,2.5),.018)
furnish('Rain shower head',(-6.95,-2.5,2.52),(.35,.35,.035),'frame','cylinder')
furnish('Study built in desk',(5.7,-7.3,.95),(2.5,.6,.08),'timber')
chair(5.7,-6.65,.18,mat='sage')
furnish('Study laptop',(5.7,-7.2,1.06),(.45,.31,.025),'frame')
furnish('Study bookshelf',(7.0,-5.4,1.48),(.55,1.7,2.6),'timber')
furnish('Laundry cabinet',(2.6,-6.5,1.40),(1.65,.6,2.4),'plaster')
furnish('Laundry machine',(2.6,-4.65,.65),(.65,.65,.9),'ceramic')
bath(2.5,-3.65,.18)
furnish('Powder hand basin',(1.91,-2.52,.98),(.48,.38,.14),'ceramic','ellipsoid')
# Living and dining retain a clear route along the east side of the stair.
furnish('Living woven rug',(-4.7,1.4,.205),(4.25,3.0,.025),'linen')
sofa(-4.8,.25,.18,3.25)
furnish('Oak coffee table',(-4.75,1.75,.57),(1.25,.7,.14),'timber','ellipsoid')
for dx in [-.45,.45]: rod('Coffee table leg',(-4.75+dx,1.75,.20),(-4.75+dx,1.75,.51),.055,'timber_dark')
furnish('Coffee table book',(-4.5,1.75,.66),(.28,.35,.045),'clay')
furnish('Lounge armchair',(-6.65,2.45,.64),(.78,.85,.8),'sage',rotation_z=.4)
furnish('Low display cabinet',(-7.04,1.0,.59),(.42,2.5,.82),'timber')
plant(-6.75,3.25,.18,.85)
furnish('Dining oak tabletop',(1.02,1.8,.97),(2.4,1.05,.09),'timber')
for x in [.1,1.94]: furnish('Dining table pedestal',(x,1.8,.55),(.12,.7,.70),'timber')
for x in [.2,1.0,1.8]:
    chair(x,.87,.18); chair(x,2.72,.18)
furnish('Dining ceramic vase',(1.15,1.8,1.2),(.22,.22,.42),'ceramic','ellipsoid')
furnish('Dining linen runner',(1.0,1.8,1.022),(1.8,.38,.012),'linen')
# Kitchen counters / island / overhead storage.
furnish('Kitchen eastern cabinets',(6.99,-1.7,.63),(.62,4.6,.9),'timber')
furnish('Kitchen stone countertop',(6.98,-1.7,1.11),(.66,4.65,.065),'ceramic')
furnish('Kitchen tall fridge',(6.95,-3.55,1.44),(.68,.84,2.52),'plaster')
furnish('Kitchen island base',(4.5,-1.3,.64),(.85,2.2,.9),'timber')
furnish('Kitchen island stone',(4.5,-1.3,1.12),(.95,2.3,.07),'ceramic')
furnish('Kitchen sink',(6.97,-.1,1.153),(.42,.60,.015),'frame')
rod('Kitchen tap',(6.83,-.1,1.16),(6.83,-.1,1.52),.02,'frame')
furnish('Induction hob',(4.5,-1.35,1.161),(.58,.6,.016),'frame')
for y in [-1.9,-.9]:
    furnish('Island stool seat',(3.45,y,.91),(.42,.42,.07),'timber','cylinder')
    rod('Island stool leg',(3.45,y,.18),(3.45,y,.88),.037,'frame')
sofa(5.5,3.1,.18,2.35,mat='sage')
furnish('Threshold side table',(6.9,1.8,.55),(.65,.65,.08),'timber','cylinder')
plant(7.0,3.3,.18,.65)

GROUP='22 Upper interiors'
bed(-4.75,1.25,3.42,1.9,floor=1,accent='linen')
furnish('Primary woven rug',(-4.8,1.3,3.44),(3.6,3.4,.025),'linen',floor=1)
furnish('Primary wardrobe',(-7.0,.75,4.66),(.55,3.8,2.48),'timber',floor=1)
furnish('Primary garden bench',(-4.7,3.4,3.72),(2.4,.5,.6),'timber',floor=1)
bed(-5.2,-5.7,3.42,1.2,floor=1,accent='sage')
furnish('Child study desk',(-6.1,-7.37,4.13),(1.9,.65,.09),'timber',floor=1)
chair(-6.1,-6.65,3.42,1,mat='sage')
furnish('Child quiet storage',(-3.0,-6.65,4.45),(.65,1.6,2.06),'plaster',floor=1)
furnish('Child circular reading rug',(-3.8,-5.0,3.443),(1.7,1.7,.025),'sage','cylinder',floor=1)
furnish('Child reading pouf',(-3.8,-4.45,3.67),(.6,.6,.5),'linen','ellipsoid',floor=1)
bath(-4.6,-3.18,3.42,1)
furnish('Ensuite vanity',(-6.75,-3.30,4.00),(1.0,.44,.65),'timber',floor=1)
furnish('Ensuite basin',(-6.75,-3.3,4.35),(.62,.38,.13),'ceramic','ellipsoid',floor=1)
bath(5.2,-3.98,3.42,1)
furnish('Shared bath tub',(4.7,-2.2,3.7),(1.8,.78,.56),'ceramic','ellipsoid',floor=1)
furnish('Family bathroom vanity',(3.6,-4.1,4.0),(1.0,.45,.65),'timber',floor=1)
sofa(2.8,.75,3.42,3.05,1,'sage')
furnish('Family lounge rug',(2.8,1.8,3.445),(4.7,3.0,.025),'linen',floor=1)
furnish('Family lounge table',(2.8,2.15,3.82),(1.1,.75,.16),'timber','ellipsoid',floor=1)
furnish('Garden window reading bench',(3.05,3.48,3.72),(4.7,.55,.60),'timber',floor=1)
furnish('Shared toy and book storage',(5.52,1.7,4.0),(.45,2.6,1.16),'timber',floor=1)
plant(.7,3.18,3.42,.8,1)
furnish('Hobby gallery worktop',(3.0,-7.1,4.2),(3.7,.7,.08),'timber',floor=1)
chair(2.25,-6.38,3.42,1); chair(3.65,-6.38,3.42,1)
furnish('Gallery display shelving',(5.52,-6.35,4.67),(.45,2.2,2.5),'timber',floor=1)
for floor,z,x,y in [(0,.18,-7.04,1.),(1,3.42,5.52,1.7),(1,3.42,5.52,-6.35)]:
    for i in range(12):
        furnish('Books / collection object',(x,y-.8+i*.135,z+.88),(.25,.08,.22+(i%3)*.07),['linen','clay','sage','yellow'][i%4],floor=floor)

GROUP='40 Site and hardscape'
add('Context ground',(0,0,-.43),(150,150,.1),'gravel','slab',group='41 Context')
box('20 x 30 m site base',(-10,-15,-.36),(10,15,-.11),'concrete','slab')
box('Planted ground plane',(-9.8,-14.8,-.10),(9.8,14.8,.015),'lawn','slab')
box('Street south of plot',(-18,-19,-.24),(18,-15,-.03),'asphalt','slab')
for a,b in [(-10,-2.2),(1.6,4),(7.2,10)]:
    box('Street curb',(a,-15.10,-.12),(b,-14.90,.06),'concrete','slab')
mesh('Continuous graded entry route',[(-2,-15,-.08),(1.4,-15,-.08),(1.4,-8,-.08),(-2,-8,-.08),(-2,-15,-.03),(1.4,-15,-.03),(1.4,-8,.18),(-2,-8,.18)],[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],'concrete','slab')
box('One car bay / driveway',(4.2,-15,.02),(7,-8.6,.10),'gravel','slab')
box('Open garden deck',(-7.5,4,-.02),(7.5,5.6,.18),'timber','slab')
box('East service path',(7.5,-8,-.01),(8.5,4,.08),'gravel','slab')
for i in range(31):
    x=-7.45+i*.48
    box('Garden deck board joint',(x,4,.179),(x+.012,5.6,.19),'timber_dark','asset',bevel=0)
for i in range(6):
    box('Stepping stone',(-1.15,6.05+i*.95,.02),(-.35,6.65+i*.95,.09),'concrete','slab')
for x in [-9.9,9.9]: box('Side neighbor garden boundary',(x-.075,-14.9,0),(x+.075,14.9,1.65),'plaster','wall')
box('North garden wall',(-9.9,14.8,0),(9.9,15,1.45),'plaster','wall')
for a,b in [(-10,-2.2),(1.6,4),(7.2,10)]:
    box('Low street garden wall',(a,-14.9,0),(b,-14.7,.72),'plaster','wall')
box('Built in garden bench',(-6.9,10.9,.0),(-3.3,11.5,.42),'concrete','furniture')
box('Garden bench timber seat',(-6.95,10.85,.42),(-3.25,11.55,.50),'timber','furniture')
# A modest car is a scale reference, fully within the one bay.
add('Parked compact car',(5.6,-11.9,.64),(1.78,4.1,1.06),'sage','asset',bevel=.28)
add('Car glazed cabin',(5.6,-11.78,1.20),(1.53,2.20,.70),'glass','asset',bevel=.23)
add('Car roof',(5.6,-11.8,1.58),(1.50,1.85,.08),'sage','asset',bevel=.08)
for x in [4.71,6.49]:
    for y in [-13.22,-10.72]: rod('Car tyre',(x-.10,y,.37),(x+.10,y,.37),.31,'frame')
for x in [5.06,6.14]: add('Car headlights',(x,-13.92,.64),(.4,.08,.16),'ceramic')

GROUP='50 Tropical garden'
trees=[(-8.55,-10.7,4.6,1.5),(-5.3,-12.1,3.8,1.5),(8.6,-4.9,4.8,1.15),(-8.6,1.6,5,1.45),
       (-7.8,8.7,5.6,2.15),(6.8,9,5.0,2.05),(-4,13.2,4.6,1.8),(8.4,13.1,4.5,1.45)]
for i,(x,y,h,r) in enumerate(trees):
    add('Frangipani / tropical canopy',(x,y,h/2),(r*2,r*2,h),'leaf',shape='tree',seed=i+71,base_z=0,radius=r,height=h)
for x,y in [(-8.5,-6),(-8.4,-3),(8.9,.5),(8.5,4.9),(-8.1,6.4),(7.8,6.5),(-6.5,12.8),(-2,13.6),(2,13.6),(4.8,12.7),(-6.8,-10.4),(2.7,-12.4),(3.0,-9.0)]:
    plant(x,y,.03,1.15,pot=False)
for i in range(15):
    add('North lush underplanting',(-8.8+i*1.24,14.,.52),(1.3,1.5,1.05),'leaf_light',shape='shrub',seed=i+100)
for i in range(9):
    add('West planted border',(-9.12,-7+i*1.9,.45),(1.15,1.9,.85),'leaf',shape='shrub',seed=i+140)

# Interior pendant fixtures remain real model objects and area lights are derived.
GROUP='60 Lighting'
for name,loc,size in [('Dining linear pendant',(1.0,1.8,2.55),(2.3,.055,.065)),
                      ('Kitchen linear pendant',(4.5,-1.3,2.62),(.07,1.8,.07)),
                      ('Entry reveal light',(-.85,-7.4,2.94),(3.9,.055,.035))]:
    add(name,loc,size,'light','light')
    rod('Pendant suspension',(loc[0]-.5,loc[1],loc[2]),(loc[0]-.5,loc[1],3.18),.006)
    rod('Pendant suspension',(loc[0]+.5,loc[1],loc[2]),(loc[0]+.5,loc[1],3.18),.006)

spaces=[]
for i,r in enumerate(ROOMS):
    a,b,c,d=r['bounds']; z=.18 if r['floor']==0 else 3.42
    spaces.append(dict(id=f'room_{i:02d}',name=r['name'],floor=r['floor'],position=[(a+c)/2,z+1.45,(b+d)/2],size=[c-a,2.9,d-b]))

design=dict(schemaVersion=1,units='meters',title='Folded Light — Pikachu House',buildingType='Tropical family house',floors=2,
            materials=M,spaces=spaces,elements=E,spawn=[-.8,1.7,-10.5],notes=[
                'Hypothetical 20 x 30 m Joo Chiat plot. Concept model, not an identified property.',
                'Three bedrooms. Shared rooms use ochre accents; private bedrooms use neutral timber and linen.',
                'Canonical coordinates are X east, Y up, Z north. Blender geometry extensions preserve non-box shapes.',
                'Concept GFA: 164.4 m2 ground + 155.6 m2 upper = 320.0 m2. Stair void excluded upstairs.',
                'Covered projection: 15 x 12 = 180 m2, including recessed entry and 12 m2 garden threshold.',
                'Ceilings close bedroom volumes independently of the folded roof. Rooflight serves upper family lounge.',
                'Concept geometry does not establish engineering, accessibility, environmental or statutory compliance.'
            ],blender=dict(revision=2,source_brief='docs/draftroom/prompts/projects/03-pikachu-house.md',rooms=ROOMS,
            site=dict(width=20,depth=30,ground_outline=ground_outline,upper_outline=[[-7.5,-8],[6,-8],[6,4],[-7.5,4]],stair_void=[[-1.65,-3.8],[-.05,-3.8],[-.05,.2],[-1.65,.2]],covered_outline=[[-7.5,-8],[7.5,-8],[7.5,4],[-7.5,4]],
                      conservative_nonplanted_exclusions=dict(covered=180,entry_route=23.8,car_bay=17.92,rear_deck=24,service_path=12,boundary_strip=19.84,stepping_stones=2.88)),
            cameras=[dict(name='Street perspective',position=[18,-31,11],target=[0,-1.5,2.9],lens=45),
                     dict(name='Arrival eye level',position=[9.2,-21,2.3],target=[-1,-3.5,3.8],lens=30),
                     dict(name='Family room to garden',position=[-3.3,-.45,1.73],target=[-.9,9,1.55],lens=21),
                     dict(name='Garden perspective',position=[-17,20,11],target=[0,1,3.0],lens=45),
                     dict(name='Upper family lounge',position=[.5,-.75,4.97],target=[3.0,3.8,5.15],lens=21)],
            changes=[dict(id='revision_02',reason='Refine side privacy and calm private rooms; preserve the roof fold, yellow arrival and open garden connection.',operations=['Add east terrace timber privacy fins','Add filtered timber shading to child bedroom','Reduce upper shared yellow accents to a fine screen'])]))
for rev in [1,2]:
    d=copy.deepcopy(design)
    d['blender']['revision']=rev
    if rev==1:
        d['elements']=[e for e in d['elements'] if e['blender'].get('revision',1)<=1]
        d['notes'].append('V1 baseline retains an open east terrace; V2 adds the timber privacy veil and filtered child-room facade.')
    (OUT/'versions'/f'design.v{rev}.json').write_text(json.dumps(d,indent=2)+'\n')
(OUT/'design.json').write_text(json.dumps(design,indent=2)+'\n')
print(json.dumps({'elements':len(E),'spaces':len(spaces),'canonical':str(OUT/'design.json')}))
