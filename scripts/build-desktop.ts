import { Template, defaultBuildLogger } from '@e2b/desktop';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('worker/.dev.vars.local')) loadEnvFile('worker/.dev.vars.local');
const apiKey = process.env.E2B_API_KEY;
if (!apiKey) throw new Error('Set E2B_API_KEY locally before building the desktop template.');

// Ubuntu's Blender package is compiled without OpenColorIO and produces nearly
// black PNGs. Use the complete official distribution, including its matching
// Python, glTF add-on and color profiles. Digest from Blender's release checksum:
// https://download.blender.org/release/Blender3.0/blender-3.0.1.sha256
const installBlender = `
import hashlib
from pathlib import Path
import tarfile
import urllib.request

archive = Path('/tmp/blender-3.0.1-linux-x64.tar.xz')
url = 'https://download.blender.org/release/Blender3.0/blender-3.0.1-linux-x64.tar.xz'
expected = '4f17aa3d10ed6e13e6a75479f1a506f58998b8c007812a0886d9254c953e2ae5'
digest = hashlib.sha256()
request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(request, timeout=60) as response, archive.open('wb') as output:
    while True:
        chunk = response.read(1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
        output.write(chunk)
if digest.hexdigest() != expected:
    raise RuntimeError('Official Blender archive failed SHA-256 verification')
with tarfile.open(archive) as bundle:
    bundle.extractall('/opt')
archive.unlink()
binary = Path('/usr/local/bin/blender')
binary.unlink(missing_ok=True)
binary.symlink_to('/opt/blender-3.0.1-linux-x64/blender')
print('Installed verified official Blender 3.0.1.')
`;

// Reload the rendered PNG: success and a valid file header alone did not catch
// the distro build's near-black output.
const verifyBlender = `
import bpy
import json
from pathlib import Path
import tempfile

assert bpy.app.version == (3, 0, 1), bpy.app.version_string
assert bpy.app.build_options.opencolorio, 'Blender requires OpenColorIO support'
scene = bpy.context.scene
scene.view_settings.view_transform = 'Filmic'
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.render.resolution_x = 32
scene.render.resolution_y = 32
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
material = bpy.data.materials.new('Template color check')
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
emission = nodes.new('ShaderNodeEmission')
emission.inputs['Color'].default_value = (1, 0.02, 0.01, 1)
output = nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
cube = bpy.data.objects['Cube']
cube.data.materials.clear()
cube.data.materials.append(material)
with tempfile.TemporaryDirectory(prefix='atelier-blender-check-') as folder:
    png = Path(folder) / 'color.png'
    scene.render.filepath = str(png)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(png), check_existing=False)
    pixels = list(image.pixels)
    red = pixels[0::4]
    blue = pixels[2::4]
    assert max(red) > 0.25, 'Rendered PNG is unexpectedly dark'
    assert max(r - b for r, b in zip(red, blue)) > 0.15, 'Rendered PNG lost its expected color'
    glb = Path(folder) / 'check.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB')
    assert glb.read_bytes()[:8] == b'glTF' + bytes([2, 0, 0, 0]), 'Invalid GLB export'
    print('ATELIER_BLENDER_READY: ' + json.dumps({'version': bpy.app.version_string, 'view_transform': scene.view_settings.view_transform, 'png_max_red': max(red), 'glb_bytes': glb.stat().st_size}))
`;

const template = Template().fromTemplate('desktop')
  .runCmd('apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip mousepad libxrender1 libxi6 libxfixes3 libxkbcommon0 libsm6 libice6 libgl1 && apt-get clean', { user: 'root' })
  .runCmd(`python3 - <<'PY'\n${installBlender}\nPY`, { user: 'root' })
  .runCmd(`cat > /tmp/atelier-verify-blender.py <<'PY'\n${verifyBlender}\nPY\nblender --background --factory-startup --python-exit-code 1 --python /tmp/atelier-verify-blender.py`);
const recentBuildLogs: string[] = [];
const buildLogger = defaultBuildLogger({ minLevel: 'info' });
try {
  if (await Template.exists('atelier-desktop', { apiKey })) {
    // An existing alias may still contain the distro Blender build. Rebuild it
    // so the current installation and color/export checks are applied.
    console.log('Atelier desktop template already exists; rebuilding to apply the current Blender checks.');
  }
  // Keep the 2 CPU / 4 GB sizing assumed by shared/budget.ts's compute rate.
  await Template.build(template, 'atelier-desktop', { apiKey, cpuCount: 2, memoryMB: 4096, minFreeDiskMb: 2048, onBuildLogs(entry) {
    const message = entry.message.replaceAll(apiKey, '[redacted]').slice(0, 1200);
    recentBuildLogs.push(message);
    buildLogger({ ...entry, message });
    if (recentBuildLogs.length > 25) recentBuildLogs.shift();
  } });
} catch (error) {
  for (const message of recentBuildLogs) console.error(message);
  throw new Error(error instanceof Error ? error.message.replaceAll(apiKey, '[redacted]').slice(0, 1200) : 'Desktop template build failed.');
}
console.log('Atelier desktop template built with verified color management and GLB export. Benchmark it before enabling public rendering.');
