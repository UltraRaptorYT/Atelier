"""Publish evaluated Blender meshes as a normalized GLB without discarding materials or UVs."""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=args.input)
graph = bpy.context.evaluated_depsgraph_get()
original_objects = list(bpy.context.scene.objects)
meshes = []
points = []
triangles = 0
for obj in original_objects:
    if obj.type != 'MESH':
        continue
    evaluated = obj.evaluated_get(graph)
    # Unlike from_pydata, evaluated copies retain UVs, per-face material indices,
    # smooth shading and the material slots referenced by each mesh.
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=graph)
    mesh.transform(obj.matrix_world)
    mesh.calc_loop_triangles()
    points.extend(vertex.co.copy() for vertex in mesh.vertices)
    triangles += len(mesh.loop_triangles)
    meshes.append((obj.name, mesh))
if not points or len(points) > 30000 or triangles > 50000:
    raise ValueError('Asset must contain 1–30000 vertices and at most 50000 triangles.')
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center, size = (high+low)/2, high-low
if min(size) < .01:
    raise ValueError('Asset must have nonzero dimensions.')
normalize = Matrix.Diagonal(Vector((1/size.x, 1/size.y, 1/size.z, 1))) @ Matrix.Translation(-center)
for obj in original_objects:
    bpy.data.objects.remove(obj, do_unlink=True)
for name, mesh in meshes:
    mesh.transform(normalize)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=args.output, export_format='GLB', use_selection=True, export_extras=True)
Path(args.output+'.json').write_text(json.dumps({'size': [size.x, size.z, size.y], 'vertices': len(points), 'triangles': triangles}))
