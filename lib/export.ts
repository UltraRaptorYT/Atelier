import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Design } from '@/shared/design';
import { geometryParts } from '@/shared/geometry';
export async function exportGLB(design: Design): Promise<ArrayBuffer> {
  const scene = new Group(); scene.name = design.title;
  for (const e of design.elements) {
    const group = new Group(); group.name = e.id; group.userData = { elementId: e.id, name: e.name };
    group.position.set(...e.position); group.rotation.y = e.rotation;
    const m = design.materials.find(m => m.id === e.materialId)!;
    for (const part of geometryParts(e)) {
      const mesh = new Mesh(new BoxGeometry(...part.size), new MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness, transparent: e.kind === 'window', opacity: e.kind === 'window' ? .25 : 1 }));
      mesh.position.set(...part.position); group.add(mesh);
    }
    scene.add(group);
  }
  try { const output = await new GLTFExporter().parseAsync(scene, { binary: true }); if (!(output instanceof ArrayBuffer)) throw new Error('GLB export failed.'); return output; }
  finally { scene.traverse(o => { if (o instanceof Mesh) { o.geometry.dispose(); if (o.material instanceof MeshStandardMaterial) o.material.dispose(); } }); }
}
export function floorPlanSVG(design: Design, floor = 0) {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
  const spaces = design.spaces.filter(s => s.floor === floor);
  const minX = Math.min(...spaces.map(s => s.position[0] - s.size[0] / 2)) - 1;
  const minZ = Math.min(...spaces.map(s => s.position[2] - s.size[2] / 2)) - 1;
  const maxX = Math.max(...spaces.map(s => s.position[0] + s.size[0] / 2)) + 1;
  const maxZ = Math.max(...spaces.map(s => s.position[2] + s.size[2] / 2)) + 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${maxX-minX} ${maxZ-minZ}" width="1200" height="900"><rect x="${minX}" y="${minZ}" width="${maxX-minX}" height="${maxZ-minZ}" fill="#f4f1e8"/>${spaces.map(s => `<rect x="${s.position[0]-s.size[0]/2}" y="${s.position[2]-s.size[2]/2}" width="${s.size[0]}" height="${s.size[2]}" fill="#e4dfd0" stroke="#514c40" stroke-width=".05"/><text x="${s.position[0]}" y="${s.position[2]}" font-family="sans-serif" font-size=".35" text-anchor="middle">${esc(s.name)}</text>`).join('')}</svg>`;
}
