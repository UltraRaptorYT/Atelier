import { HttpError } from './security';
import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';

export type WorkflowResult<T> = { __atelierWorkflowResult: 1 } & ({ ok: true; value: T } | { ok: false; status: number; message: string });

/** Encode only errors created by this application before Workflow loses prototypes. */
export async function workflowResult<T>(work: () => Promise<T>): Promise<WorkflowResult<T>> {
  try { return { __atelierWorkflowResult: 1, ok: true, value: await work() }; }
  catch (error) {
    if (error instanceof HttpError) return { __atelierWorkflowResult: 1, ok: false, status: error.status, message: error.message };
    // Never trust a provider/plain object's name, status or message as public.
    throw error;
  }
}
export function workflowValue<T>(result: WorkflowResult<T> | T): T {
  // Existing successful checkpoints contain the original unwrapped value.
  // Keep their step names and receipts so an upgrade never repeats paid work.
  if (!result || typeof result !== 'object' || !('__atelierWorkflowResult' in result) || result.__atelierWorkflowResult !== 1) return result as T;
  const receipt = result as WorkflowResult<T>;
  if (!receipt.ok) throw new HttpError(receipt.status, receipt.message);
  return receipt.value;
}

export async function checkedWorkflowStep<T extends Rpc.Serializable<T>>(step: WorkflowStep, name: string, options: WorkflowStepConfig, work: () => Promise<T>): Promise<T> {
  const result = await step.do(name, options, () => workflowResult(work));
  return workflowValue(result);
}
