import { Buffer } from 'node:buffer';
import OpenAI, { toFile } from 'openai';
import { HttpError } from './security';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface GenerateImageInput {
  apiKey: string;
  model: string;
  prompt: string;
  reference?: { bytes: Uint8Array; mime: ImageMime };
}

function providerError(error: unknown): HttpError {
  // Never expose provider messages: they can include prompts, credentials or payloads.
  const details = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown; name?: unknown } : {};
  if (['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(String(details.code))) {
    return new HttpError(402, 'Image generation needs available OpenAI credit. Check billing and project spending limits before trying again.');
  }
  if ([401, 403, 404].includes(Number(details.status)) || details.code === 'model_not_found') {
    return new HttpError(502, 'OpenAI could not authorize the image model. Check the API key, project model access and any required organization verification.');
  }
  if (details.status === 429) {
    return new HttpError(429, 'OpenAI image generation is rate limited. Wait before starting another request.');
  }
  if (['content_policy_violation', 'moderation_blocked'].includes(String(details.code))) {
    return new HttpError(422, 'OpenAI could not generate this image under its content rules. Revise the concept instructions before trying again.');
  }
  if (details.status === 408 || details.name === 'APIConnectionTimeoutError' || details.name === 'AbortError') {
    return new HttpError(504, 'Image generation timed out. OpenAI may still have processed the request; check usage before starting another paid generation.');
  }
  if (details.status === 400 || details.status === 422) {
    return new HttpError(422, 'OpenAI could not accept the image request. Check the configured image model and simplify the concept instructions or reference image.');
  }
  return new HttpError(502, 'Image generation could not be completed. It was not retried automatically; check OpenAI availability and usage before starting another paid request.');
}

function decodeImage(payload: unknown): Uint8Array {
  if (typeof payload !== 'string' || !payload.length || payload.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    throw new HttpError(502, 'OpenAI returned an empty or oversized image. No concept image was saved.');
  }
  const unpadded = payload.replace(/={1,2}$/, '');
  if (payload.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(unpadded)) {
    throw new HttpError(502, 'OpenAI returned an invalid image payload. No concept image was saved.');
  }
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES || bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new HttpError(502, 'OpenAI did not return a supported PNG image. No concept image was saved.');
  }
  return bytes;
}

export async function generateImage({ apiKey, model, prompt, reference }: GenerateImageInput): Promise<{
  bytes: Uint8Array; mime: 'image/png'; usage: unknown; revisedPrompt: string | null;
}> {
  if (reference && (!reference.bytes.length || reference.bytes.length > MAX_IMAGE_BYTES || !['image/png', 'image/jpeg', 'image/webp'].includes(reference.mime))) {
    throw new HttpError(413, 'The concept reference must be a PNG, JPEG or WebP image of at most 12 MB.');
  }

  let result: OpenAI.Images.ImagesResponse;
  try {
    // A retry can charge for a second image after an ambiguous provider failure.
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 150000, logLevel: 'off' });
    const options = { model, prompt, n: 1, quality: 'medium', size: '1536x1024', output_format: 'png', stream: false } as const;
    if (reference) {
      const extension = reference.mime === 'image/jpeg' ? 'jpg' : reference.mime.split('/')[1];
      const image = await toFile(reference.bytes, `reference.${extension}`, { type: reference.mime });
      result = await client.images.edit({ ...options, image });
    } else {
      result = await client.images.generate(options);
    }
  } catch (error) {
    throw providerError(error);
  }

  const output = result?.data?.[0];
  return {
    bytes: decodeImage(output?.b64_json),
    mime: 'image/png',
    usage: result.usage ?? null,
    revisedPrompt: typeof output?.revised_prompt === 'string' ? output.revised_prompt : null,
  };
}
