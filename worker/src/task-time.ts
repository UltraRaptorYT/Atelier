import { HttpError } from './security';

// Keep one minute for result persistence inside the Workflow checkpoint and
// two more for allocation within the existing fifteen-minute workstation lease.
export const TASK_WORK_MS = 12 * 60_000;
export const TASK_STEP_TIMEOUT = '13 minutes' as const;
export const PROPOSAL_MODEL_ROUNDS = 24;
export const PROPOSAL_FINISH_MS = 60_000;
// Design reasoning can legitimately take several minutes. Its request ceiling
// stays below the shared task clock and checkpoint.
// Interactive questions retain their existing two-minute transport policy.
export const DESIGN_MODEL_REQUEST_MS = 8 * 60_000;
export const INTERACTIVE_MODEL_REQUEST_MS = 2 * 60_000;

export class ModelRequestTimeoutError extends HttpError {
  constructor(role: string, allowanceMs: number) {
    super(408, `${role} did not return a model response within its ${Math.ceil(allowanceMs / 1000)}-second allowance. Your brief, saved revisions and inspection artifacts are preserved. Start a new run to retry this work.`);
  }
}

export class TaskTimeError extends HttpError {
  constructor() {
    super(408, 'The specialist reached its task time allowance. Saved revisions and inspection artifacts are preserved; unfinished work was not published.');
  }
}

/** One clock shared by model rounds, Python, asset compilation and previews. */
export class TaskTimeBudget {
  private readonly deadline: number;
  constructor(durationMs = TASK_WORK_MS, private readonly now: () => number = Date.now) {
    this.deadline = now() + durationMs;
  }
  remainingMs() { return Math.max(0, Math.floor(this.deadline - this.now())); }
  check() { if (this.remainingMs() <= 0) throw new TaskTimeError(); }
  allowance(maximumMs: number, reserveMs = 0, minimumMs = 1000) {
    const available = Math.min(maximumMs, this.remainingMs() - reserveMs);
    if (available < minimumMs) throw new TaskTimeError();
    return available;
  }
}
