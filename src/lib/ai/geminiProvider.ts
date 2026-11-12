/**
 * CloseLoop Phase 3D.2: Gemini 2.5 Flash Provider Adapter
 * Connects securely to Google Gemini API using structured JSON output generation,
 * request timeouts, exponential backoff retries, and fail-safe credential shielding.
 */

import {
  AIProviderClient,
  AIProviderRequest,
  AIProviderResponse,
  AIProviderError,
  InvestigationResult,
} from './types';
import { InvestigationResultSchema } from './schemas';
import { PROMPT_VERSION } from './promptDefense';

export class GeminiAIProviderClient implements AIProviderClient {
  readonly providerName = 'gemini';
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly defaultTimeoutMs: number;

  constructor(apiKey?: string, modelName?: string, defaultTimeoutMs = 15000) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key || key.trim() === '') {
      throw new AIProviderError(
        'Gemini API key is not configured. Configure GEMINI_API_KEY in server environment.',
        'MISSING_PROVIDER_CREDENTIALS',
        500,
        false,
        'gemini'
      );
    }
    this.apiKey = key.trim();
    this.modelName = modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  private sanitizeErrorMessage(msg: string): string {
    if (!this.apiKey || this.apiKey.length === 0) return msg;
    return msg.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
  }

  async investigate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const timeoutMs = request.timeoutMs || this.defaultTimeoutMs;
    const maxRetries = 2;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Connect caller's abortSignal if provided
      if (request.abortSignal) {
        request.abortSignal.addEventListener('abort', () => controller.abort());
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.modelName
        )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

        const requestBody = {
          contents: [
            {
              role: 'user',
              parts: [{ text: request.userPrompt }],
            },
          ],
          systemInstruction: {
            parts: [{ text: request.systemInstruction }],
          },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1, // High determinism
            maxOutputTokens: 2048,
          },
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const status = res.status;
          const isRetryable = status === 429 || status === 503 || status === 504;

          // Mask URL to prevent accidental API key leakage
          let errorText = '';
          try {
            const errJson = await res.json();
            errorText = errJson?.error?.message || res.statusText;
          } catch {
            errorText = res.statusText;
          }

          const providerError = new AIProviderError(
            `Gemini provider error (HTTP ${status}): ${errorText.replace(/key=[^&\s]+/gi, 'key=[REDACTED]')}`,
            status === 429 ? 'RATE_LIMIT_EXCEEDED' : 'PROVIDER_API_ERROR',
            status === 429 ? 429 : 502,
            isRetryable,
            this.providerName
          );

          if (isRetryable && attempt <= maxRetries) {
            lastError = providerError;
            const backoffMs = Math.pow(2, attempt) * 500;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          throw providerError;
        }

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText || typeof rawText !== 'string') {
          throw new AIProviderError(
            'Gemini provider returned an empty or invalid content part.',
            'MALFORMED_PROVIDER_RESPONSE',
            502,
            false,
            this.providerName
          );
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          throw new AIProviderError(
            'Failed to parse JSON response from Gemini model.',
            'MALFORMED_JSON_RESPONSE',
            502,
            false,
            this.providerName
          );
        }

        // Validate strictly against schema
        const parseResult = InvestigationResultSchema.safeParse(parsedJson);
        if (!parseResult.success) {
          throw new AIProviderError(
            `Gemini response does not satisfy InvestigationResultSchema: ${JSON.stringify(
              parseResult.error.flatten()
            )}`,
            'INVALID_SCHEMA_RESPONSE',
            502,
            false,
            this.providerName
          );
        }

        return {
          provider: this.providerName,
          model: this.modelName,
          promptVersion: PROMPT_VERSION,
          schemaVersion: '1.0',
          rawText,
          structuredResult: parseResult.data as InvestigationResult,
          usage: {
            promptTokens: data?.usageMetadata?.promptTokenCount,
            completionTokens: data?.usageMetadata?.candidatesTokenCount,
            totalTokens: data?.usageMetadata?.totalTokenCount,
          },
        };
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        if (err instanceof AIProviderError) {
          lastError = err;
          if (!err.isRetryable || attempt > maxRetries) {
            throw err;
          }
        } else if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
          throw new AIProviderError(
            `Gemini request timed out after ${timeoutMs}ms.`,
            'PROVIDER_TIMEOUT',
            504,
            true,
            this.providerName
          );
        } else {
          lastError = err;
          if (attempt >= maxRetries) {
            const rawMsg = err instanceof Error ? err.message : String(err);
            throw new AIProviderError(
              `Unexpected failure calling Gemini provider: ${this.sanitizeErrorMessage(rawMsg)}`,
              'UNEXPECTED_PROVIDER_ERROR',
              502,
              false,
              this.providerName
            );
          }
        }

        const backoffMs = Math.pow(2, attempt) * 500;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    const rawMsg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new AIProviderError(
      `Unexpected failure calling Gemini provider: ${this.sanitizeErrorMessage(rawMsg)}`,
      'UNEXPECTED_PROVIDER_ERROR',
      502,
      false,
      this.providerName
    );
  }
}

