"""Compile Atelier's canonical design. Coordinates: Three Y-up -> Blender Z-up."""
import argparse
import json
import math
from pathlib import Path

def parts(element):
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

def compile_design(design, output, render=False, revision=0):
    import bpy
    from mathutils import Vector
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    materials = {}
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
    for element in design['elements']:
        parent = bpy.data.objects.new(element['id'], None)
        bpy.context.collection.objects.link(parent)
        x, y, z = element['position']
        parent.location = (x, z, y)
        parent.rotation_euler.z = -element['rotation']
        parent['atelier_element_id'] = element['id']
        parent['atelier_name'] = element['name']
        if element.get('assetId') and not element['assetId'].startswith('atelier-'):
            asset_path=Path(__file__).parent/'assets'/(element['assetId']+'.glb')
            previous=set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=str(asset_path))
            imported=set(bpy.data.objects)-previous
            for obj in imported:
                if obj.parent not in imported:
                    obj.parent=parent
                if obj.type=='MESH':
                    obj.data.materials.clear()
                    obj.data.materials.append(materials[element['materialId']])
            parent.scale=(element['size'][0],element['size'][2],element['size'][1])
            continue
        for index, (offset, dims) in enumerate(parts(element)):
            bpy.ops.mesh.primitive_cube_add(size=1)
            obj = bpy.context.object
            obj.name = element['id'] + '_' + str(index)
            obj.parent = parent
            obj.location = (offset[0], offset[2], offset[1])
            obj.dimensions = (dims[0], dims[2], dims[1])
            obj.data.materials.append(materials[element['materialId']])
            bevel = obj.modifiers.new('Subtle edge detail', 'BEVEL')
            bevel.width = min(0.025, min(dims)/8)
            bevel.segments = 2
            if element['kind'] == 'window':
                glass = materials[element['materialId']].copy()
                inputs = glass.node_tree.nodes['Principled BSDF'].inputs
                inputs['Transmission Weight' if 'Transmission Weight' in inputs else 'Transmission'].default_value = 0.9
                obj.data.materials[0] = glass
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
    bounds = [max(abs(e['position'][0])+e['size'][0]/2, abs(e['position'][2])+e['size'][2]/2) for e in design['elements']]
    radius = max(max(bounds), 5)
    height = max(e['position'][1]+e['size'][1]/2 for e in design['elements'])
    bpy.ops.object.camera_add(location=(radius*1.9, radius*2.1, max(height*1.5, radius*1.3)))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, height*.35))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = 42
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 960
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
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'design.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output/'design.glb'), export_format='GLB', export_extras=True)
    if render:
        scene.render.filepath = str(output/'presentation.png')
        bpy.ops.render.render(write_still=True)
    print(json.dumps({'ok': True, 'elements': len(design['elements']), 'rendered': render}))

if __name__ == '__main__':
    import sys
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--design', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--revision', type=int, default=0)
    opts = parser.parse_args(args)
    compile_design(json.loads(Path(opts.design).read_text()), opts.output, opts.render, opts.revision)
