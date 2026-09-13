import { describe, expect, it } from 'vitest';
import { TaskTimeBudget, TaskTimeError } from '../worker/src/task-time';

describe('shared specialist task time', () => {
  it('counts prior model and tool work against later operations while preserving finalization time', () => {
    let now = 0;
    const budget = new TaskTimeBudget(540000, () => now);
    expect(budget.allowance(120000)).toBe(120000);
    now += 400000;
    expect(budget.allowance(120000, 60000)).toBe(80000);
    now += 80000;
    expect(() => budget.allowance(10000, 60000)).toThrow(TaskTimeError);
    expect(budget.allowance(10000)).toBe(10000);
    now += 60000;
    expect(budget.remainingMs()).toBe(0);
    expect(() => budget.check()).toThrow(TaskTimeError);
    expect(() => budget.allowance(1000)).toThrow(TaskTimeError);
  });
});
