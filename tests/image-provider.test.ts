import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateImage } from '../worker/src/image-provider';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), edit: vi.fn(), toFile: vi.fn(), client: vi.fn() }));
vi.mock('openai', () => ({
  default: class OpenAI {
    images = { generate: mocks.generate, edit: mocks.edit };
    constructor(options: unknown) { mocks.client(options); }
  },
  toFile: mocks.toFile,
}));

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const input = { apiKey: 'private-provider-test-key', model: 'gpt-image-2.5-flare', prompt: 'A playful red courtyard house.' };
const usage = { input_tokens: 32, output_tokens: 400, total_tokens: 432 };
const response = () => ({ data: [{ b64_json: png.toString('base64') }], usage });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generate.mockResolvedValue(response());
  mocks.edit.mockResolvedValue(response());
  mocks.toFile.mockResolvedValue({ name: 'reference.png', type: 'image/png' });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('image provider contract', () => {
  it('generates one bounded PNG with the requested model and no automatic retries or SDK logging', async () => {
    const result = await generateImage(input);
    expect(mocks.client).toHaveBeenCalledWith({ apiKey: input.apiKey, maxRetries: 0, timeout: 150000, logLevel: 'off' });
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith({
      model: input.model, prompt: input.prompt, n: 1, quality: 'medium', size: '1536x1024', output_format: 'png', stream: false,
    });
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(mocks.toFile).not.toHaveBeenCalled();
    expect(result).toEqual({ bytes: png, mime: 'image/png', usage, revisedPrompt: null });
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
  });

  it.each([
    ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
  ] as const)('uploads an existing %s reference without fetching a URL', async (mime, extension) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = { name: `reference.${extension}`, type: mime };
    mocks.toFile.mockResolvedValue(file);
    mocks.edit.mockResolvedValue({ data: [{ b64_json: png.toString('base64'), revised_prompt: 'Preserved the layout and changed the palette.' }] });
    const result = await generateImage({ ...input, model: 'gpt-image-2.5-sunburst', reference: { bytes: png, mime } });
    expect(mocks.toFile).toHaveBeenCalledExactlyOnceWith(png, `reference.${extension}`, { type: mime });
    expect(mocks.edit).toHaveBeenCalledExactlyOnceWith({
      model: 'gpt-image-2.5-sunburst', prompt: input.prompt, image: file, n: 1,
      quality: 'medium', size: '1536x1024', output_format: 'png', stream: false,
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.usage).toBeNull();
    expect(result.revisedPrompt).toContain('Preserved the layout');
  });

  it.each([
    ['missing output', {}], ['empty output', { data: [] }],
    ['URL-only output', { data: [{ url: 'https://untrusted.example/image.png' }] }],
    ['malformed base64', { data: [{ b64_json: 'not!valid!base64!' }] }],
    ['invalid padding', { data: [{ b64_json: 'iVB=ORw0KGgo' }] }],
    ['non-PNG output', { data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }],
    ['truncated signature', { data: [{ b64_json: png.subarray(0, 7).toString('base64') }] }],
  ])('rejects %s without fetching or exposing provider data', async (_name, output) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.generate.mockResolvedValue(output);
    await expect(generateImage(input)).rejects.toMatchObject({ status: 502 });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized output before decoding it', async () => {
    mocks.generate.mockResolvedValue({ data: [{ b64_json: 'A'.repeat(16 * 1024 * 1024 + 4) }] });
    await expect(generateImage(input)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('oversized') });
  });

  it.each([0, 12 * 1024 * 1024 + 1])('rejects a %i-byte reference before making a paid request', async length => {
    await expect(generateImage({ ...input, reference: { bytes: new Uint8Array(length), mime: 'image/png' } })).rejects.toMatchObject({ status: 413 });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 401 }, 502, 'API key'],
    [{ status: 403 }, 502, 'model access'],
    [{ status: 404, code: 'model_not_found' }, 502, 'model access'],
    [{ status: 429, code: 'insufficient_quota' }, 402, 'billing'],
    [{ status: 400, code: 'billing_hard_limit_reached' }, 402, 'spending limits'],
    [{ status: 429, code: 'rate_limit_exceeded' }, 429, 'Wait'],
    [{ status: 400, code: 'moderation_blocked' }, 422, 'Revise'],
    [{ status: 400 }, 422, 'configured image model'],
    [{ name: 'APIConnectionTimeoutError' }, 504, 'check usage'],
    [{ status: 503 }, 502, 'not retried automatically'],
    [{ name: 'APIConnectionError' }, 502, 'not retried automatically'],
  ] as const)('sanitizes provider failure %j and does not retry', async (details, status, advice) => {
    mocks.generate.mockRejectedValue(Object.assign(new Error(`Private provider details: ${input.apiKey} ${input.prompt}`), details));
    const error = await generateImage(input).catch(error => error);
    expect(error.status).toBe(status);
    expect(error.message).toContain(advice);
    expect(error.message).not.toContain(input.apiKey);
    expect(error.message).not.toContain(input.prompt);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
