/**
 * CloseLoop Phase 3D.2: AI Provider Factory & Client Resolution
 * Resolves configured provider implementation with explicit model identification
 * and strict credential safety.
 */

import { AIProviderClient } from './types';
import { GeminiAIProviderClient } from './geminiProvider';
import { MockAIProviderClient } from './mockProvider';

let defaultMockInstance: MockAIProviderClient | null = null;

export function getMockProviderInstance(): MockAIProviderClient {
  if (!defaultMockInstance) {
    defaultMockInstance = new MockAIProviderClient();
  }
  return defaultMockInstance;
}

/**
 * Resolves the configured AI provider client.
 * In test environment or when AI_PROVIDER='mock', resolves MockAIProviderClient.
 * In production/staging with GEMINI_API_KEY, resolves GeminiAIProviderClient.
 */
export function resolveAIProviderClient(providerOverride?: AIProviderClient): AIProviderClient {
  if (providerOverride) {
    return providerOverride;
  }

  const explicitProvider = process.env.CLOSELOOP_AI_PROVIDER || process.env.AI_PROVIDER;
  const configuredProvider = explicitProvider
    ? explicitProvider.toLowerCase().trim()
    : process.env.NODE_ENV === 'test'
      ? 'mock'
      : 'gemini';

  if (configuredProvider === 'mock') {
    return getMockProviderInstance();
  }

  if (configuredProvider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      if (explicitProvider && explicitProvider.toLowerCase().trim() === 'gemini') {
        throw new Error(
          'AI provider is set to gemini, but GEMINI_API_KEY is not configured in server environment.'
        );
      }
      return getMockProviderInstance();
    }
    return new GeminiAIProviderClient(apiKey, process.env.GEMINI_MODEL);
  }

  throw new Error(`Unsupported AI provider configuration: '${configuredProvider}'. Supported: gemini, mock.`);
}
