import { z } from 'zod';
import { AgentIdSchema, DesignSchema, type AgentId, type Design, type DesignElement } from './design';

const taskId = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, 'Use a lowercase task name with letters, numbers, underscores or hyphens.');
const taskKinds = ['architecture', 'interior', 'visual_direction', 'review'] as const;
const owners = { architecture: 'architect', interior: 'designer', visual_direction: 'designer', review: 'critic' } as const;
export const PlanTaskSchema = z.object({
  id: taskId,
  title: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(2000),
  kind: z.enum(taskKinds),
  agent: AgentIdSchema,
  dependencies: z.array(taskId).max(7),
  deliverables: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
}).superRefine((task, ctx) => {
  if (task.agent !== owners[task.kind]) ctx.addIssue({ code: 'custom', path: ['agent'], message: `${task.kind} tasks belong to ${owners[task.kind]}.` });
  if (new Set(task.dependencies).size !== task.dependencies.length) ctx.addIssue({ code: 'custom', path: ['dependencies'], message: 'Dependencies must be unique.' });
});
export type PlannedTask = z.infer<typeof PlanTaskSchema>;

function ancestors(tasks: readonly PlannedTask[], task: PlannedTask): Set<string> {
  const byId = new Map(tasks.map(t => [t.id, t])), visited = new Set<string>(), pending = [...task.dependencies];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(byId.get(id)?.dependencies ?? []));
  }
  return visited;
}

export const PlanSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  tasks: z.array(PlanTaskSchema).min(2).max(8),
}).superRefine((plan, ctx) => {
  const byId = new Map<string, PlannedTask>();
  for (const [i, task] of plan.tasks.entries()) {
    if (byId.has(task.id)) ctx.addIssue({ code: 'custom', path: ['tasks', i, 'id'], message: `Duplicate task ID: ${task.id}.` });
    byId.set(task.id, task);
  }
  for (const [i, task] of plan.tasks.entries()) for (const [j, dependency] of task.dependencies.entries()) {
    if (dependency === task.id || !byId.has(dependency)) ctx.addIssue({ code: 'custom', path: ['tasks', i, 'dependencies', j], message: dependency === task.id ? 'A task cannot depend on itself.' : `Unknown dependency: ${dependency}.` });
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function cyclic(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) if (cyclic(dependency)) return true;
    visiting.delete(id); visited.add(id);
    return false;
  }
  if (plan.tasks.some(task => cyclic(task.id))) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'Task dependencies contain a cycle.' });
  if (!plan.tasks.some(task => task.kind === 'architecture' || task.kind === 'interior')) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'Include at least one architecture or interior task that writes the canonical design.' });
  const finalReview = plan.tasks.some(task => {
    if (task.kind !== 'review') return false;
    const dependencies = ancestors(plan.tasks, task);
    return plan.tasks.every(other => other.id === task.id || dependencies.has(other.id));
  });
  if (!finalReview) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'A final critic review must depend transitively on every other task, including visual studies and earlier reviews.' });
});
export type CollaborationPlan = z.infer<typeof PlanSchema>;

const FreshPlanSchema = PlanSchema.superRefine((plan, ctx) => {
  const architecture = plan.tasks.filter(task => task.kind === 'architecture');
  if (!architecture.length) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'A new design needs an architecture task.' });
  if (!plan.tasks.some(task => task.kind === 'interior')) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'A new design needs an interior task.' });
  for (const [i, task] of plan.tasks.entries()) {
    if (task.kind !== 'interior') continue;
    const dependencies = ancestors(plan.tasks, task);
    if (!architecture.some(other => dependencies.has(other.id))) ctx.addIssue({ code: 'custom', path: ['tasks', i, 'dependencies'], message: 'Interior work on a new design must depend transitively on architecture.' });
  }
});

export function validatePlan(input: unknown, hasExistingDesign: boolean): CollaborationPlan {
  return (hasExistingDesign ? PlanSchema : FreshPlanSchema).parse(input);
}

/** Preserve planned order; the scheduler separately applies concurrency and role limits. */
export function readyTasks(tasks: readonly PlannedTask[], completedIds: Iterable<string>): PlannedTask[] {
  const completed = new Set(completedIds);
  return tasks.filter(task => !completed.has(task.id) && task.dependencies.every(id => completed.has(id)));
}

export class DesignMergeConflict extends Error {
  readonly code = 'design_merge_conflict';
  readonly paths: string[];
  constructor(paths: string[], message = 'Concurrent design edits conflict') {
    const unique = [...new Set(paths)].sort();
    super(`${message}: ${unique.join(', ')}`);
    this.name = 'DesignMergeConflict'; this.paths = unique;
  }
}

export class DesignScopeError extends Error {
  readonly code = 'design_scope_violation';
  readonly paths: string[];
  constructor(paths: string[], message = 'The proposal changes fields outside this agent’s responsibility') {
    const unique = [...new Set(paths)].sort();
    super(`${message}: ${unique.join(', ')}`);
    this.name = 'DesignScopeError'; this.paths = unique;
  }
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type RecordValue = { [key: string]: JsonValue };
type Identified = RecordValue & { id: string };
const isRecord = (value: JsonValue | undefined): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
function equal(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }
  return false;
}

const ownsElement = (element: DesignElement) => element.kind === 'furniture' || element.kind === 'light';
function assertDesignerScope(base: Design, proposal: Design) {
  const forbidden: string[] = [];
  for (const key of Object.keys(base) as (keyof Design)[]) {
    if (key !== 'materials' && key !== 'elements' && key !== 'assets' && !equal(base[key], proposal[key])) forbidden.push(`/${key}`);
  }
  // Asset entries originate from server registration tools. Designers may add
  // references for their furniture/lights, but cannot rewrite the old registry.
  if (!equal(base.assets, proposal.assets.slice(0, base.assets.length))) forbidden.push('/assets');
  for (const asset of proposal.assets.slice(base.assets.length)) {
    if (!proposal.elements.some(element => ownsElement(element) && element.assetId === asset.id)) forbidden.push(`/assets/${asset.id}`);
  }
  const before = new Map(base.elements.map(element => [element.id, element]));
  const after = new Map(proposal.elements.map(element => [element.id, element]));
  for (const element of base.elements) {
    const next = after.get(element.id), path = `/elements/${element.id}`;
    if (!next) { if (!ownsElement(element)) forbidden.push(path); continue; }
    if (ownsElement(element)) { if (!ownsElement(next)) forbidden.push(`${path}/kind`); continue; }
    for (const key of Object.keys(element) as (keyof DesignElement)[]) {
      if (key !== 'materialId' && !equal(element[key], next[key])) forbidden.push(`${path}/${key}`);
    }
  }
  for (const element of proposal.elements) if (!before.has(element.id) && !ownsElement(element)) forbidden.push(`/elements/${element.id}`);
  if (forbidden.length) throw new DesignScopeError(forbidden);
}

function mergeValue(base: JsonValue | undefined, latest: JsonValue | undefined, proposal: JsonValue | undefined, path: string, conflicts: string[]): JsonValue | undefined {
  if (equal(proposal, base)) return latest;
  if (equal(latest, base)) return proposal;
  if (equal(proposal, latest)) return latest;
  if (isRecord(base) && isRecord(latest) && isRecord(proposal)) {
    const merged: RecordValue = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(latest), ...Object.keys(proposal)])) {
      const value = mergeValue(base[key], latest[key], proposal[key], `${path}/${key}`, conflicts);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  // Vectors and non-identified arrays are atomic fields. Deletion versus an
  // edit, or different additions with the same ID, also requires a decision.
  conflicts.push(path);
  return latest;
}

function mergeCollection(base: Identified[], latest: Identified[], proposal: Identified[], path: string, conflicts: string[]): Identified[] {
  const before = new Map(base.map(value => [value.id, value])), current = new Map(latest.map(value => [value.id, value])), incoming = new Map(proposal.map(value => [value.id, value]));
  const result: Identified[] = [];
  // Keep current ordering, append incoming additions in their proposed order.
  // Original IDs are also visited so deletion-vs-edit cannot disappear.
  for (const id of new Set([...current.keys(), ...incoming.keys(), ...before.keys()])) {
    const value = mergeValue(before.get(id), current.get(id), incoming.get(id), `${path}/${id}`, conflicts);
    if (value !== undefined) result.push(value as Identified);
  }
  return result;
}

function invalidMergePaths(design: Design, issues: z.core.$ZodIssue[]): string[] {
  const paths: string[] = [], ids = new Map<string, string>(), materials = new Set(design.materials.map(m => m.id));
  for (const collection of ['materials', 'spaces', 'elements'] as const) for (const item of design[collection]) {
    const path = `/${collection}/${item.id}`, previous = ids.get(item.id);
    if (previous) paths.push(previous, path);
    ids.set(item.id, path);
  }
  for (const element of design.elements) {
    if (!materials.has(element.materialId)) paths.push(`/elements/${element.id}/materialId`);
    if (element.floor >= design.floors) paths.push(`/elements/${element.id}/floor`);
  }
  for (const space of design.spaces) if (space.floor >= design.floors) paths.push(`/spaces/${space.id}/floor`);
  for (const issue of issues) {
    if (!issue.path.length) continue;
    const [collection, index, ...rest] = issue.path;
    if (['materials', 'spaces', 'elements'].includes(String(collection)) && typeof index === 'number') {
      const item = design[collection as 'materials' | 'spaces' | 'elements'][index];
      paths.push(`/${[collection, item?.id ?? index, ...rest].join('/')}`);
    } else paths.push(`/${issue.path.join('/')}`);
  }
  return paths.length ? paths : ['/'];
}

/** Merge an agent's base-relative proposal into the current canonical design. */
export function mergeDesignProposal(base: Design | null, latest: Design | null, proposal: Design, agent: AgentId): Design {
  if (agent !== 'architect' && agent !== 'designer') throw new DesignScopeError(['/'], 'Only the architect and interior designer may write the canonical design');
  const incoming = DesignSchema.parse(proposal), current = latest === null ? null : DesignSchema.parse(latest);
  if (base === null) {
    if (agent !== 'architect') throw new DesignScopeError(['/'], 'The architect must establish the initial canonical design');
    if (current !== null && !equal(current, incoming)) throw new DesignMergeConflict(['/'], 'Another task already established the design; revise against its current version');
    return current ?? incoming;
  }
  const before = DesignSchema.parse(base);
  if (agent === 'designer') assertDesignerScope(before, incoming);
  if (current === null) throw new DesignMergeConflict(['/'], 'The canonical design was removed while this task was working');
  const conflicts: string[] = [], merged: RecordValue = {};
  for (const key of Object.keys(before) as (keyof Design)[]) {
    if (key === 'materials' || key === 'elements' || key === 'spaces') merged[key] = mergeCollection(before[key], current[key], incoming[key], `/${key}`, conflicts);
    else merged[key] = mergeValue(before[key], current[key], incoming[key], `/${key}`, conflicts)!;
  }
  if (conflicts.length) throw new DesignMergeConflict(conflicts);
  const result = DesignSchema.safeParse(merged);
  if (!result.success) throw new DesignMergeConflict(invalidMergePaths(merged as Design, result.error.issues), 'Combined edits do not form a valid design');
  if (agent === 'designer') {
    try { assertDesignerScope(current, result.data); }
    catch (error) {
      // A legitimate furniture edit cannot become a structural edit when the
      // architect concurrently changes that element's kind or ownership.
      if (error instanceof DesignScopeError) throw new DesignMergeConflict(error.paths, 'Concurrent structural edits changed the ownership of this proposal');
      throw error;
    }
  }
  return result.data;
}
