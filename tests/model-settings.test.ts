import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { designReasoningEffort } from '../worker/src/model-settings';

describe('design generation reasoning configuration', () => {
  it('defaults to maximum supported API reasoning and rejects unsupported effort before a request', () => {
    expect(designReasoningEffort({ OPENAI_REASONING_EFFORT: '' })).toBe('max');
    expect(designReasoningEffort({ OPENAI_REASONING_EFFORT: ' xhigh ' })).toBe('xhigh');
    for (const effort of ['ultra', 'none', 'minimal', 'secret-value'])
      expect(() => designReasoningEffort({ OPENAI_REASONING_EFFORT: effort })).toThrow(/setting is invalid/);
  });
  it('ships Astra max consistently across deployment environments', () => {
    const config = JSON.parse(readFileSync('worker/wrangler.jsonc', 'utf8'));
    for (const name of ['local', 'staging', 'production']) {
      expect(config.env[name].vars).toMatchObject({ OPENAI_MODEL: 'gpt-6-astra', OPENAI_REASONING_EFFORT: 'max' });
    }
  });
});
