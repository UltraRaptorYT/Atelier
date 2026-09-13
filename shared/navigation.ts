export type NavigationPoint = [number, number, number];
export type NavigationBox = { position: NavigationPoint; size: NavigationPoint; rotation: number };
export type NavigationWorld = { surfaces: NavigationBox[]; obstacles: NavigationBox[] };

export const WALK_RADIUS = .26;
export const WALK_HEIGHT = 1.7;
export const MAX_STEP_HEIGHT = .2;
const GRID = .24, SAMPLE = .06, EPS = .0001, BUCKET = 2;
const MAX_VISITS = 12000, MAX_SEGMENT_SAMPLES = 4000;
const footprint = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * WALK_RADIUS, Math.sin(i * Math.PI / 4) * WALK_RADIUS])];
type Box = NavigationBox & { c: number; s: number; top: number; bottom: number; surface: boolean; minX: number; maxX: number; minZ: number; maxZ: number };
type Prepared = { buckets: Map<string, Box[]>; large: Box[]; valid: boolean };
// Callers replace the world when geometry changes, just as they replace colliders.
const cache = new WeakMap<NavigationWorld, Prepared>();
// Bound coordinates before grid arithmetic (huge finite numbers cannot safely
// be incremented by one and could otherwise stall a spatial-index loop).
const finite = (p: NavigationPoint) => p.every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
const boxKey = (b: NavigationBox) => [...b.position, ...b.size, b.rotation].join(',');
const distance = (a: NavigationPoint, b: NavigationPoint) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function prepare(world: NavigationWorld): Prepared {
  const cached = cache.get(world);
  if (cached) return cached;
  const prepared: Prepared = { buckets: new Map(), large: [], valid: true };
  cache.set(world, prepared);
  const surfaces = new Set(world.surfaces.map(boxKey));
  const unique = new Map([...world.obstacles, ...world.surfaces].map(b => [boxKey(b), b]));
  if (unique.size > 20000) { prepared.valid = false; return prepared; }
  for (const [key, b] of unique) {
    if (!finite(b.position) || !finite(b.size) || b.size.some(n => n <= 0) || !Number.isFinite(b.rotation)) { prepared.valid = false; break; }
    const c = Math.cos(b.rotation), s = Math.sin(b.rotation);
    const halfX = (Math.abs(c) * b.size[0] + Math.abs(s) * b.size[2]) / 2;
    const halfZ = (Math.abs(s) * b.size[0] + Math.abs(c) * b.size[2]) / 2;
    const box: Box = { ...b, c, s, top: b.position[1] + b.size[1] / 2, bottom: b.position[1] - b.size[1] / 2, surface: surfaces.has(key), minX: b.position[0] - halfX, maxX: b.position[0] + halfX, minZ: b.position[2] - halfZ, maxZ: b.position[2] + halfZ };
    const minX = Math.floor(box.minX / BUCKET), maxX = Math.floor(box.maxX / BUCKET), minZ = Math.floor(box.minZ / BUCKET), maxZ = Math.floor(box.maxZ / BUCKET);
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > 4096) { prepared.large.push(box); continue; }
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const id = `${x},${z}`, bucket = prepared.buckets.get(id);
      if (bucket) bucket.push(box); else prepared.buckets.set(id, [box]);
    }
  }
  return prepared;
}

function nearby(world: Prepared, x: number, z: number, radius = WALK_RADIUS): Box[] {
  const boxes = new Set(world.large);
  for (let i = Math.floor((x - radius) / BUCKET); i <= Math.floor((x + radius) / BUCKET); i++) {
    for (let j = Math.floor((z - radius) / BUCKET); j <= Math.floor((z + radius) / BUCKET); j++) {
      for (const box of world.buckets.get(`${i},${j}`) ?? []) boxes.add(box);
    }
  }
  return [...boxes].filter(b => b.minX <= x + radius && b.maxX >= x - radius && b.minZ <= z + radius && b.maxZ >= z - radius);
}

function local(box: Box, x: number, z: number): [number, number] {
  const dx = x - box.position[0], dz = z - box.position[2];
  return [dx * box.c - dz * box.s, dx * box.s + dz * box.c];
}

function contains(box: Box, x: number, z: number): boolean {
  const [lx, lz] = local(box, x, z);
  return Math.abs(lx) <= box.size[0] / 2 + EPS && Math.abs(lz) <= box.size[2] / 2 + EPS;
}

function overlaps(box: Box, x: number, z: number): boolean {
  const [lx, lz] = local(box, x, z);
  const dx = Math.max(0, Math.abs(lx) - box.size[0] / 2), dz = Math.max(0, Math.abs(lz) - box.size[2] / 2);
  return dx * dx + dz * dz < WALK_RADIUS * WALK_RADIUS - EPS * EPS;
}

function standable(boxes: Box[], point: NavigationPoint): boolean {
  const [x, y, z] = point;
  if (!boxes.some(b => b.surface && Math.abs(b.top - y) <= EPS && contains(b, x, z))) return false;
  for (const [dx, dz] of footprint) {
    if (!boxes.some(b => b.surface && Math.abs(b.top - y) <= MAX_STEP_HEIGHT + EPS && contains(b, x + dx, z + dz))) return false;
  }
  return !boxes.some(b => {
    if (b.top <= y + EPS || b.bottom >= y + WALK_HEIGHT - EPS || !overlaps(b, x, z)) return false;
    // A following stair riser may intersect the feet, but never the body's center.
    return !(b.surface && b.top <= y + MAX_STEP_HEIGHT + EPS && !contains(b, x, z));
  });
}

/** Feet positions must sit on a surface with standing clearance and edge support. */
export function isWalkable(world: NavigationWorld, point: NavigationPoint): boolean {
  const prepared = prepare(world);
  return prepared.valid && finite(point) && standable(nearby(prepared, point[0], point[2]), point);
}

function project(prepared: Prepared, point: NavigationPoint, maxDrop: number, maxRise: number): NavigationPoint | null {
  const boxes = nearby(prepared, point[0], point[2]);
  const candidates = boxes.filter(b => b.surface && b.top <= point[1] + maxRise + EPS && b.top >= point[1] - maxDrop - EPS && contains(b, point[0], point[2]));
  candidates.sort((a, b) => Math.abs(a.top - point[1]) - Math.abs(b.top - point[1]));
  for (const b of candidates) {
    const result: NavigationPoint = [point[0], b.top, point[2]];
    if (standable(boxes, result)) return result;
  }
  return null;
}

/** Snap feet vertically to nearby terrain; never relocate through a wall or to another floor. */
export function projectWalkPosition(world: NavigationWorld, point: NavigationPoint, maxDrop = .35): NavigationPoint | null {
  const prepared = prepare(world);
  return prepared.valid && finite(point) && Number.isFinite(maxDrop) && maxDrop >= 0 ? project(prepared, point, maxDrop, MAX_STEP_HEIGHT) : null;
}

// Exact segment/rectangle clipping. It also proves that very narrow floor gaps
// cannot disappear between navigation samples.
function interval(box: Box, from: NavigationPoint, to: NavigationPoint, dx = 0, dz = 0, margin = 0): [number, number] | null {
  const a = local(box, from[0] + dx, from[2] + dz), b = local(box, to[0] + dx, to[2] + dz);
  let low = 0, high = 1;
  for (const axis of [0, 1]) {
    const half = box.size[axis === 0 ? 0 : 2] / 2 + margin, delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPS * EPS) { if (Math.abs(a[axis]) > half + EPS) return null; continue; }
    const t1 = (-half - a[axis]) / delta, t2 = (half - a[axis]) / delta;
    low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
    if (high < low - EPS * EPS) return null;
  }
  return [Math.max(0, low), Math.min(1, high)];
}

function sweepOverlaps(box: Box, from: NavigationPoint, to: NavigationPoint): boolean {
  if (!interval(box, from, to, 0, 0, WALK_RADIUS)) return false;
  if (interval(box, from, to)) return true;
  const a = local(box, from[0], from[2]), b = local(box, to[0], to[2]);
  const hx = box.size[0] / 2, hz = box.size[2] / 2;
  const squaredToBox = (p: [number, number]) => Math.max(0, Math.abs(p[0]) - hx) ** 2 + Math.max(0, Math.abs(p[1]) - hz) ** 2;
  let squared = Math.min(squaredToBox(a), squaredToBox(b));
  const vx = b[0] - a[0], vz = b[1] - a[1], length = vx * vx + vz * vz;
  for (const x of [-hx, hx]) for (const z of [-hz, hz]) {
    const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / length)) : 0;
    squared = Math.min(squared, (a[0] + vx * t - x) ** 2 + (a[1] + vz * t - z) ** 2);
  }
  return squared < WALK_RADIUS * WALK_RADIUS - EPS * EPS;
}

function sweptSafe(prepared: Prepared, from: NavigationPoint, to: NavigationPoint): boolean {
  const radius = WALK_RADIUS + Math.hypot(to[0] - from[0], to[2] - from[2]) / 2;
  const boxes = nearby(prepared, (from[0] + to[0]) / 2, (from[2] + to[2]) / 2, radius);
  const low = Math.min(from[1], to[1]), high = Math.max(from[1], to[1]);
  for (const b of boxes) {
    if (b.top <= low + EPS || b.bottom >= high + WALK_HEIGHT - EPS || (b.surface && b.top <= high + MAX_STEP_HEIGHT + EPS)) continue;
    // Sweep the same circle used for standing, including rotated thin walls.
    if (sweepOverlaps(b, from, to)) return false;
  }
  const supports = boxes.filter(b => b.surface && b.top >= low - MAX_STEP_HEIGHT - EPS && b.top <= high + MAX_STEP_HEIGHT + EPS);
  for (const [dx, dz] of footprint) {
    const intervals = supports.flatMap(b => { const range = interval(b, from, to, dx, dz); return range ? [range] : []; }).sort((a, b) => a[0] - b[0]);
    let reached = 0;
    for (const range of intervals) {
      if (range[0] > reached + EPS * EPS) break;
      reached = Math.max(reached, range[1]);
    }
    if (reached < 1 - EPS * EPS) return false;
  }
  return true;
}

function trace(prepared: Prepared, from: NavigationPoint, to: NavigationPoint, exactEnd = true): NavigationPoint[] | null {
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / SAMPLE));
  if (steps > MAX_SEGMENT_SAMPLES) return null;
  const result: NavigationPoint[] = [];
  let previous = from;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const next = project(prepared, [from[0] + (to[0] - from[0]) * t, previous[1], from[2] + (to[2] - from[2]) * t], MAX_STEP_HEIGHT, MAX_STEP_HEIGHT);
    if (!next || !sweptSafe(prepared, previous, next)) return null;
    if (Math.abs(next[1] - previous[1]) > EPS) {
      if (distance(from, previous) > EPS && (!result.length || distance(result[result.length - 1], previous) > EPS)) result.push(previous);
      result.push(next);
    }
    previous = next;
  }
  if (exactEnd && Math.abs(previous[1] - to[1]) > EPS) return null;
  if (!result.length || distance(result[result.length - 1], previous) > EPS) result.push(previous);
  return result;
}

/** Validate the complete swept route, following stair heights along the segment. */
export function canWalkSegment(world: NavigationWorld, from: NavigationPoint, to: NavigationPoint): boolean {
  return isWalkable(world, from) && isWalkable(world, to) && trace(prepare(world), from, to) !== null;
}

type Node = { id: string; point: NavigationPoint; g: number; f: number; parent?: Node };
class MinHeap {
  entries: Node[] = [];
  push(node: Node) {
    const entries = this.entries;
    let i = entries.length; entries.push(node);
    while (i > 0) { const parent = (i - 1) >> 1; if (entries[parent].f <= node.f) break; entries[i] = entries[parent]; i = parent; }
    entries[i] = node;
  }
  pop(): Node | undefined {
    const first = this.entries[0], last = this.entries.pop();
    if (this.entries.length && last) {
      let i = 0;
      while (i * 2 + 1 < this.entries.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.entries.length && this.entries[child + 1].f < this.entries[child].f) child++;
        if (this.entries[child].f >= last.f) break;
        this.entries[i] = this.entries[child]; i = child;
      }
      this.entries[i] = last;
    }
    return first;
  }
}

/** Bounded, multi-level A*. Returns null for blocked or unsupported destinations. */
export function findWalkPath(world: NavigationWorld, from: NavigationPoint, to: NavigationPoint): NavigationPoint[] | null {
  const prepared = prepare(world);
  if (!prepared.valid || !finite(from) || !finite(to)) return null;
  const start = project(prepared, from, .04, .04), goal = project(prepared, to, .04, .04);
  if (!start || !goal) return null;
  const direct = trace(prepared, start, goal);
  if (direct) return direct;
  const idFor = (p: NavigationPoint) => `${Math.round(p[0] / GRID)},${Math.round(p[2] / GRID)},${Math.round(p[1] / EPS)}`;
  const open = new MinHeap(), best = new Map<string, number>();
  const offer = (point: NavigationPoint, g: number, parent?: Node) => {
    const id = idFor(point);
    if (g >= (best.get(id) ?? Infinity) - EPS) return;
    best.set(id, g); open.push({ id, point, g, f: g + distance(point, goal), parent });
  };
  // A clear position can round into a wall, so connect multiple nearby cells.
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const candidate: NavigationPoint = [(Math.round(start[0] / GRID) + dx) * GRID, start[1], (Math.round(start[2] / GRID) + dz) * GRID];
    const edge = trace(prepared, start, candidate, false);
    if (edge) offer(edge[edge.length - 1], distance(start, edge[edge.length - 1]));
  }
  let visits = 0;
  while (open.entries.length && visits++ < MAX_VISITS) {
    const current = open.pop()!;
    if (current.g > (best.get(current.id) ?? Infinity) + EPS) continue;
    if (Math.hypot(current.point[0] - goal[0], current.point[2] - goal[2]) < GRID * 1.5 && trace(prepared, current.point, goal)) {
      const route: NavigationPoint[] = [goal];
      let cursor: Node | undefined = current;
      while (cursor) { route.unshift(cursor.point); cursor = cursor.parent; }
      const result: NavigationPoint[] = [];
      let anchor = start;
      for (let i = 0; i < route.length;) {
        let end = i, segment = trace(prepared, anchor, route[i]);
        // Keep smoothing bounded on long staircases and labyrinths.
        for (let j = Math.min(route.length - 1, i + 32); j > i; j--) {
          const visible = trace(prepared, anchor, route[j]);
          if (visible) { end = j; segment = visible; break; }
        }
        if (!segment) return null;
        result.push(...segment); anchor = route[end]; i = end + 1;
      }
      return result;
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const candidate: NavigationPoint = [current.point[0] + dx * GRID, current.point[1], current.point[2] + dz * GRID];
      const edge = trace(prepared, current.point, candidate, false);
      if (edge) { const end = edge[edge.length - 1]; offer(end, current.g + distance(current.point, end), current); }
    }
  }
  return null;
}
