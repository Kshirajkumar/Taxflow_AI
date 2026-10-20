const { supabase, isConnected } = require('../db/supabase');

/** Validate the Supabase access token before any private API route runs. */
async function requireAuth(req, res, next) {
  if (!isConnected) {
    return res.status(503).json({
      success: false,
      message: 'Authentication is unavailable because Supabase is not configured.'
    });
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication is required.' });
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication is required.' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: 'Session is invalid or has expired.' });
  }

  if (data.user.app_metadata?.taxflow_client_portal === true) {
    return res.status(403).json({ success: false, message: 'Client portal accounts cannot access staff services.' });
  }

  const { data: portalAccess, error: portalAccessError } = await supabase
    .from('client_portal_access')
    .select('id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (portalAccessError) {
    console.error('[Auth] Client portal separation check failed:', portalAccessError.message);
    return res.status(503).json({ success: false, message: 'Staff access could not be verified. Please try again shortly.' });
  }
  if (portalAccess) {
    return res.status(403).json({ success: false, message: 'Client portal accounts cannot access staff services.' });
  }
  if (data.user.email) {
    const { data: invitedEmail, error: invitedEmailError } = await supabase
      .from('client_portal_access')
      .select('id')
      .eq('invited_email', data.user.email.trim().toLowerCase())
      .limit(1)
      .maybeSingle();
    if (invitedEmailError) {
      console.error('[Auth] Client portal email separation check failed:', invitedEmailError.message);
      return res.status(503).json({ success: false, message: 'Staff access could not be verified. Please try again shortly.' });
    }
    if (invitedEmail) {
      return res.status(403).json({ success: false, message: 'Client portal accounts cannot access staff services.' });
    }
  }

  req.user = data.user;
  req.accessToken = token;
  next();
}

module.exports = { requireAuth };
