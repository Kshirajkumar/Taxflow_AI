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

  req.user = data.user;
  req.accessToken = token;
  next();
}

module.exports = { requireAuth };
