const { supabase, isConnected } = require('../db/supabase');

async function requireClientPortalAuth(req, res, next) {
  if (!isConnected || !supabase) {
    return res.status(503).json({
      success: false,
      message: 'The client portal is temporarily unavailable.'
    });
  }

  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Sign in to access the client portal.' });
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ success: false, message: 'Sign in to access the client portal.' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({ success: false, message: 'Your portal session is invalid or has expired.' });
    }
    if (!user.email_confirmed_at) {
      return res.status(403).json({ success: false, message: 'Verify your email address before using the client portal.' });
    }

    let { data: access, error: accessError } = await supabase
      .from('client_portal_access')
      .select('client_id, invited_email, user_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle();
    if (accessError) throw accessError;

    // Auto-bind: if no access by user_id, match by invited_email (client created via desktop app)
    if (!access) {
      const { data: emailAccessMatches, error: emailAccessError } = await supabase
        .from('client_portal_access')
        .select('id, client_id, invited_email, user_id')
        .eq('invited_email', String(user.email || '').trim().toLowerCase())
        .eq('active', true)
        .limit(2);
      if (emailAccessError) throw emailAccessError;
      if ((emailAccessMatches || []).length > 1) {
        return res.status(403).json({ success: false, message: 'This email is assigned to multiple client records. Contact the practice to resolve the portal access.' });
      }
      const emailAccess = (emailAccessMatches || [])[0] || null;
      if (emailAccess?.user_id) {
        return res.status(403).json({ success: false, message: 'This portal access is already linked to a different account.' });
      }
      if (emailAccess) {
        const { error: bindError } = await supabase
          .from('client_portal_access')
          .update({ user_id: user.id })
          .eq('id', emailAccess.id)
          .is('user_id', null);
        if (bindError) throw bindError;
        const { data: boundAccess, error: verifyBindError } = await supabase
          .from('client_portal_access')
          .select('client_id, invited_email, user_id')
          .eq('id', emailAccess.id)
          .eq('user_id', user.id)
          .eq('active', true)
          .maybeSingle();
        if (verifyBindError) throw verifyBindError;
        if (!boundAccess) {
          return res.status(403).json({ success: false, message: 'This portal invitation has already been claimed by another account.' });
        }
        access = boundAccess;
      }
    }

    if (!access) {
      return res.status(403).json({ success: false, message: 'This account does not have active client portal access.' });
    }
    if (String(user.email || '').trim().toLowerCase() !== String(access.invited_email || '').trim().toLowerCase()) {
      return res.status(403).json({ success: false, message: 'This account no longer matches the client’s portal email. Contact the practice.' });
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, email, user_id, status')
      .eq('id', access.client_id)
      .eq('status', 'Active')
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) {
      return res.status(403).json({ success: false, message: 'This client portal is no longer active.' });
    }
    if (String(client.email || '').trim().toLowerCase() !== String(access.invited_email || '').trim().toLowerCase()) {
      return res.status(403).json({ success: false, message: 'The portal email on file has changed. Contact the practice for updated access.' });
    }

    req.portalUser = user;
    req.portalClient = client;
    req.accessToken = token;
    return next();
  } catch (error) {
    console.error('[Client Portal] Authentication failed:', error.message);
    return res.status(503).json({ success: false, message: 'Portal access could not be verified. Please try again shortly.' });
  }
}

module.exports = { requireClientPortalAuth };
