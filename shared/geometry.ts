import type { DesignElement, Material } from './design';
import furniture from './furniture.json';
export type BoxPart = { position: [number, number, number]; size: [number, number, number] };
// Both renderers consume the same elementary geometry contract.
export function geometryParts(e: DesignElement): BoxPart[] {
  if (e.geometry) return [];
  if (e.assetId && e.assetId.startsWith('atelier-')) {
    const parts = furniture[e.assetId.slice(8) as keyof typeof furniture];
    if (parts) return parts.map(p=>({position:p.position.map((v,i)=>v*e.size[i]) as BoxPart['position'],size:p.size.map((v,i)=>v*e.size[i]) as BoxPart['size']}));
  }
  if (e.kind !== 'stair') return [{ position: [0, 0, 0], size: e.size }];
  const [width, height, length] = e.size;
  const count = Math.max(2, Math.ceil(height / .18));
  return Array.from({ length: count }, (_, i) => {
    const h = height * (i + 1) / count;
    return { size: [width, h, length / count] as [number, number, number], position: [0, -height / 2 + h / 2, -length / 2 + length * (i + .5) / count] as [number, number, number] };
  });
}

export function meshGeometry(e: DesignElement): { vertices: number[]; indices: number[] } | null {
  if (!e.geometry) return null;
  return { vertices: e.geometry.vertices.flatMap(vertex => vertex.map((value, axis) => value * e.size[axis])), indices: e.geometry.triangles.flat() };
}

/** Explicit material properties take priority; old saved doors/windows retain their appearance. */
export function materialAppearance(material: Material, element: Pick<DesignElement, 'kind'>) {
  const explicit = material.opacity != null || material.transmission != null;
  return {
    opacity: material.opacity ?? (explicit ? 1 : element.kind === 'window' ? .25 : element.kind === 'door' ? .4 : 1),
    transmission: material.transmission ?? (!explicit && element.kind === 'window' ? .9 : 0),
  };
}
