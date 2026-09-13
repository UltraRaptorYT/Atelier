"""Measure the actual Blender mesh and reconcile it with canonical design.

Run in Blender after the final build. These are concept geometry checks, not
statutory, structural, accessibility or environmental certification.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
scene=bpy.data.scenes['Pikachu House | Folded Light']
bpy.context.window.scene=scene
bpy.context.view_layer.update()
design=json.loads((ROOT/'project/design.json').read_text())
out=ROOT/'project/output'


def poly_area(poly):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))/2


def top_area(obj):
    total=0
    for p in obj.data.polygons:
        if p.normal.z>.99:
            coords=[tuple(obj.matrix_world@obj.data.vertices[i].co) for i in p.vertices]
            total+=poly_area(coords)
    return total


def by_name(prefix):
    return next(o for o in scene.objects if o.name.startswith(prefix))


gfa_ground=top_area(by_name('Ground enclosed floor'))
gfa_upper=sum(top_area(by_name(n)) for n in ['Upper west slab','Upper east slab','Upper south slab','Upper north landing'])
ids={o.get('atelier_source_id') for o in scene.objects}
missing=[e['id'] for e in design['elements'] if e['id'] not in ids]
roof_objects=[o for o in scene.objects if o.name.startswith(('Folded roof plane','Rooflight glazing','Standing seam','Crisp folded fascia'))]
roof_points=[tuple(o.matrix_world@v.co) for o in roof_objects for v in o.data.vertices]
roof_bounds={axis:[min(p[i] for p in roof_points),max(p[i] for p in roof_points)] for i,axis in enumerate('xyz')}
coverage=(roof_bounds['x'][1]-roof_bounds['x'][0])*(roof_bounds['y'][1]-roof_bounds['y'][0])
bedrooms=[r for r in design['blender']['rooms'] if 'bedroom' in r['name'].lower()]
site=design['blender']['site']
garden=site['width']*site['depth']-sum(site['conservative_nonplanted_exclusions'].values())
stairs=[o for o in scene.objects if o.name.startswith('Stair tread')]
top_stair=max(max((o.matrix_world@v.co).z for v in o.data.vertices) for o in stairs)
ceilings=[by_name('Child private ceiling'),by_name('Primary private ceiling')]
ceiling_min=[min((o.matrix_world@v.co).z for v in o.data.vertices) for o in ceilings]
report=dict(timestamp=datetime.now(timezone.utc).isoformat(),source='Measured Blender mesh vertices and polygon projections; canonical room bounds and site exclusions.',
            metrics=dict(site_m2=600,ground_enclosed_m2=round(gfa_ground,3),upper_enclosed_m2=round(gfa_upper,3),gfa_m2=round(gfa_ground+gfa_upper,3),covered_projection_m2=round(coverage,3),planted_garden_lower_bound_m2=round(garden,3),bedrooms=len(bedrooms),storeys=2,car_spaces=1,
            bedroom_clear_rectangles_m2={r['name']:r['area'] for r in bedrooms},roof_world_bounds_m=roof_bounds,stairs=dict(rises=len(stairs),rise_m=.18,tread_m=.28,clear_width_m=1.2,top_z_m=round(top_stair,3),upper_ffl_m=3.42,void_m2=poly_area(site['stair_void']))),
            checks=dict(canonical_elements_present=not missing,missing_element_ids=missing,three_bedrooms=len(bedrooms)==3,gfa_at_or_below_340=gfa_ground+gfa_upper<=340.001,coverage_at_or_below_180=coverage<=180.001,garden_at_least_240=garden>=240,stair_meets_upper_floor=abs(top_stair-3.42)<.001,private_ceilings_close_partition_tops=all(z<=6.35 for z in ceiling_min),
                        south_setback_m=round(roof_bounds['y'][0]+15,3),north_setback_m=round(15-roof_bounds['y'][1],3),west_setback_m=round(roof_bounds['x'][0]+10,3),east_setback_m=round(10-roof_bounds['x'][1],3)),
            limitations=['GFA is concept enclosed floor-plate arithmetic, excluding the upper stair void; not a statutory classification.',
                        'Planted garden is a conservative remainder with boundary and paving exclusions; overlaps are deliberately double-subtracted.',
                        'Guest and shower are on the entry floor. Door maneuvering, gradients, headroom and accessible fixture clearances need dedicated review.',
                        'Solid side walls, high-level side glazing and east timber fins express privacy intent; no neighbor sightline simulation.',
                        'Room areas are clear rectangular planning bounds, before furniture. Living/dining is 45.58 m2 rather than the 50 m2 working allocation.',
                        'No structural, drainage, thermal, ventilation, daylight or statutory performance is established.'])
(out/'geometry-checks.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
assert not missing,missing
assert abs(gfa_ground+gfa_upper-320)<.001
assert coverage<=180.001,coverage
assert garden>=240
assert len(bedrooms)==3
