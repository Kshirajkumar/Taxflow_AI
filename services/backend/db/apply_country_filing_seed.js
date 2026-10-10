/** Apply the country/filing seed through Supabase REST. */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const countries = [
  ['10000000-0000-4000-8000-000000000001', 'IN', 'India', 'Income Tax Department / GSTN / TRACES', 'Income Tax e-Filing / GST Portal', 'https://www.incometax.gov.in/', 'INR'],
  ['10000000-0000-4000-8000-000000000002', 'US', 'United States', 'Internal Revenue Service', 'IRS e-file / MeF', 'https://www.irs.gov/e-file-providers', 'USD'],
  ['10000000-0000-4000-8000-000000000003', 'AE', 'United Arab Emirates', 'Federal Tax Authority', 'EmaraTax', 'https://eservices.tax.gov.ae/', 'AED'],
  ['10000000-0000-4000-8000-000000000004', 'SG', 'Singapore', 'Inland Revenue Authority of Singapore', 'myTax Portal', 'https://mytax.iras.gov.sg/', 'SGD'],
  ['10000000-0000-4000-8000-000000000005', 'GB', 'United Kingdom', 'HM Revenue & Customs', 'HMRC online services / MTD', 'https://www.gov.uk/government/organisations/hm-revenue-customs', 'GBP']
].map(([id, country_code, country_name, tax_authority_name, portal_name, portal_url, currency_code]) => ({
  id, country_code, country_name, tax_authority_name, portal_name, portal_url, currency_code, is_active: true
}));

const countryId = Object.fromEntries(countries.map(c => [c.country_code, c.id]));
const specs = [
  ['IN', 'ITR-1', 'Income Tax Return ITR-1 (Sahaj)', 'Income Tax', 'Annual', 'JSON', ['JSON', 'PDF', 'XLSX'], 'online_or_offline_utility'],
  ['IN', 'ITR-3', 'Income Tax Return ITR-3', 'Income Tax', 'Annual', 'JSON', ['JSON', 'PDF', 'XLSX'], 'online_or_offline_utility'],
  ['IN', 'ITR-4', 'Income Tax Return ITR-4 (Sugam)', 'Income Tax', 'Annual', 'JSON', ['JSON', 'PDF', 'XLSX'], 'online_or_offline_utility'],
  ['IN', 'GSTR-1', 'Details of outward supplies', 'GST', 'Monthly or quarterly', 'JSON', ['JSON', 'CSV', 'XLSX', 'PDF'], 'portal_or_offline_utility'],
  ['IN', 'GSTR-3B', 'Summary return and tax payment', 'GST', 'Monthly or quarterly', 'JSON', ['JSON', 'CSV', 'XLSX', 'PDF'], 'portal_or_offline_utility'],
  ['IN', 'GSTR-9', 'Annual GST return', 'GST', 'Annual', 'JSON', ['JSON', 'XLSX', 'PDF'], 'portal'],
  ['IN', 'TDS-26Q', 'Quarterly TDS statement - resident payments', 'Withholding Tax', 'Quarterly', 'FVU', ['FVU', 'TXT', 'CSV', 'PDF'], 'RPU_or_authorised_software'],
  ['US', 'FORM-1040', 'U.S. Individual Income Tax Return', 'Income Tax', 'Annual', 'XML', ['XML', 'PDF', 'CSV'], 'IRS_MeF'],
  ['US', 'FORM-1120', 'U.S. Corporation Income Tax Return', 'Income Tax', 'Annual', 'XML', ['XML', 'PDF', 'CSV'], 'IRS_MeF'],
  ['US', 'FORM-1065', 'U.S. Return of Partnership Income', 'Income Tax', 'Annual', 'XML', ['XML', 'PDF', 'CSV'], 'IRS_MeF'],
  ['US', 'FORM-941', 'Employer Quarterly Federal Tax Return', 'Payroll', 'Quarterly', 'XML', ['XML', 'PDF', 'CSV'], 'IRS_MeF'],
  ['AE', 'VAT-201', 'VAT Return', 'VAT', 'Quarterly or monthly', 'Portal form', ['PDF', 'XLSX', 'CSV'], 'portal_form'],
  ['AE', 'CT-RETURN', 'Corporate Tax Return', 'Corporate Tax', 'Annual', 'Portal form', ['PDF', 'XLSX', 'CSV'], 'portal_form'],
  ['AE', 'EXCISE-201', 'Excise Tax Return', 'Excise Tax', 'Monthly', 'Portal form', ['PDF', 'XLSX', 'CSV'], 'portal_form'],
  ['SG', 'GST-F5', 'GST Return', 'GST', 'Quarterly or monthly', 'Portal form', ['PDF', 'XLSX', 'CSV'], 'portal_form'],
  ['SG', 'FORM-C-S', 'Corporate Income Tax Form C-S', 'Income Tax', 'Annual', 'Portal form', ['PDF', 'XLSX', 'CSV'], 'portal_form'],
  ['SG', 'FORM-C', 'Corporate Income Tax Form C', 'Income Tax', 'Annual', 'Portal form', ['PDF', 'XLSX', 'CSV'], 'portal_form'],
  ['SG', 'GST-F7', 'GST Error Correction Return', 'GST', 'As required', 'Portal form', ['PDF', 'XLSX', 'CSV'], 'portal_form'],
  ['GB', 'CT600', 'Company Tax Return', 'Corporation Tax', 'Annual', 'iXBRL', ['iXBRL', 'XML', 'PDF', 'CSV'], 'HMRC_approved_software'],
  ['GB', 'VAT-RETURN', 'VAT Return', 'VAT', 'Quarterly or monthly', 'API', ['JSON', 'XML', 'CSV', 'PDF'], 'MTD_API'],
  ['GB', 'SA100', 'Self Assessment Tax Return', 'Income Tax', 'Annual', 'Online form', ['PDF', 'CSV', 'XML'], 'online_or_approved_software']
];

const filingTypes = specs.map(([cc, code, name, filing_category, filing_frequency, output_format, accepted_file_types, submission]) => ({
  id: `20000000-0000-4000-8000-${String(specs.indexOf(specs.find(s => s[0] === cc && s[1] === code)) + 1).padStart(12, '0')}`,
  country_id: countryId[cc], code, name, description: `${name}. Baseline reference record; confirm the current authority instructions before filing.`, filing_category, filing_frequency, output_format,
  accepted_file_types, is_active: true,
  government_portal_name: countries.find(c => c.country_code === cc).portal_name,
  government_portal_url: countries.find(c => c.country_code === cc).portal_url,
  specification_version: 'Baseline reference; verify current authority release',
  specification_url: countries.find(c => c.country_code === cc).portal_url,
  format_definition: { submission, primary: output_format, supporting: accepted_file_types },
  validation_rules: { authority_validation: 'Validate against the current authority schema, portal rules and filing period' }
}));

async function run() {
  const countryResult = await db.from('supported_countries').upsert(countries, { onConflict: 'id' });
  if (countryResult.error) throw countryResult.error;
  const filingResult = await db.from('filing_types').upsert(filingTypes, { onConflict: 'id' });
  if (filingResult.error) throw filingResult.error;
  console.log(`Seeded ${countries.length} countries and ${filingTypes.length} filing types.`);
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
