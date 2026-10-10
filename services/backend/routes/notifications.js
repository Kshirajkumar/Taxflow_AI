const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');

// GET /api/v1/notifications — recent database activity for the signed-in user
router.get('/', async (req, res) => {
  if (!isConnected) {
    return res.json({ success: true, source: 'demo', data: [], unreadCount: 0 });
  }

  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
    const { data, error, count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const { count: unreadCount, error: unreadError } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .is('read_at', null);
    if (unreadError) throw unreadError;

    return res.json({ success: true, source: 'supabase', data: data || [], count: count || 0, unreadCount: unreadCount || 0 });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not load notifications.' });
  }
});

// POST /api/v1/notifications/read — mark the current user's notifications as read
router.post('/read', async (req, res) => {
  if (!isConnected) return res.json({ success: true, source: 'demo', updated: 0 });

  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .is('read_at', null)
      .select('id');
    if (error) throw error;
    return res.json({ success: true, source: 'supabase', updated: data?.length || 0 });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not mark notifications as read.' });
  }
});

module.exports = router;
