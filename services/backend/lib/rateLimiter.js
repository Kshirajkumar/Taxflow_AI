const { supabase, isConnected } = require('../db/supabase');

const CHAT_LIMITS = Object.freeze({
  minute: { limit: 20, windowSeconds: 60 },
  day: { limit: 500, windowSeconds: 86400 },
});

class RateLimiterUnavailableError extends Error {
  constructor() {
    super('AI request protection is temporarily unavailable. Please try again shortly.');
    this.status = 503;
    this.code = 'RATE_LIMITER_UNAVAILABLE';
  }
}

async function consume(bucketKey, limit, windowSeconds) {
  if (!isConnected || !supabase) throw new RateLimiterUnavailableError();

  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error('[RateLimit] Counter unavailable:', error.message);
    throw new RateLimiterUnavailableError();
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.allowed !== 'boolean') {
    console.error('[RateLimit] Counter returned an invalid result.');
    throw new RateLimiterUnavailableError();
  }

  return {
    allowed: result.allowed,
    retryAfterSeconds: Math.max(1, Number(result.retry_after_seconds) || windowSeconds),
  };
}

async function enforceChatRateLimit(userId) {
  const minute = await consume(
    `ai:chat:user:${userId}:minute`,
    CHAT_LIMITS.minute.limit,
    CHAT_LIMITS.minute.windowSeconds,
  );
  if (!minute.allowed) return minute;

  const day = await consume(
    `ai:chat:user:${userId}:day`,
    CHAT_LIMITS.day.limit,
    CHAT_LIMITS.day.windowSeconds,
  );
  return day;
}

module.exports = { enforceChatRateLimit, RateLimiterUnavailableError };
