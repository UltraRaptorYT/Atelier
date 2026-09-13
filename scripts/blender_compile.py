"""Compile Atelier's canonical design. Coordinates: Three Y-up -> Blender Z-up."""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

def presentation_camera(design, view='front'):
    """Frame actual bounds from the entrance side in canonical Y-up coordinates."""
    low = [math.inf] * 3
    high = [-math.inf] * 3
    for element in design['elements']:
        w, h, depth = element['size']
        angle = element['rotation']
        cosine, sine = abs(math.cos(angle)), abs(math.sin(angle))
        extents = [(w*cosine + depth*sine)/2, h/2, (w*sine + depth*cosine)/2]
        for axis in range(3):
            low[axis] = min(low[axis], element['position'][axis] - extents[axis])
            high[axis] = max(high[axis], element['position'][axis] + extents[axis])
    center = [(a+b)/2 for a, b in zip(low, high)]
    if view in ('plan_ground', 'plan_upper'):
        floor = 0 if view == 'plan_ground' else 1
        spaces = [space for space in design['spaces'] if space['floor'] == floor]
        if not spaces:
            raise ValueError('Requested plan floor is absent from this design.')
        base = min(space['position'][1]-space['size'][1]/2 for space in spaces)
        cut = base + 1.2
        return {'position': [center[0], high[1]+max(high[0]-low[0], high[2]-low[2], 5), center[2]],
                'target': [center[0], cut, center[2]], 'orthographic': True,
                'orthoScale': max(high[0]-low[0], (high[2]-low[2])*4/3, 5)*1.15,
                'floor': floor, 'cutHeight': cut}
    if view == 'interior':
        spaces = [space for space in design['spaces'] if space['floor'] == 0]
        space = max(spaces, key=lambda space: space['size'][0]*space['size'][2])
        sx, sy, sz = space['position']
        width, height, depth = space['size']
        eye = sy-height/2+min(1.65, height*.65)
        candidates = [[sx+dx*max(width/2-.7, 0), eye, sz+dz*max(depth/2-.7, 0)] for dx, dz in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        candidates.append([sx, eye, sz])
        def obstruction(point):
            blocked = 0
            for element in design['elements']:
                if element['kind'] in ('light', 'window', 'door'):
                    continue
                x, y, z = [point[i]-element['position'][i] for i in range(3)]
                cosine, sine = math.cos(element['rotation']), math.sin(element['rotation'])
                x, z = x*cosine-z*sine, x*sine+z*cosine
                w, h, d = element['size']
                if abs(x) < w/2+.2 and abs(y) < h/2+.15 and abs(z) < d/2+.2:
                    blocked += 1
            return blocked
        position = min(candidates, key=obstruction)
        target = [sx, eye-.15, sz]
        if math.hypot(position[0]-sx, position[2]-sz) < .1:
            target[2] += max(depth/2-.5, .5)
        return {'position': position, 'target': target, 'lens': 22, 'floor': 0, 'spaceId': space['id'], 'cameraObstructions': obstruction(position)}
    half_x, half_z = max((high[0]-low[0])/2, .01), max((high[2]-low[2])/2, .01)
    candidates = []
    for index, element in enumerate(design['elements']):
        words = set(re.findall('[a-z]+', (element['id'] + ' ' + element['name']).lower()))
        rank = 4 if 'exterior' in words else 3 if 'front' in words else 2 if 'entrance' in words else 1 if 'entry' in words else 0
        if element['kind'] != 'door' or not rank:
            continue
        dx = (element['position'][0]-center[0])/half_x
        dz = (element['position'][2]-center[2])/half_z
        distance = min(half_x-abs(element['position'][0]-center[0]), half_z-abs(element['position'][2]-center[2]))
        candidates.append((rank, -distance, -index, dx, dz))
    front = [0, -1]
    if candidates:
        _, _, _, dx, dz = max(candidates)
        if max(abs(dx), abs(dz)) > .01:
            front = [1 if dx >= 0 else -1, 0] if abs(dx) > abs(dz) else [0, 1 if dz >= 0 else -1]
    if view == 'rear':
        front = [-front[0], -front[1]]
    right = [-front[1], front[0]]
    radius, height = max(half_x, half_z, 5), high[1]-low[1]
    position = [center[0]+radius*(front[0]*2.1+right[0]*1.9),
                low[1]+max(height*1.35, radius*1.1),
                center[2]+radius*(front[1]*2.1+right[1]*1.9)]
    target = [center[0], low[1]+height*.38, center[2]]
    direction = [target[i]-position[i] for i in range(3)]
    magnitude = math.sqrt(sum(v*v for v in direction))
    direction = [v/magnitude for v in direction]
    right = [-direction[2], 0, direction[0]]
    magnitude = math.hypot(right[0], right[2])
    right = [v/magnitude for v in right]
    up = [right[1]*direction[2]-right[2]*direction[1], right[2]*direction[0]-right[0]*direction[2], right[0]*direction[1]-right[1]*direction[0]]
    tangent = .01
    for x in (low[0], high[0]):
        for y in (low[1], high[1]):
            for z in (low[2], high[2]):
                offset = [v-position[i] for i, v in enumerate((x,y,z))]
                depth = sum(offset[i]*direction[i] for i in range(3))
                tangent = max(tangent, abs(sum(offset[i]*right[i] for i in range(3)))/max(depth,.01),
                              abs(sum(offset[i]*up[i] for i in range(3)))/max(depth,.01)*4/3)
    # Keep camera placement shared with the browser, but fit all bounding corners
    # to Blender's actual 36 mm horizontal sensor and 4:3 output aspect ratio.
    lens = max(1, min(42, 18/(tangent*1.12)))
    return {'position': position, 'target': target, 'front': front, 'lens': lens}

def parts(element):
    if element.get('geometry'):
        return []
    w, h, length = element['size']
    asset = element.get('assetId')
    if asset and asset.startswith('atelier-'):
        local = Path(__file__).with_name('furniture.json')
        library_path = local if local.exists() else Path(__file__).parent.parent/'shared'/'furniture.json'
        library = json.loads(library_path.read_text())
        if asset[8:] not in library:
            raise ValueError('Unknown furniture asset: '+asset)
        return [([n*element['size'][i] for i,n in enumerate(p['position'])],
                 [n*element['size'][i] for i,n in enumerate(p['size'])]) for p in library[asset[8:]]]
    if element['kind'] != 'stair':
        return [([0, 0, 0], [w, h, length])]
    count = max(2, math.ceil(h / 0.18))
    return [([0, -h/2 + h*(i+1)/count/2, -length/2 + length*(i+0.5)/count],
             [w, h*(i+1)/count, length/count]) for i in range(count)]

def mesh_geometry(element):
    """Canonical local coordinates -> Blender local coordinates; reverse winding after axis swap."""
    mesh = element.get('geometry')
    if not mesh:
        return None
    vertices = [(v[0]*element['size'][0], v[2]*element['size'][2], v[1]*element['size'][1]) for v in mesh['vertices']]
    return vertices, [(triangle[0], triangle[2], triangle[1]) for triangle in mesh['triangles']]

def material_appearance(material, element):
    explicit = material.get('opacity') is not None or material.get('transmission') is not None
    opacity = material.get('opacity')
    transmission = material.get('transmission')
    return {'opacity': opacity if opacity is not None else (1 if explicit else .25 if element['kind'] == 'window' else .4 if element['kind'] == 'door' else 1),
            'transmission': transmission if transmission is not None else (.9 if not explicit and element['kind'] == 'window' else 0)}

def cut_plan_geometry(framing):
    """Cut the actual model for evidence views only, after full-model exports are saved."""
    import bpy
    import bmesh
    from mathutils import Vector
    floor, cut = framing['floor'], framing['cutHeight']
    bpy.context.view_layer.update()
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        parent = obj
        while parent and 'atelier_floor' not in parent:
            parent = parent.parent
        show_stair_below = parent is not None and parent.get('atelier_kind') == 'stair' and parent['atelier_floor'] == floor-1
        if not parent or (parent['atelier_floor'] != floor and not show_stair_below) or parent.get('atelier_kind') == 'roof':
            obj.hide_render = True
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        world = obj.matrix_world
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.transform(world)
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces), dist=.00001,
                              plane_co=Vector((0, 0, cut)), plane_no=Vector((0, 0, 1)), clear_outer=True, clear_inner=False)
        bm.transform(world.inverted())
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()

def compile_design(design, output, render=False, revision=0, preview=False, view='front', source='canonical design', design_hash=None):
    import bpy
    from mathutils import Vector
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    materials = {}
    material_specs = {item['id']: item for item in design['materials']}
    for item in design['materials']:
        m = bpy.data.materials.new(item['id'])
        m.use_nodes = True
        shader = m.node_tree.nodes.get('Principled BSDF')
        rgb = [int(item['color'][i:i+2], 16)/255 for i in (1, 3, 5)]
        # Hex colors are sRGB; Blender shader inputs are linear.
        rgb = [x/12.92 if x <= 0.04045 else ((x+0.055)/1.055)**2.4 for x in rgb]
        shader.inputs['Base Color'].default_value = (*rgb, 1)
        shader.inputs['Roughness'].default_value = item['roughness']
        shader.inputs['Metallic'].default_value = item['metalness']
        materials[item['id']] = m
    def material_for(element):
        appearance = material_appearance(material_specs[element['materialId']], element)
        key = (element['materialId'], appearance['opacity'], appearance['transmission'])
        if key not in materials:
            m = materials[element['materialId']].copy()
            shader = m.node_tree.nodes['Principled BSDF']
            shader.inputs['Alpha'].default_value = appearance['opacity']
            shader.inputs['Transmission Weight' if 'Transmission Weight' in shader.inputs else 'Transmission'].default_value = appearance['transmission']
            if appearance['opacity'] < 1:
                if hasattr(m, 'surface_render_method'):
                    m.surface_render_method = 'DITHERED'
                elif hasattr(m, 'blend_method'):
                    m.blend_method = 'BLEND'
            materials[key] = m
        return materials[key]
    for element in design['elements']:
        parent = bpy.data.objects.new(element['id'], None)
        bpy.context.collection.objects.link(parent)
        x, y, z = element['position']
        parent.location = (x, z, y)
        parent.rotation_euler.z = -element['rotation']
        parent['atelier_element_id'] = element['id']
        parent['atelier_name'] = element['name']
        parent['atelier_floor'] = element['floor']
        parent['atelier_kind'] = element['kind']
        if element.get('assetId') and not element['assetId'].startswith('atelier-'):
            asset_path=Path(__file__).parent/'assets'/(element['assetId']+'.glb')
            previous=set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=str(asset_path))
            imported=set(bpy.data.objects)-previous
            for obj in imported:
                if obj.parent not in imported:
                    obj.parent=parent
                if obj.type=='MESH' and element.get('assetMaterialOverride'):
                    obj.data.materials.clear()
                    obj.data.materials.append(material_for(element))
            parent.scale=(element['size'][0],element['size'][2],element['size'][1])
            continue
        geometry = mesh_geometry(element)
        if geometry:
            mesh = bpy.data.meshes.new(element['id']+'_mesh')
            mesh.from_pydata(geometry[0], [], geometry[1])
            mesh.update()
            obj = bpy.data.objects.new(element['id']+'_0', mesh)
            bpy.context.collection.objects.link(obj)
            obj.parent = parent
            obj.data.materials.append(material_for(element))
            continue
        for index, (offset, dims) in enumerate(parts(element)):
            bpy.ops.mesh.primitive_cube_add(size=1)
            obj = bpy.context.object
            obj.name = element['id'] + '_' + str(index)
            obj.parent = parent
            obj.location = (offset[0], offset[2], offset[1])
            obj.dimensions = (dims[0], dims[2], dims[1])
            obj.data.materials.append(material_for(element))
            if element['kind'] in ('furniture', 'light'):
                # Wall/slab pieces partition continuous assemblies; beveling
                # every piece creates visible cracks at artificial boundaries.
                bevel = obj.modifiers.new('Subtle edge detail', 'BEVEL')
                bevel.width = min(0.025, min(dims)/8)
                bevel.segments = 2
    scene = bpy.context.scene
    scene['atelier_schema_version'] = design['schemaVersion']
    scene['atelier_design_title'] = design['title']
    scene['atelier_design_revision'] = revision
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.72, 0.78, 0.85, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.5
    bpy.ops.object.light_add(type='SUN', location=(10, -15, 20))
    sun = bpy.context.object
    sun.rotation_euler = (math.radians(25), math.radians(-25), math.radians(-25))
    sun.data.energy = 3
    sun.data.angle = math.radians(10)
    for x in design['elements']:
        if x['kind'] == 'light':
            p = x['position']
            bpy.ops.object.light_add(type='AREA', location=(p[0], p[2], p[1]))
            bpy.context.object.data.energy = 250
            bpy.context.object.data.shape = 'DISK'
            bpy.context.object.data.size = 3
    framing = presentation_camera(design, view)
    px, py, pz = framing['position']
    tx, ty, tz = framing['target']
    bpy.ops.object.camera_add(location=(px, pz, py))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((tx, tz, ty))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = framing.get('lens', 42)
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.data.sensor_width = 36
    camera.data.clip_start = .05
    camera.data.clip_end = 2500
    if framing.get('orthographic'):
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = framing['orthoScale']
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 8 if preview else 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 640 if preview else 1280
    scene.render.resolution_y = 480 if preview else 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    preferred_transform = 'AgX' if bpy.app.version >= (4, 0, 0) else 'Filmic'
    try:
        scene.view_settings.view_transform = preferred_transform
    except TypeError:
        # Preserve geometry export on builds without the preferred transform.
        # The desktop template separately verifies OpenColorIO and PNG color.
        scene.view_settings.view_transform = 'Standard'
        print(json.dumps({'warning': 'Preferred color transform unavailable; rendering with Standard. Use a Blender build with OpenColorIO support and matching color profiles.', 'preferred_transform': preferred_transform, 'view_transform': 'Standard'}))
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if not preview:
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'design.blend'))
        bpy.ops.export_scene.gltf(filepath=str(output/'design.glb'), export_format='GLB', export_extras=True)
    if render or preview:
        if framing.get('orthographic'):
            cut_plan_geometry(framing)
        name = f'preview-{view}' if preview else 'presentation'
        scene.render.filepath = str(output/(name+'.png'))
        bpy.ops.render.render(write_still=True)
        (output/(name+'.json')).write_text(json.dumps({'revision': revision, 'view': view, 'camera': framing,
            'resolution': [scene.render.resolution_x, scene.render.resolution_y], 'samples': scene.cycles.samples,
            'source': source, 'designHash': design_hash, 'elements': len(design['elements'])}))
    print(json.dumps({'ok': True, 'elements': len(design['elements']), 'rendered': render or preview, 'preview': preview, 'view': view}))

if __name__ == '__main__':
    import sys
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--design', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--preview', action='store_true', help='Render a bounded review image without replacing final model exports.')
    parser.add_argument('--view', choices=['front', 'rear', 'plan_ground', 'plan_upper', 'interior'], default='front')
    parser.add_argument('--source', choices=['canonical design', 'task proposal'], default='canonical design')
    parser.add_argument('--revision', type=int, default=0)
    opts = parser.parse_args(args)
    raw = Path(opts.design).read_bytes()
    compile_design(json.loads(raw), opts.output, opts.render, opts.revision, opts.preview, opts.view, opts.source, hashlib.sha256(raw).hexdigest())
