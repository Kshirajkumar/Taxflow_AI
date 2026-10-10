const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');

function requireDatabase(res) {
  if (!isConnected) {
    res.status(503).json({
      success: false,
      message: 'Reference data is temporarily unavailable because the database is not connected.'
    });
    return false;
  }
  return true;
}

// GET /api/v1/metadata/countries
router.get('/countries', async (_req, res) => {
  if (!requireDatabase(res)) return;

  try {
    const { data, error } = await supabase
      .from('supported_countries')
      .select('id,country_code,country_name,tax_authority_name,portal_name,portal_url,currency_code')
      .eq('is_active', true)
      .order('country_name');
    if (error) throw error;
    return res.json({ success: true, source: 'supabase', data: data || [], count: data?.length || 0 });
  } catch (err) {
    console.error('[METADATA] Country lookup failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load supported countries. Please try again.' });
  }
});

// GET /api/v1/metadata/filing-types?countryId=<uuid>
router.get('/filing-types', async (req, res) => {
  if (!requireDatabase(res)) return;

  const countryId = typeof req.query.countryId === 'string' ? req.query.countryId.trim() : '';
  if (!countryId) {
    return res.status(400).json({ success: false, message: 'countryId is required.' });
  }

  try {
    const { data, error } = await supabase
      .from('filing_types')
      .select('id,country_id,code,name,description,filing_category,filing_frequency,output_format,accepted_file_types,government_portal_name,government_portal_url,specification_version,specification_url,format_definition,validation_rules')
      .eq('country_id', countryId)
      .eq('is_active', true)
      .order('filing_category')
      .order('code');
    if (error) throw error;
    return res.json({ success: true, source: 'supabase', data: data || [], count: data?.length || 0 });
  } catch (err) {
    console.error('[METADATA] Filing type lookup failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load filing types for this country. Please try again.' });
  }
});

module.exports = router;
