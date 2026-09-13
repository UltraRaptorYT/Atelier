import shared from '../../prompts/shared.md';
import principal from '../../prompts/agents/director.md';
import architect from '../../prompts/agents/architect.md';
import designer from '../../prompts/agents/interior-designer.md';
import critic from '../../prompts/agents/critic.md';
import type { AgentId } from '../../shared/design';

const roles: Record<AgentId, string> = { principal, architect, designer, critic };

/** Versioned Markdown is the active source; runtime context stays separate. */
export function agentInstructions(agent: AgentId, profile?: 'briefing'): string {
  // Briefing does not need the larger geometry, planning and review manuals.
  if (profile === 'briefing') return 'You are attending an architecture project briefing. Extract the client requirements accurately and concisely into only the supplied schema. Preserve explicit constraints and accepted answers; do not invent facts or duplicate superseded requirements. Ask only high-impact unanswered questions. Infer reversible defaults when authorized, and label assumptions. Do not design geometry, create a task plan, perform a review, or claim tools have run. Do not reproduce the original request or answer history unless the response schema asks for it; the application preserves those records. Finish the small requested record directly.';
  return `${shared}\n\n${roles[agent]}`;
}
