"""Publish evaluated mesh geometry from a specialist's Blender file as a normalized GLB."""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector
parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=args.input)
graph=bpy.context.evaluated_depsgraph_get()
vertices=[]
faces=[]
for obj in list(bpy.context.scene.objects):
    if obj.type!='MESH': continue
    evaluated=obj.evaluated_get(graph)
    mesh=evaluated.to_mesh()
    mesh.calc_loop_triangles()
    offset=len(vertices)
    vertices.extend([tuple(obj.matrix_world @ v.co) for v in mesh.vertices])
    faces.extend([tuple(offset+i for i in triangle.vertices) for triangle in mesh.loop_triangles])
    evaluated.to_mesh_clear()
if not vertices or len(vertices)>30000 or len(faces)>50000:
    raise ValueError('Asset must contain 1–30000 vertices and at most 50000 triangles.')
low=Vector(tuple(min(p[i] for p in vertices) for i in range(3)))
high=Vector(tuple(max(p[i] for p in vertices) for i in range(3)))
center=(high+low)/2
size=high-low
if min(size)<0.01: raise ValueError('Asset must have nonzero dimensions.')
normalized=[tuple((p[i]-center[i])/size[i] for i in range(3)) for p in vertices]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('atelier_asset_mesh')
mesh.from_pydata(normalized,[],faces)
mesh.update()
obj=bpy.data.objects.new('atelier_asset',mesh)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active=obj
obj.select_set(True)
Path(args.output).parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=args.output,export_format='GLB',use_selection=True,export_extras=True)
Path(args.output+'.json').write_text(json.dumps({'size':[size.x,size.z,size.y],'vertices':len(vertices),'triangles':len(faces)}))
