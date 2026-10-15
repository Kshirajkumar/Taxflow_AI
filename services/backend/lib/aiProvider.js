const { supabase, isConnected } = require('../db/supabase');

const PROVIDER_TIMEOUT_MS = 30000;

function configurationError(message) {
  const error = new Error(message);
  error.status = 503;
  error.code = 'AI_CONFIGURATION_ERROR';
  return error;
}

async function getGeminiConfig(ownerUserId) {
  if (!isConnected || !supabase) {
    throw configurationError('AI configuration is unavailable because the database is not connected.');
  }

  const { data: integration, error: integrationError } = await supabase
    .from('integration_secrets')
    .select('id, vault_secret_id, secret_name, model_name')
    .eq('owner_user_id', ownerUserId)
    .eq('provider', 'gemini')
    .eq('secret_name', 'chat_ai_api_key')
    .eq('is_active', true)
    .maybeSingle();

  if (integrationError) throw new Error(`Could not load AI integration: ${integrationError.message}`);
  if (!integration) throw configurationError('No active Gemini chat integration is configured for this account.');
  if (!integration.model_name) throw configurationError('The Gemini integration has no model configured. Add model_name to the integration row.');

  // The key is read only on the backend through a service_role-only RPC and is never returned to clients.
  const { data: decryptedSecret, error: secretError } = await supabase
    .rpc('get_vault_secret', { p_secret_id: integration.vault_secret_id });

  if (secretError) throw new Error(`Could not read the AI secret from Vault: ${secretError.message}`);
  if (!decryptedSecret) throw configurationError('The configured Gemini Vault secret is empty or unavailable.');

  return {
    apiKey: decryptedSecret,
    model: integration.model_name,
    integrationId: integration.id,
  };
}

async function generateGeminiChat({ ownerUserId, messages }) {
  const config = await getGeminiConfig(ownerUserId);
  const startTime = Date.now();
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You are TaxFlow AI Assistant, a concise and helpful assistant for Indian tax professionals. Do not claim to file returns or access live government portals. Ask for clarification when information is missing.' }],
          },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
      }
    );
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('The AI provider took too long to respond. Please try again.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    const networkError = new Error('The AI provider could not be reached. Please try again.');
    networkError.status = 502;
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const providerError = new Error('The AI provider returned an invalid response.');
    providerError.status = 502;
    throw providerError;
  }
  if (!response.ok) {
    const providerMessage = response.status === 429
      ? 'The AI provider is busy. Please wait a moment and try again.'
      : response.status >= 500
        ? 'The AI provider is temporarily unavailable. Please try again.'
        : 'The AI provider rejected the request. Check the configured integration.';
    const error = new Error(providerMessage);
    error.status = response.status === 429 ? 429 : 502;
    error.providerStatus = response.status;
    throw error;
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();
  if (!text) {
    const emptyError = new Error('The AI provider returned no usable answer. Please try again.');
    emptyError.status = 502;
    throw emptyError;
  }

  await supabase
    .from('integration_secrets')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', config.integrationId);

  return {
    text,
    model: config.model,
    inputTokens: payload?.usageMetadata?.promptTokenCount || 0,
    outputTokens: payload?.usageMetadata?.candidatesTokenCount || 0,
    durationMs: Date.now() - startTime,
  };
}

module.exports = { getGeminiConfig, generateGeminiChat };
