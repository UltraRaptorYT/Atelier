import shared from '../../prompts/shared.md';
import principal from '../../prompts/agents/director.md';
import architect from '../../prompts/agents/architect.md';
import designer from '../../prompts/agents/interior-designer.md';
import critic from '../../prompts/agents/critic.md';
import type { AgentId } from '../../shared/design';

const roles: Record<AgentId, string> = { principal, architect, designer, critic };

/** Versioned Markdown is the active source; runtime context stays separate. */
export function agentInstructions(agent: AgentId): string {
  return `${shared}\n\n${roles[agent]}`;
}
