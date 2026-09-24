import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { EditParams } from '@raw/shared';
import { ANALYZE_SYSTEM, INSTRUCT_SYSTEM } from './prompts.ts';
import { InstructSchema, ModelEditSchema, type InstructEdit, type ModelEdit } from './schema.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5';

export class ClaudeUnavailableError extends Error {}
export class ClaudeResponseError extends Error {}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ClaudeUnavailableError('ANTHROPIC_API_KEY is not set on the server');
  // Serverless functions are capped at 60 s; fail fast rather than retrying into the limit.
  client ??= new Anthropic({ timeout: 50_000, maxRetries: 1 });
  return client;
}

const model = () => process.env.CLAUDE_MODEL || DEFAULT_MODEL;

export interface AnalyzeInput {
  imageBase64: string;
  meta: Record<string, unknown>;
  stats: Record<string, unknown>;
  histogramSuggestion: EditParams;
}

async function structuredCall<S extends z.ZodType>(
  schema: S,
  system: string,
  content: Anthropic.ContentBlockParam[],
): Promise<z.infer<S>> {
  let response;
  try {
    response = await getClient().messages.parse({
      model: model(),
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(schema) },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    // HTTP/API failures keep their typed class; a local parse failure means the reply
    // (e.g. a refusal or a truncated answer) didn't match the schema.
    if (err instanceof Anthropic.APIError || !(err instanceof Anthropic.AnthropicError)) throw err;
    throw new ClaudeResponseError('Claude returned an answer that could not be used');
  }
  if (response.stop_reason === 'refusal') throw new ClaudeResponseError('Claude declined to edit this image');
  if (response.stop_reason === 'max_tokens') throw new ClaudeResponseError('Claude ran out of output tokens');
  if (!response.parsed_output) throw new ClaudeResponseError('Claude returned output that did not match the schema');
  return response.parsed_output as z.infer<S>;
}

const jpeg = (data: string): Anthropic.ImageBlockParam => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data },
});

export function analyzePhoto(input: AnalyzeInput): Promise<ModelEdit> {
  return structuredCall(ModelEditSchema, ANALYZE_SYSTEM, [
    jpeg(input.imageBase64),
    {
      type: 'text',
      text: [
        'Capture metadata:',
        JSON.stringify(input.meta),
        'Statistics of the neutral render (scene-linear luminance percentiles and clipping):',
        JSON.stringify(input.stats),
        "The histogram algorithm's suggestion (same parameter semantics):",
        JSON.stringify(summarize(input.histogramSuggestion)),
        'Return your professional edit for this photo.',
      ].join('\n'),
    },
  ]);
}

export function instructEdit(input: { imageBase64: string; params: EditParams; instruction: string }): Promise<InstructEdit> {
  return structuredCall(InstructSchema, INSTRUCT_SYSTEM, [
    jpeg(input.imageBase64),
    {
      type: 'text',
      text: [
        'Current parameters:',
        JSON.stringify({ ...summarize(input.params), toneCurve: input.params.curve.luma.map(([x, y]) => ({ x, y })) }),
        '',
        `Request: ${input.instruction}`,
      ].join('\n'),
    },
  ]);
}

/** Only the fields the model controls, so the JSON it sees mirrors the JSON it returns. */
function summarize(p: EditParams) {
  return { wb: p.wb, light: p.light, color: p.color, hsl: p.hsl, detail: p.detail };
}
