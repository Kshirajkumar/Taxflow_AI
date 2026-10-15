const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const { generateGeminiChat } = require('../lib/aiProvider');
const { enforceChatRateLimit } = require('../lib/rateLimiter');

function sendChatError(res, status, message, code) {
  return res.status(status).json({
    success: false,
    message,
    code: code || (status >= 500 ? 'AI_SERVICE_ERROR' : 'AI_REQUEST_ERROR'),
  });
}

router.post('/', async (req, res) => {
  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  let messages = rawMessages
    .filter(message => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
    .map(message => ({ role: message.role, content: message.content.trim().slice(0, 8000) }))
    .filter(message => message.content)
    .slice(-20);

  // Gemini conversation contents must begin with a user turn. Older clients
  // may include the local assistant welcome message as the first item.
  const firstUserMessage = messages.findIndex(message => message.role === 'user');
  messages = firstUserMessage >= 0 ? messages.slice(firstUserMessage) : [];

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return sendChatError(res, 400, 'A user message is required.');
  }

  try {
    const rateLimit = await enforceChatRateLimit(req.user.id);
    if (!rateLimit.allowed) {
      res.set('Retry-After', String(rateLimit.retryAfterSeconds));
      return sendChatError(
        res,
        429,
        'You have reached the AI chat limit. Please try again later.',
        'AI_RATE_LIMITED',
      );
    }

    const result = await generateGeminiChat({ ownerUserId: req.user.id, messages });

    const { error: usageError } = await supabase.from('ai_usage_log').insert([{
      operation: 'chat',
      model_used: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_usd: ((result.inputTokens * 0.000075 + result.outputTokens * 0.0003) / 1000),
      duration_ms: result.durationMs,
      success: true,
    }]);
    if (usageError) console.warn('[Chat] Could not log successful AI usage:', usageError.message);

    return res.json({
      success: true,
      source: 'gemini',
      data: { text: result.text, model: result.model },
    });
  } catch (error) {
    console.error('[Chat] AI request failed:', error.providerStatus ? `provider HTTP ${error.providerStatus}` : 'backend error', error.message);
    const { error: usageError } = await supabase.from('ai_usage_log').insert([{
      operation: 'chat', model_used: error.model || 'unknown', success: false, error_message: error.message,
    }]);
    if (usageError) console.warn('[Chat] Could not log failed AI usage:', usageError.message);
    const status = Number.isInteger(error.status) ? error.status : 500;
    return sendChatError(res, status, error.message, error.code);
  }
});

module.exports = router;
