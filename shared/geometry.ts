import type { DesignElement } from './design';
import furniture from './furniture.json';
export type BoxPart = { position: [number, number, number]; size: [number, number, number] };
// Both renderers consume the same elementary geometry contract.
export function geometryParts(e: DesignElement): BoxPart[] {
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
