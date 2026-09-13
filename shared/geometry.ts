import type { DesignElement } from './design';
export type BoxPart = { position: [number, number, number]; size: [number, number, number] };
// Both renderers consume the same elementary geometry contract.
export function geometryParts(e: DesignElement): BoxPart[] {
  if (e.kind !== 'stair') return [{ position: [0, 0, 0], size: e.size }];
  const [width, height, length] = e.size;
  const count = Math.max(2, Math.ceil(height / .18));
  return Array.from({ length: count }, (_, i) => {
    const h = height * (i + 1) / count;
    return { size: [width, h, length / count] as [number, number, number], position: [0, -height / 2 + h / 2, -length / 2 + length * (i + .5) / count] as [number, number, number] };
  });
}
