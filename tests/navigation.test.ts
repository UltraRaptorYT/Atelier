import { describe, expect, it } from 'vitest';
import { canWalkSegment, findWalkPath, isWalkable, projectWalkPosition, type NavigationBox, type NavigationPoint, type NavigationWorld } from '../shared/navigation';
import { exampleDesign } from '../shared/example';
import { geometryParts } from '../shared/geometry';

const box = (position: NavigationPoint, size: NavigationPoint, rotation = 0): NavigationBox => ({ position, size, rotation });
const floor = box([0, -.1, 0], [12, .2, 12]);
const world = (obstacles: NavigationBox[] = [], surfaces = [floor]): NavigationWorld => ({ surfaces, obstacles: [...surfaces, ...obstacles] });

function expectSafePath(w: NavigationWorld, from: NavigationPoint, to: NavigationPoint) {
  const path = findWalkPath(w, from, to);
  expect(path, `No route from ${from} to ${to}`).not.toBeNull();
  expect(path!.length).toBeGreaterThan(0);
  expect(path!.at(-1)![0]).toBeCloseTo(to[0]);
  expect(path!.at(-1)![1]).toBeCloseTo(to[1]);
  expect(path!.at(-1)![2]).toBeCloseTo(to[2]);
  let previous = from;
  for (const point of path!) {
    expect(isWalkable(w, point), `Unsupported waypoint ${point}`).toBe(true);
    expect(canWalkSegment(w, previous, point), `Unsafe segment ${previous} -> ${point}`).toBe(true);
    const count = Math.max(1, Math.ceil(Math.hypot(point[0] - previous[0], point[2] - previous[2]) / .025));
    let height = previous[1];
    for (let i = 1; i <= count; i++) {
      const feet = projectWalkPosition(w, [previous[0] + (point[0] - previous[0]) * i / count, height, previous[2] + (point[2] - previous[2]) * i / count], .2);
      expect(feet, 'Every movement sample needs supporting terrain').not.toBeNull();
      height = feet![1];
    }
    previous = point;
  }
  return path!;
}

describe('click-to-walk navigation', () => {
  it('uses a direct route on clear floors and rejects furniture, unsupported, and invalid targets', () => {
    const w = world([box([0, .5, 0], [2, 1, 2])]);
    expectSafePath(w, [-4, 0, 3], [4, 0, 3]);
    for (const target of [[0, 0, 0], [9, 0, 0], [0, 4, 0], [Infinity, 0, 0], [NaN, 0, 0], [1e100, 0, 0]] as NavigationPoint[]) expect(findWalkPath(w, [-4, 0, 3], target)).toBeNull();
    expect(findWalkPath(w, [NaN, 0, 0], [4, 0, 3])).toBeNull();
    expect(projectWalkPosition(w, [4, .1, 3])).toEqual([4, 0, 3]);
    expect(projectWalkPosition(w, [4, 3, 3])).toBeNull();
  });

  it('finds a route around walls and furniture without cutting their corners', () => {
    const w = world([box([0, 1.5, 0], [.08, 3, 6]), box([-1.1, .4, 3.2], [1.2, .8, 1])]);
    expect(canWalkSegment(w, [-4, 0, 0], [4, 0, 0])).toBe(false);
    const path = expectSafePath(w, [-4, 0, 0], [4, 0, 0]);
    expect(path.some(p => Math.abs(p[2]) > 3.26)).toBe(true);
  });

  it('respects rotated barriers and exact circular corner clearance', () => {
    const w = world([box([0, 1.5, 0], [.025, 3, 6], Math.PI / 4)]);
    expect(canWalkSegment(w, [-3, 0, 0], [3, 0, 0])).toBe(false);
    expectSafePath(w, [-3, 0, 0], [3, 0, 0]);
    const cornerWorld = world([box([0, .5, 0], [2, 1, 2])]);
    expect(isWalkable(cornerWorld, [1.2, 0, 1.2])).toBe(true);
    expectSafePath(cornerWorld, [1.2, 0, 1.2], [3, 0, 3]);
    expect(canWalkSegment(cornerWorld, [.99, 0, 1.3], [1.3, 0, .99])).toBe(false);
  });

  it('cannot tunnel through a thin complete wall or escape across a floor edge', () => {
    const w = world([box([.013, 1.5, 0], [.001, 3, 12])]);
    expect(canWalkSegment(w, [-4, 0, 0], [4, 0, 0])).toBe(false);
    expect(findWalkPath(w, [-4, 0, 0], [4, 0, 0])).toBeNull();
    expect(isWalkable(w, [-5.9, 0, 0])).toBe(false);
  });

  it('can leave a valid point whose nearest grid cell is inside an obstacle', () => {
    const w = world([box([0, .5, 0], [2, 1, 2])]);
    expect(isWalkable(w, [1.27, 0, .1])).toBe(true);
    expect(isWalkable(w, [1.2, 0, 0])).toBe(false);
    expectSafePath(w, [1.27, 0, .1], [-3, 0, -.5]);
  });

  it('treats overlapping floors as separate levels and enforces headroom', () => {
    const upper = box([0, 2.9, 0], [12, .2, 12]), w = world([], [floor, upper]);
    expectSafePath(w, [-4, 0, 0], [4, 0, 0]);
    expectSafePath(w, [-4, 3, 0], [4, 3, 0]);
    expect(findWalkPath(w, [-4, 0, 0], [-4, 3, 0])).toBeNull();
    const lowCeiling = world([], [floor, box([0, 1.5, 0], [12, .2, 12])]);
    expect(isWalkable(lowCeiling, [0, 0, 0])).toBe(false);
  });

  it('walks up and down generated-height stairs onto a connected upper landing', () => {
    const rise = 3 / 17, tread = 5 / 17;
    const steps = Array.from({ length: 17 }, (_, i) => box([0, rise * (i + 1) / 2, -2.5 + tread * (i + .5)], [1.2, rise * (i + 1), tread]));
    const lower = box([0, -.1, -4], [6, .2, 3]);
    const upper = box([0, 2.9, 4], [6, .2, 3]);
    const w = world([], [lower, ...steps, upper]);
    const path = expectSafePath(w, [0, 0, -4], [0, 3, 4]);
    expect(new Set(path.map(p => p[1])).size).toBeGreaterThan(10);
    expectSafePath(w, [0, 3, 4], [0, 0, -4]);
  });

  it('rejects unsupported upper-floor gaps even with a lower floor below them', () => {
    const left = box([-3.0025, 2.9, 0], [5.995, .2, 12]), right = box([3.0025, 2.9, 0], [5.995, .2, 12]);
    const w = world([], [floor, left, right]);
    expect(canWalkSegment(w, [-4, 3, 0], [4, 3, 0])).toBe(false);
    expect(findWalkPath(w, [-4, 3, 0], [4, 3, 0])).toBeNull();
    expect(findWalkPath(w, [-4, 3, 0], [0, 3, 0])).toBeNull();
  });

  it('rejects steps above the climb limit', () => {
    const w = world([], [box([-3, -.1, 0], [6, .2, 12]), box([3, .11, 0], [6, .2, 12])]);
    expect(findWalkPath(w, [-4, 0, 0], [4, .21, 0])).toBeNull();
  });

  it('uses actual generated model collision boxes, including its 80m ground plane', () => {
    const design = exampleDesign(), w: NavigationWorld = { surfaces: [], obstacles: [] };
    for (const element of design.elements) {
      if (['light', 'window', 'door'].includes(element.kind)) continue;
      for (const part of geometryParts(element)) {
        const c = Math.cos(element.rotation), s = Math.sin(element.rotation);
        const b = box([element.position[0] + part.position[0] * c + part.position[2] * s, element.position[1] + part.position[1], element.position[2] - part.position[0] * s + part.position[2] * c], part.size, element.rotation);
        w.obstacles.push(b);
        if (['slab', 'stair'].includes(element.kind)) w.surfaces.push(b);
      }
    }
    const ground = box([0, -.4, 0], [80, .1, 80]);
    w.surfaces.push(ground); w.obstacles.push(ground);
    expectSafePath(w, [0, 0, 3], [-5, 0, -3]);
    expectSafePath(w, [0, 0, 3], [4, 0, -3]);
    expectSafePath(w, [-20, -.35, -20], [20, -.35, -20]);
    const officeFloor = world([], [box([0, -.18, 0], [24, .35, 17])]);
    expect(findWalkPath(officeFloor, [0, 0, 7], [0, -.005, -7])).not.toBeNull();
  });

  it('supports rotated stairs and the small steps used by frame-by-frame walking', () => {
    const angle = Math.PI / 6, c = Math.cos(angle), s = Math.sin(angle);
    const rotate = ([x, y, z]: NavigationPoint): NavigationPoint => [x * c + z * s, y, -x * s + z * c];
    const rise = 3 / 17, tread = 5 / 17;
    const surfaces = [box([0, -.1, -4], [6, .2, 3]), ...Array.from({ length: 17 }, (_, i) => box([0, rise * (i + 1) / 2, -2.5 + tread * (i + .5)], [1.1, rise * (i + 1), tread])), box([0, 2.9, 4], [6, .2, 3])].map(b => ({ ...b, position: rotate(b.position), rotation: angle }));
    const w = world([], surfaces), start = rotate([0, 0, -4]), goal = rotate([0, 3, 4]);
    const path = expectSafePath(w, start, goal);
    let current = start;
    for (const point of path) {
      let steps = 0;
      while (Math.hypot(point[0] - current[0], point[2] - current[2]) > .00001 && steps++ < 1000) {
        const distance = Math.hypot(point[0] - current[0], point[2] - current[2]);
        const ratio = Math.min(1, .053 / distance);
        const candidate = projectWalkPosition(w, [current[0] + (point[0] - current[0]) * ratio, current[1], current[2] + (point[2] - current[2]) * ratio], .2);
        expect(candidate).not.toBeNull();
        expect(canWalkSegment(w, current, candidate!)).toBe(true);
        current = candidate!;
      }
    }
    expect(current[1]).toBeCloseTo(3);
  });
});
