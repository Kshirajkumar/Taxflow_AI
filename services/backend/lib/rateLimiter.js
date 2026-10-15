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

  let result;
  let lastError;
  // Supabase/PostgREST can briefly reject an RPC while the database connection
  // or schema cache is recovering. Retry once, but never bypass protection.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await supabase.rpc('consume_api_rate_limit', {
      p_bucket_key: bucketKey,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (!response.error) {
      result = response.data;
      break;
    }
    lastError = response.error;
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
  }

  if (lastError) {
    console.error('[RateLimit] Counter unavailable after retry:', lastError.message);
    throw new RateLimiterUnavailableError();
  }

  const counter = Array.isArray(result) ? result[0] : result;
  if (!counter || typeof counter.allowed !== 'boolean') {
    console.error('[RateLimit] Counter returned an invalid result.');
    throw new RateLimiterUnavailableError();
  }

  return {
    allowed: counter.allowed,
    retryAfterSeconds: Math.max(1, Number(counter.retry_after_seconds) || windowSeconds),
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
