/**
 * TaxFlow.AI — Authentication Routes (Production Grade)
 *
 * All auth flows are exclusively handled through Supabase.
 * - Signup  → supabase.auth.signUp  → trigger auto-creates user_profiles row
 * - Login   → supabase.auth.signInWithPassword → fetches profile + onboarding status
 * - /me     → supabase.auth.getUser(token) → validates JWT + returns profile
 * - Vault Setup → stores an onboarding marker; local filesystem paths stay on the machine
 * - Forgot  → supabase.auth.resetPasswordForEmail → real email via Supabase SMTP
 *
 * Security:
 * - Rate limiting (5 failed attempts → 60 sec lockout) per IP+email
 * - Desktop vault paths are persisted only in the desktop's local app configuration
 * - No in-memory user stores, no mock credentials, no demo bypass
 * - All tokens validated with Supabase on every /me request
 */

const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { deleteAccountStorage, deleteAccountVaultSecrets } = require('../lib/accountDeletion');
const ALLOWED_PRACTICE_TYPES = new Set(['Chartered Accountant (CA)', 'Individual']);
const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT';
const ACCOUNT_DELETE_CHALLENGE_LIFETIME_SECONDS = 5 * 60;

function signAccountDeletionChallenge(payload) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Account deletion challenge signing is not configured.');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAccountDeletionChallenge(token, userId) {
  if (typeof token !== 'string' || token.length > 2048) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [encodedPayload, signature] = parts;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  let actual;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(signature)) return false;
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload.sub === userId
      && Number.isInteger(payload.exp)
      && payload.exp > Math.floor(Date.now() / 1000)
      && typeof payload.nonce === 'string'
      && /^[A-Za-z0-9_-]{32}$/.test(payload.nonce);
  } catch {
    return false;
  }
}

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return value === '::1' || value.startsWith('127.') || value.startsWith('::ffff:127.');
}

// ──────────────────────────────────────────────────────────
// Rate Limiting (in-memory, per IP+email)
// Max 5 failed attempts in 60 s → 60 s lockout
// ──────────────────────────────────────────────────────────
const loginAttempts = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true, remaining: 5 };
  if (record.lockoutUntil && record.lockoutUntil > now) {
    return { allowed: false, secondsLeft: Math.ceil((record.lockoutUntil - now) / 1000) };
  }
  if (now - record.firstAttemptAt > 60000) {
    loginAttempts.delete(key);
    return { allowed: true, remaining: 5 };
  }
  if (record.count >= 5) {
    record.lockoutUntil = now + 60000;
    return { allowed: false, secondsLeft: 60 };
  }
  return { allowed: true, remaining: 5 - record.count };
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, firstAttemptAt: now };
  record.count += 1;
  if (record.count >= 5) record.lockoutUntil = now + 60000;
  loginAttempts.set(key, record);
}

function clearRateLimit(key) {
  loginAttempts.delete(key);
}

// ──────────────────────────────────────────────────────────
// Helper: fetch user_profile row from Supabase
// Uses service-role key (bypasses RLS) so backend can always read
// ──────────────────────────────────────────────────────────
async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (data) return data;
  if (error && error.code !== 'PGRST116') return null;

  const { data: created, error: createError } = await supabase
    .from('user_profiles')
    .insert([{ id: userId }])
    .select()
    .single();
  if (createError) {
    console.error('[AUTH] Profile creation error:', createError.message);
    return null;
  }
  return created;
}

// ──────────────────────────────────────────────────────────
// Helper: build sanitised user object for API responses
// vault_path is intentionally omitted from login/me — only
// the backend uses it internally when serving vault routes
// ──────────────────────────────────────────────────────────
function buildUserResponse(supaUser, profile) {
  return {
    id: supaUser.id,
    email: supaUser.email,
    name: profile?.full_name || supaUser.user_metadata?.full_name || 'Practice User',
    practiceType: profile?.practice_type || supaUser.user_metadata?.practice_type || 'Chartered Accountant (CA)',
    membershipNo: profile?.membership_no || supaUser.user_metadata?.membership_no || null,
    role: profile?.role || 'Managing Partner',
    onboardingComplete: profile?.onboarding_complete ?? false,
    vaultConfigured: !!(profile?.vault_path)
  };
}

// ──────────────────────────────────────────────────────────
// Guard: require Supabase connection
// ──────────────────────────────────────────────────────────
function requireSupabase(res) {
  if (!isConnected) {
    res.status(503).json({
      success: false,
      message: 'Cloud database is not connected. Please check the server .env configuration (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).'
    });
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────
// POST /api/v1/auth/signup
// Creates a real Supabase Auth account.
// If Supabase requires email confirmation, returns needsEmailConfirmation: true.
// A DB trigger auto-creates the user_profiles row.
// ──────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const { name, email, password, practiceType, membershipNo } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }
    const cleanPracticeType = practiceType ? String(practiceType).trim() : 'Chartered Accountant (CA)';
    if (!ALLOWED_PRACTICE_TYPES.has(cleanPracticeType)) {
      return res.status(400).json({ success: false, message: 'Practice category must be Chartered Accountant (CA) or Individual.' });
    }

    const { data: supaAuth, error: supaErr } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: 'taxflow://auth/callback',
        data: {
          full_name: name.trim(),
          practice_type: cleanPracticeType,
          membership_no: membershipNo ? membershipNo.trim() : null
        }
      }
    });

    if (supaErr) {
      console.warn('[AUTH] Signup error:', supaErr.message);
      return res.status(400).json({ success: false, message: supaErr.message });
    }

    // Email confirmation required (default Supabase behaviour)
    if (supaAuth.user && !supaAuth.session) {
      return res.status(201).json({
        success: true,
        needsEmailConfirmation: true,
        message: 'Account created! Please check your email inbox and click the confirmation link to activate your account.',
        userId: supaAuth.user.id
      });
    }

    // Auto-confirmed (if Supabase email confirmation is disabled)
    const profile = await fetchUserProfile(supaAuth.user.id);
    return res.status(201).json({
      success: true,
      needsEmailConfirmation: false,
      message: 'Practice account created successfully. Welcome to TaxFlow.AI!',
      token: supaAuth.session.access_token,
      refreshToken: supaAuth.session.refresh_token,
      user: buildUserResponse(supaAuth.user, profile)
    });

  } catch (err) {
    console.error('[AUTH] Signup exception:', err);
    return res.status(500).json({ success: false, message: 'Server error during registration. Please try again.' });
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/v1/auth/login
// Authenticates via Supabase. Returns JWT + full profile incl.
// onboarding status so the frontend knows what to show next.
// ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const { email, password } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || 'client';
    const rateKey = `${ip}_${(email || '').trim().toLowerCase()}`;

    // Rate limit check
    const rateCheck = checkRateLimit(rateKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        rateLimited: true,
        secondsLeft: rateCheck.secondsLeft,
        message: `Too many failed attempts. Please wait ${rateCheck.secondsLeft} seconds before trying again.`
      });
    }

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const { data: supaAuth, error: supaErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (supaErr || !supaAuth?.session) {
      recordFailedAttempt(rateKey);
      const updated = checkRateLimit(rateKey);
      return res.status(401).json({
        success: false,
        remainingAttempts: updated.allowed ? updated.remaining : 0,
        message: supaErr?.message === 'Email not confirmed'
          ? 'Your email address has not been confirmed. Please check your inbox and click the confirmation link.'
          : 'Invalid email or password. Please check your credentials.'
      });
    }

    clearRateLimit(rateKey);

    // Fetch profile from user_profiles table (includes onboarding status + vaultConfigured)
    const profile = await fetchUserProfile(supaAuth.user.id);

    return res.json({
      success: true,
      message: 'Login successful.',
      token: supaAuth.session.access_token,
      refreshToken: supaAuth.session.refresh_token,
      user: buildUserResponse(supaAuth.user, profile)
    });

  } catch (err) {
    console.error('[AUTH] Login exception:', err);
    return res.status(500).json({ success: false, message: 'Authentication server error. Please try again.' });
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/v1/auth/refresh
// Exchange a refresh token for a new access token when the short-lived access
// token expires during normal desktop app use.
router.post('/refresh', async (req, res) => {
  if (!requireSupabase(res)) return;

  const refreshToken = typeof req.body?.refreshToken === 'string'
    ? req.body.refreshToken.trim()
    : '';

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'A refresh token is required.' });
  }

  try {
    const { data: refreshed, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !refreshed?.session || !refreshed.user) {
      return res.status(401).json({
        success: false,
        message: 'Session is invalid or has expired. Please log in again.'
      });
    }

    const profile = await fetchUserProfile(refreshed.user.id);
    return res.json({
      success: true,
      message: 'Session refreshed.',
      token: refreshed.session.access_token,
      refreshToken: refreshed.session.refresh_token,
      user: buildUserResponse(refreshed.user, profile)
    });
  } catch (err) {
    console.error('[AUTH] Session refresh exception:', err.message);
    return res.status(401).json({
      success: false,
      message: 'Session is invalid or has expired. Please log in again.'
    });
  }
});

// POST /api/v1/auth/forgot-password
// Sends a real password reset email via Supabase
// ──────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  if (!requireSupabase(res)) return;

  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email address is required.' });

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: 'taxflow://reset-password'
  });

  if (error) {
    console.warn('[AUTH] Password reset error:', error.message);
  }

  // Always return success to avoid user enumeration
  return res.json({
    success: true,
    message: 'If an account exists for that email, a password reset link has been sent.'
  });
});

router.post('/delete-account/verify', requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password.length > 1024 || !req.user.email) {
    return res.status(400).json({ success: false, message: 'Enter your current account password to continue.' });
  }

  const ip = req.ip || req.connection?.remoteAddress || 'client';
  const rateKey = `account-delete_${ip}_${req.user.email.toLowerCase()}`;
  const rateCheck = checkRateLimit(rateKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      rateLimited: true,
      secondsLeft: rateCheck.secondsLeft,
      message: `Too many password attempts. Please wait ${rateCheck.secondsLeft} seconds before trying again.`
    });
  }

  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!process.env.SUPABASE_URL || !anonKey) {
    return res.status(503).json({
      success: false,
      message: 'Secure password verification is not configured. Ask your administrator to configure the Supabase anon/publishable key on the backend.'
    });
  }

  try {
    const authClient = createClient(process.env.SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: req.user.email,
      password
    });
    if (error || data.user?.id !== req.user.id) {
      recordFailedAttempt(rateKey);
      return res.status(401).json({
        success: false,
        message: 'The password could not be verified. Check it and try again.'
      });
    }

    await authClient.auth.signOut();
    clearRateLimit(rateKey);
    const now = Math.floor(Date.now() / 1000);
    const challenge = signAccountDeletionChallenge({
      sub: req.user.id,
      exp: now + ACCOUNT_DELETE_CHALLENGE_LIFETIME_SECONDS,
      nonce: crypto.randomBytes(24).toString('base64url')
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      success: true,
      challenge,
      expiresIn: ACCOUNT_DELETE_CHALLENGE_LIFETIME_SECONDS
    });
  } catch (error) {
    console.error('[AUTH] Account deletion password verification failed:', error.message);
    return res.status(503).json({
      success: false,
      message: 'Password verification is temporarily unavailable. Please try again.'
    });
  }
});

router.post('/delete-account/confirm', requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;
  const storageBucket = String(process.env.SUPABASE_STORAGE_BUCKET || '').trim();
  if (!storageBucket) {
    return res.status(503).json({
      success: false,
      message: 'Account deletion is not configured to clean private cloud files. Ask your administrator to set SUPABASE_STORAGE_BUCKET on the backend.'
    });
  }
  if (req.body?.confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    return res.status(400).json({
      success: false,
      message: `Type ${ACCOUNT_DELETE_CONFIRMATION} exactly to confirm permanent account deletion.`
    });
  }
  if (!verifyAccountDeletionChallenge(req.body?.challenge, req.user.id)) {
    return res.status(401).json({
      success: false,
      message: 'The password verification expired or is invalid. Verify your password again.'
    });
  }

  try {
    const { deletedObjectCount } = await deleteAccountStorage(
      supabase,
      req.user.id,
      storageBucket
    );
    const { deletedSecretCount } = await deleteAccountVaultSecrets(supabase, req.user.id);
    const { error } = await supabase.auth.admin.deleteUser(req.user.id);
    if (error) {
      console.error(`[AUTH] Account database deletion failed for ${req.user.id}:`, error.message);
      return res.status(500).json({
        success: false,
        message: 'Private cloud files were removed, but database account deletion did not finish. Your account remains active; verify the database foreign-key constraints and retry deletion.'
      });
    }

    console.info(`[AUTH] Account ${req.user.id} permanently deleted; removed ${deletedObjectCount} private cloud object(s) and ${deletedSecretCount} integration secret(s).`);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      success: true,
      message: 'Your account and account-owned cloud data were permanently deleted.',
      data: { deletedObjectCount, deletedSecretCount, localVaultPreserved: true }
    });
  } catch (error) {
    console.error(`[AUTH] Account deletion failed before auth removal for ${req.user.id}:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Account deletion did not finish. Your sign-in account was not deleted; some private cloud files or integration secrets may already have been removed. Retry, or contact support if the problem continues.'
    });
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/v1/auth/me
// Validates the bearer JWT with Supabase and returns the
// full user profile including onboarding state.
// ──────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired. Please log in again.' });
  }

  const profile = await fetchUserProfile(data.user.id);

  return res.json({
    success: true,
    user: buildUserResponse(data.user, profile)
  });
});

// ──────────────────────────────────────────────────────────
// POST /api/v1/auth/vault-setup
// Marks onboarding complete; a local backend may also apply a folder path
// supplied over loopback, but no machine-specific path is stored in Supabase.
// ──────────────────────────────────────────────────────────
router.post('/vault-setup', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const requestedVaultPath = typeof req.body?.vaultPath === 'string' ? req.body.vaultPath.trim() : '';
  if (requestedVaultPath && (!isLoopbackAddress(req.socket.remoteAddress) || !path.isAbsolute(requestedVaultPath))) {
    return res.status(400).json({ success: false, message: 'A local vault path can only be applied by a local backend.' });
  }
  if (req.body?.vaultPath !== undefined && !requestedVaultPath) {
    return res.status(400).json({ success: false, message: 'A valid local vault folder path is required.' });
  }

  // Verify the JWT
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' });
  }

  // Keep the onboarding marker but never persist a machine-specific folder path.
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ vault_path: 'desktop-local', onboarding_complete: true, updated_at: new Date().toISOString() })
    .eq('id', data.user.id);

  if (updateErr) {
    console.error('[AUTH] Local vault onboarding save error:', updateErr.message);
    return res.status(500).json({ success: false, message: 'Failed to save vault onboarding. Please try again.' });
  }

  let vaultWarnings = [];
  if (requestedVaultPath) {
    try {
      const { updateVaultBaseDir, ensureClientVaultStructure } = require('../vault/vaultManager');
      updateVaultBaseDir(requestedVaultPath);
      const { data: clients, error: clientsError } = await supabase
        .from('clients')
        .select('id, name')
        .eq('user_id', data.user.id);
      if (clientsError) throw clientsError;
      for (const client of clients || []) {
        try {
          ensureClientVaultStructure(client.name);
        } catch (clientError) {
          console.error(`[AUTH] Client vault reconciliation failed for ${client.id}:`, clientError);
          vaultWarnings.push(client.name);
        }
      }
    } catch (vaultError) {
      console.error('[AUTH] Local vault configuration failed:', vaultError);
      vaultWarnings.push('local vault');
    }
  }

  console.log(`[AUTH] Local vault onboarding completed for user ${data.user.id}.`);
  return res.json({
    success: true,
    message: 'Local vault configured and onboarding complete.',
    ...(vaultWarnings.length ? { vaultWarnings: `Could not create all local client folders: ${vaultWarnings.join(', ')}` } : {})
  });
});

// ──────────────────────────────────────────────────────────
// PATCH /api/v1/auth/profile
// Update personal profile fields (name, practiceType, membershipNo)
// ──────────────────────────────────────────────────────────
router.patch('/profile', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const { name, practiceType, membershipNo } = req.body;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' });
  }

  const updates = {};
  if (name) updates.full_name = name.trim();
  if (practiceType) {
    const cleanPracticeType = practiceType.trim();
    if (!ALLOWED_PRACTICE_TYPES.has(cleanPracticeType)) {
      return res.status(400).json({ success: false, message: 'Practice category must be Chartered Accountant (CA) or Individual.' });
    }
    updates.practice_type = cleanPracticeType;
  }
  if (membershipNo !== undefined) updates.membership_no = membershipNo ? membershipNo.trim() : null;
  updates.updated_at = new Date().toISOString();

  const { data: updatedProfile, error: updateErr } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', data.user.id)
    .select()
    .single();

  if (updateErr) {
    console.error('[AUTH] Profile update error:', updateErr.message);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }

  return res.json({
    success: true,
    message: 'Profile updated successfully.',
    user: buildUserResponse(data.user, updatedProfile)
  });
});

module.exports = router;
