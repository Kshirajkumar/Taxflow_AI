/**
 * TaxFlow.AI — Authentication Routes (Production Grade)
 *
 * All auth flows are exclusively handled through Supabase.
 * - Signup  → supabase.auth.signUp  → trigger auto-creates user_profiles row
 * - Login   → supabase.auth.signInWithPassword → fetches profile + onboarding status
 * - /me     → supabase.auth.getUser(token) → validates JWT + returns profile
 * - Vault Setup → saves encrypted vault path to user_profiles in Supabase
 * - Forgot  → supabase.auth.resetPasswordForEmail → real email via Supabase SMTP
 *
 * Security:
 * - Rate limiting (5 failed attempts → 60 sec lockout) per IP+email
 * - Vault path stored in Supabase (server-side), never in localStorage or config.json
 * - No in-memory user stores, no mock credentials, no demo bypass
 * - All tokens validated with Supabase on every /me request
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');

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
    firmName: profile?.firm_name || supaUser.user_metadata?.firm_name || 'Practice Office',
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
    const { name, firmName, email, password, practiceType, membershipNo } = req.body;

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

    const { data: supaAuth, error: supaErr } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: 'taxflow://auth/callback',
        data: {
          full_name: name.trim(),
          firm_name: (firmName && firmName.trim()) || `${name.trim()} & Associates`,
          practice_type: practiceType || 'Chartered Accountant (CA)',
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
// Saves the user's selected vault folder path to Supabase
// user_profiles table. The path is stored server-side only,
// never in the browser/localStorage.
// Also marks onboarding_complete = true when called.
// ──────────────────────────────────────────────────────────
router.post('/vault-setup', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const { vaultPath } = req.body;

  if (!vaultPath || typeof vaultPath !== 'string' || vaultPath.trim().length < 3) {
    return res.status(400).json({ success: false, message: 'A valid vault folder path is required.' });
  }

  // Verify the JWT
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' });
  }

  const cleanPath = vaultPath.trim();

  // Persist to Supabase user_profiles (RLS-secured, service-role bypasses for write)
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ vault_path: cleanPath, onboarding_complete: true, updated_at: new Date().toISOString() })
    .eq('id', data.user.id);

  if (updateErr) {
    console.error('[AUTH] Vault setup save error:', updateErr.message);
    return res.status(500).json({ success: false, message: 'Failed to save vault configuration. Please try again.' });
  }

  // Also apply locally so this server instance uses the right path immediately
  try {
    const { updateVaultBaseDir } = require('../vault/vaultManager');
    updateVaultBaseDir(cleanPath);
  } catch (e) {
    console.warn('[AUTH] Local vault update failed (non-critical):', e.message);
  }

  console.log(`[AUTH] Vault configured for user ${data.user.id}: ${cleanPath}`);

  return res.json({
    success: true,
    message: 'Vault folder configured and onboarding complete.',
    vaultPath: cleanPath
  });
});

// ──────────────────────────────────────────────────────────
// PATCH /api/v1/auth/profile
// Update user profile fields (name, firmName, practiceType, membershipNo)
// ──────────────────────────────────────────────────────────
router.patch('/profile', async (req, res) => {
  if (!requireSupabase(res)) return;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No authorization token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const { name, firmName, practiceType, membershipNo } = req.body;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' });
  }

  const updates = {};
  if (name) updates.full_name = name.trim();
  if (firmName) updates.firm_name = firmName.trim();
  if (practiceType) updates.practice_type = practiceType.trim();
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
