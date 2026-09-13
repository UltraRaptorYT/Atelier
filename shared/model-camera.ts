import type { Design, DesignElement } from './design';

type Point = [number, number, number];
export type ModelCamera = { position: Point; target: Point; front: [number, number]; radius: number };

function entranceRank(element: DesignElement): number {
  if (element.kind !== 'door') return 0;
  const words = `${element.id} ${element.name}`.toLowerCase().split(/[^a-z]+/);
  return words.includes('exterior') ? 4 : words.includes('front') ? 3 : words.includes('entrance') ? 2 : words.includes('entry') ? 1 : 0;
}

/** Frame the entrance facade, accounting for translated and rotated geometry. */
export function modelOrbitCamera(design?: Pick<Design, 'elements'> | null): ModelCamera {
  if (!design?.elements.length) return { position: [9.5, 5.5, -10.5], target: [0, 0, 0], front: [0, -1], radius: 5 };
  const min: Point = [Infinity, Infinity, Infinity], max: Point = [-Infinity, -Infinity, -Infinity];
  for (const element of design.elements) {
    const cosine = Math.abs(Math.cos(element.rotation)), sine = Math.abs(Math.sin(element.rotation));
    const half = [(element.size[0] * cosine + element.size[2] * sine) / 2, element.size[1] / 2, (element.size[0] * sine + element.size[2] * cosine) / 2];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], element.position[axis] - half[axis]);
      max[axis] = Math.max(max[axis], element.position[axis] + half[axis]);
    }
  }
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const hx = (max[0] - min[0]) / 2, hz = (max[2] - min[2]) / 2, height = max[1] - min[1];
  const perimeterDistance = (element: DesignElement) => Math.min(hx - Math.abs(element.position[0] - cx), hz - Math.abs(element.position[2] - cz));
  const entrance = design.elements.filter(element => entranceRank(element) > 0).sort((a, b) => entranceRank(b) - entranceRank(a) || perimeterDistance(a) - perimeterDistance(b))[0];
  let front: [number, number] = [0, -1];
  if (entrance) {
    const dx = (entrance.position[0] - cx) / hx, dz = (entrance.position[2] - cz) / hz;
    if (Math.max(Math.abs(dx), Math.abs(dz)) > .01) front = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
  }
  const radius = Math.max(hx, hz, 5), right = [-front[1], front[0]];
  return {
    position: [cx + radius * (front[0] * 2.1 + right[0] * 1.9), min[1] + Math.max(height * 1.35, radius * 1.1), cz + radius * (front[1] * 2.1 + right[1] * 1.9)],
    target: [cx, min[1] + height * .38, cz], front, radius,
  };
}
