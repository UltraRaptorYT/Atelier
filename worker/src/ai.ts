import OpenAI from 'openai';
import { z } from 'zod';
import type { Sandbox } from '@e2b/desktop';
import { agents, type AgentId, type Design } from '../../shared/design';
import type { Bindings } from './types';
import { credential, HttpError } from './security';
import { emit } from './store';
import { agentInstructions } from './prompts';
export async function modelJSON<T>(env: Bindings, owner: string, agent: AgentId, prompt: string, schema: z.ZodType<T>, context?: { desktop: Sandbox; projectId: string; taskId: string; design: Design | null }, images: string[] = []): Promise<T> {
  const client = new OpenAI({ apiKey: await credential(env, owner), maxRetries: 0, timeout: 120000 });
  const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(image_url => ({ type: 'input_image' as const, image_url, detail: 'high' as const }))] }];
  const tools: OpenAI.Responses.Tool[] = context ? [
    { type: 'function', name: 'read_design', description: 'Read the current canonical design from your real filesystem.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
    { type: 'function', name: 'execute_python', description: 'Run bounded Python in your isolated Linux workstation. Use /home/user/project for files. No credentials are available. Do not start persistent servers or download executable software.', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false }, strict: true },
    { type: 'function', name: 'desktop_screenshot', description: 'Inspect your current real desktop.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true },
    { type: 'function', name: 'desktop_click', description: 'Click a position on the real desktop.', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x','y'], additionalProperties: false }, strict: true },
    { type: 'function', name: 'desktop_type', description: 'Type into the focused desktop application.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, strict: true },
  ] : [];
  for (let step = 0; step < 12; step++) {
    const result = await client.responses.create({
      model: env.OPENAI_MODEL, store: false, max_output_tokens: 18000,
      instructions: `${agentInstructions(agent)}\n\nYou are ${agents[agent].name}, ${agents[agent].role} in this invocation. Return exactly the supplied JSON schema. ${context ? 'Use your actual tools to inspect or validate the work before completing. Do not narrate imagined tool activity.' : 'This invocation supplies project context only; do not require workstation access or claim tool execution.'}`,
      input, tools, tool_choice: context && step === 0 ? { type: 'function', name: 'read_design' } : 'auto',
      text: { format: { type: 'json_schema', name: 'agent_result', strict: true, schema: z.toJSONSchema(schema) } },
    });
    if (result.status === 'incomplete') throw new HttpError(422, 'The design exceeded the model output allowance. Try a smaller or more focused brief.');
    const calls = result.output.filter(item => item.type === 'function_call');
    if (!calls.length) { try { return schema.parse(JSON.parse(result.output_text)); } catch { throw new HttpError(422, 'The agent returned an invalid design. The previous revision is unchanged.'); } }
    for (const item of result.output) {
      if (item.type === 'function_call' || item.type === 'reasoning') input.push(item);
      else if (item.type === 'message') input.push({ role: 'assistant', content: item.content.filter(c => c.type === 'output_text').map(c => c.text).join('\n') });
    }
    for (const call of calls) {
      if (!context) throw new Error('Unexpected tool call');
      await emit(env, context.projectId, 'tool_started', `Using ${call.name.replaceAll('_', ' ')}.`, agent, context.taskId);
      let output: string;
      try {
        const args = JSON.parse(call.arguments);
        if (call.name === 'read_design') output = await context.desktop.files.read('/home/user/project/design.json');
        else if (call.name === 'execute_python') {
          const { code } = z.object({ code: z.string().max(12000) }).parse(args);
          await context.desktop.files.write('/home/user/project/agent_task.py', code);
          const execution = await context.desktop.commands.run('timeout 45s python3 /home/user/project/agent_task.py', { timeoutMs: 50000 });
          output = JSON.stringify({ exitCode: execution.exitCode, stdout: execution.stdout.slice(0, 8000), stderr: execution.stderr.slice(0, 2000) });
        } else if (call.name === 'desktop_click') { const { x, y } = z.object({ x: z.number().int().min(0).max(1279), y: z.number().int().min(0).max(799) }).parse(args); await context.desktop.leftClick(x, y); output = 'Clicked.'; }
        else if (call.name === 'desktop_type') { const { text } = z.object({ text: z.string().max(4000) }).parse(args); await context.desktop.write(text); output = 'Text entered.'; }
        else if (call.name === 'desktop_screenshot') {
          const bytes = await context.desktop.screenshot();
          input.push({ role: 'user', content: [{ type: 'input_image', detail: 'auto', image_url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` }] });
          output = 'Screenshot captured from the actual workstation.';
        } else throw new Error('Unknown tool');
      } catch { output = 'Tool failed. Inspect the current state and choose a recoverable next action.'; }
      input.push({ type: 'function_call_output', call_id: call.call_id, output });
      await emit(env, context.projectId, 'tool_completed', `${call.name.replaceAll('_', ' ')} ${output.startsWith('Tool failed') ? 'failed' : 'completed'}.`, agent, context.taskId);
    }
  }
  throw new HttpError(422, 'The agent reached its tool limit. Saved work is preserved.');
}
