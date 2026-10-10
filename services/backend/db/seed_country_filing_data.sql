/**
 * TaxFlow.AI - country and filing master data
 *
 * This is baseline reference data for the supported countries. It describes
 * the filing systems and exchange formats; it is not a substitute for the
 * current instructions published by each tax authority.
 *
 * Safe to run repeatedly. The country and filing IDs are stable so client
 * selections can keep their foreign-key relationships across deployments.
 */

INSERT INTO supported_countries (
  id, country_code, country_name, tax_authority_name, portal_name,
  portal_url, currency_code, is_active
)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'IN', 'India', 'Income Tax Department / GSTN / TRACES', 'Income Tax e-Filing / GST Portal', 'https://www.incometax.gov.in/', 'INR', TRUE),
  ('10000000-0000-4000-8000-000000000002', 'US', 'United States', 'Internal Revenue Service', 'IRS e-file / MeF', 'https://www.irs.gov/e-file-providers', 'USD', TRUE),
  ('10000000-0000-4000-8000-000000000003', 'AE', 'United Arab Emirates', 'Federal Tax Authority', 'EmaraTax', 'https://eservices.tax.gov.ae/', 'AED', TRUE),
  ('10000000-0000-4000-8000-000000000004', 'SG', 'Singapore', 'Inland Revenue Authority of Singapore', 'myTax Portal', 'https://mytax.iras.gov.sg/', 'SGD', TRUE),
  ('10000000-0000-4000-8000-000000000005', 'GB', 'United Kingdom', 'HM Revenue & Customs', 'HMRC online services / MTD', 'https://www.gov.uk/government/organisations/hm-revenue-customs', 'GBP', TRUE)
ON CONFLICT (id) DO UPDATE SET
  country_code = EXCLUDED.country_code,
  country_name = EXCLUDED.country_name,
  tax_authority_name = EXCLUDED.tax_authority_name,
  portal_name = EXCLUDED.portal_name,
  portal_url = EXCLUDED.portal_url,
  currency_code = EXCLUDED.currency_code,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO filing_types (
  id, country_id, code, name, description, filing_category, filing_frequency,
  output_format, accepted_file_types, government_portal_name,
  government_portal_url, specification_version, specification_url,
  format_definition, validation_rules, is_active
)
VALUES
  -- India: Income tax, GST and withholding
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ITR-1', 'Income Tax Return ITR-1 (Sahaj)', 'Resident individual return for salary, one house property and other eligible income.', 'Income Tax', 'Annual', 'JSON', ARRAY['JSON', 'PDF', 'XLSX'], 'Income Tax e-Filing', 'https://www.incometax.gov.in/', 'AY 2025-26 baseline', 'https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns', '{"submission":"online_or_offline_utility","primary":"JSON","supporting":["PDF","XLSX"]}', '{"required":["PAN","assessment_year","income_schedules","bank_details"],"authority_validation":"portal_schema_and_rules"}', TRUE),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'ITR-3', 'Income Tax Return ITR-3', 'Return for individuals and HUFs with business or professional income.', 'Income Tax', 'Annual', 'JSON', ARRAY['JSON', 'PDF', 'XLSX'], 'Income Tax e-Filing', 'https://www.incometax.gov.in/', 'AY 2025-26 baseline', 'https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns', '{"submission":"online_or_offline_utility","primary":"JSON","supporting":["PDF","XLSX"]}', '{"required":["PAN","assessment_year","profit_and_loss","balance_sheet"],"authority_validation":"portal_schema_and_rules"}', TRUE),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'ITR-4', 'Income Tax Return ITR-4 (Sugam)', 'Presumptive income return for eligible individuals, HUFs and firms.', 'Income Tax', 'Annual', 'JSON', ARRAY['JSON', 'PDF', 'XLSX'], 'Income Tax e-Filing', 'https://www.incometax.gov.in/', 'AY 2025-26 baseline', 'https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns', '{"submission":"online_or_offline_utility","primary":"JSON","supporting":["PDF","XLSX"]}', '{"required":["PAN","assessment_year","presumptive_income_details"],"authority_validation":"portal_schema_and_rules"}', TRUE),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'GSTR-1', 'Details of outward supplies', 'Statement of taxable outward supplies and invoices under GST.', 'GST', 'Monthly or quarterly', 'JSON', ARRAY['JSON', 'CSV', 'XLSX', 'PDF'], 'GST Portal', 'https://www.gst.gov.in/', 'Current portal schema', 'https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm', '{"submission":"portal_or_offline_utility","primary":"JSON","supporting":["CSV","XLSX","PDF"]}', '{"required":["gstin","tax_period","invoice_register","tax_rate_summary"],"authority_validation":"GSTN_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'GSTR-3B', 'Summary return and tax payment', 'Summary GST return reporting liability, input tax credit and tax payable.', 'GST', 'Monthly or quarterly', 'JSON', ARRAY['JSON', 'CSV', 'XLSX', 'PDF'], 'GST Portal', 'https://www.gst.gov.in/', 'Current portal schema', 'https://tutorial.gst.gov.in/downloads/gstr3bofflineutility.pdf', '{"submission":"portal_or_offline_utility","primary":"JSON","supporting":["CSV","XLSX","PDF"]}', '{"required":["gstin","tax_period","outward_taxable_value","input_tax_credit","tax_payable"],"authority_validation":"GSTN_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'GSTR-9', 'Annual GST return', 'Annual consolidation of GST supplies, tax paid and input tax credit.', 'GST', 'Annual', 'JSON', ARRAY['JSON', 'XLSX', 'PDF'], 'GST Portal', 'https://www.gst.gov.in/', 'Current portal schema', 'https://www.gst.gov.in/', '{"submission":"portal","primary":"JSON","supporting":["XLSX","PDF"]}', '{"required":["gstin","financial_year","annual_supply_summary","tax_paid_summary"],"authority_validation":"GSTN_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'TDS-26Q', 'Quarterly TDS statement - resident payments', 'Quarterly statement for tax deducted at source on payments other than salary.', 'Withholding Tax', 'Quarterly', 'FVU', ARRAY['FVU', 'TXT', 'CSV', 'PDF'], 'TRACES / TDS CPC', 'https://www.tdscpc.gov.in/', 'Current FVU specification', 'https://www.tdscpc.gov.in/', '{"submission":"RPU_or_authorised_software","primary":"FVU","supporting":["TXT","CSV","PDF"]}', '{"required":["tan","quarter","challans","deductee_rows"],"authority_validation":"FVU_validation"}', TRUE),

  -- United States: federal returns delivered through IRS e-file / MeF
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000002', 'FORM-1040', 'U.S. Individual Income Tax Return', 'Federal individual income tax return.', 'Income Tax', 'Annual', 'XML', ARRAY['XML', 'PDF', 'CSV'], 'IRS e-file / MeF', 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-schemas-and-business-rules', 'Tax-year dependent', 'https://www.irs.gov/e-file-providers/modernized-e-file-schema-and-business-rules-for-individual-tax-returns-and-extensions', '{"submission":"IRS_MeF","primary":"XML","supporting":["PDF","CSV"]}', '{"required":["taxpayer_identification","tax_year","income","deductions","tax_computation"],"authority_validation":"IRS_schema_and_business_rules"}', TRUE),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000002', 'FORM-1120', 'U.S. Corporation Income Tax Return', 'Federal corporate income tax return.', 'Income Tax', 'Annual', 'XML', ARRAY['XML', 'PDF', 'CSV'], 'IRS e-file / MeF', 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-schemas-and-business-rules', 'Tax-year dependent', 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-schemas-and-business-rules', '{"submission":"IRS_MeF","primary":"XML","supporting":["PDF","CSV"]}', '{"required":["ein","tax_year","income_statement","balance_sheet","tax_computation"],"authority_validation":"IRS_schema_and_business_rules"}', TRUE),
  ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000002', 'FORM-1065', 'U.S. Return of Partnership Income', 'Federal partnership information return.', 'Income Tax', 'Annual', 'XML', ARRAY['XML', 'PDF', 'CSV'], 'IRS e-file / MeF', 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-schemas-and-business-rules', 'Tax-year dependent', 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-schemas-and-business-rules', '{"submission":"IRS_MeF","primary":"XML","supporting":["PDF","CSV"]}', '{"required":["ein","tax_year","partner_schedule","income_and_deductions"],"authority_validation":"IRS_schema_and_business_rules"}', TRUE),
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000002', 'FORM-941', 'Employer Quarterly Federal Tax Return', 'Quarterly federal employment tax return.', 'Payroll', 'Quarterly', 'XML', ARRAY['XML', 'PDF', 'CSV'], 'IRS e-file / MeF', 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-for-employment-taxes-frequently-asked-questions', 'Tax-year dependent', 'https://www.irs.gov/e-file-providers/modernized-e-file-mef-for-employment-taxes-frequently-asked-questions', '{"submission":"IRS_MeF","primary":"XML","supporting":["PDF","CSV"]}', '{"required":["ein","quarter","wages","withholding","employment_tax"],"authority_validation":"IRS_schema_and_business_rules"}', TRUE),

  -- UAE: EmaraTax returns
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000003', 'VAT-201', 'VAT Return', 'Periodic UAE value added tax return.', 'VAT', 'Quarterly or monthly', 'Portal form', ARRAY['PDF', 'XLSX', 'CSV'], 'EmaraTax', 'https://eservices.tax.gov.ae/', 'Current EmaraTax form', 'https://tax.gov.ae/en/', '{"submission":"portal_form","primary":"portal_form","supporting":["PDF","XLSX","CSV"]}', '{"required":["tax_registration_number","tax_period","output_vat","input_vat","net_vat"],"authority_validation":"FTA_portal_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000003', 'CT-RETURN', 'Corporate Tax Return', 'UAE federal corporate tax return.', 'Corporate Tax', 'Annual', 'Portal form', ARRAY['PDF', 'XLSX', 'CSV'], 'EmaraTax', 'https://eservices.tax.gov.ae/', 'Current EmaraTax form', 'https://tax.gov.ae/en/taxes/corporate.tax/faqs.aspx', '{"submission":"portal_form","primary":"portal_form","supporting":["PDF","XLSX","CSV"]}', '{"required":["tax_registration_number","tax_period","financial_statements","taxable_income","tax_payable"],"authority_validation":"FTA_portal_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000003', 'EXCISE-201', 'Excise Tax Return', 'Periodic UAE excise tax return for registered persons.', 'Excise Tax', 'Monthly', 'Portal form', ARRAY['PDF', 'XLSX', 'CSV'], 'EmaraTax', 'https://eservices.tax.gov.ae/', 'Current EmaraTax form', 'https://tax.gov.ae/en/', '{"submission":"portal_form","primary":"portal_form","supporting":["PDF","XLSX","CSV"]}', '{"required":["tax_registration_number","tax_period","excise_goods","tax_due"],"authority_validation":"FTA_portal_validation"}', TRUE),

  -- Singapore: myTax Portal forms
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000004', 'GST-F5', 'GST Return', 'Singapore GST return for a taxable period.', 'GST', 'Quarterly or monthly', 'Portal form', ARRAY['PDF', 'XLSX', 'CSV'], 'IRAS myTax Portal', 'https://mytax.iras.gov.sg/', 'Current myTax Portal form', 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/completing-gst-returns', '{"submission":"portal_form","primary":"portal_form","supporting":["PDF","XLSX","CSV"]}', '{"required":["gst_registration_number","accounting_period","standard_rated_supplies","input_tax","output_tax"],"authority_validation":"IRAS_portal_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000004', 'FORM-C-S', 'Corporate Income Tax Form C-S', 'Simplified corporate income tax return for eligible companies.', 'Income Tax', 'Annual', 'Portal form', ARRAY['PDF', 'XLSX', 'CSV'], 'IRAS myTax Portal', 'https://mytax.iras.gov.sg/', 'Current myTax Portal form', 'https://www.iras.gov.sg/', '{"submission":"portal_form","primary":"portal_form","supporting":["PDF","XLSX","CSV"]}', '{"required":["unique_entity_number","basis_period","revenue","tax_adjustments","tax_payable"],"authority_validation":"IRAS_portal_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000004', 'FORM-C', 'Corporate Income Tax Form C', 'Corporate income tax return for companies not eligible for Form C-S.', 'Income Tax', 'Annual', 'Portal form', ARRAY['PDF', 'XLSX', 'CSV'], 'IRAS myTax Portal', 'https://mytax.iras.gov.sg/', 'Current myTax Portal form', 'https://www.iras.gov.sg/', '{"submission":"portal_form","primary":"portal_form","supporting":["PDF","XLSX","CSV"]}', '{"required":["unique_entity_number","basis_period","financial_statements","tax_computation"],"authority_validation":"IRAS_portal_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000004', 'GST-F7', 'GST Error Correction Return', 'Correction return for errors in a previously filed GST return.', 'GST', 'As required', 'Portal form', ARRAY['PDF', 'XLSX', 'CSV'], 'IRAS myTax Portal', 'https://mytax.iras.gov.sg/', 'Current myTax Portal form', 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst', '{"submission":"portal_form","primary":"portal_form","supporting":["PDF","XLSX","CSV"]}', '{"required":["gst_registration_number","original_return_period","correction_details"],"authority_validation":"IRAS_portal_validation"}', TRUE),

  -- United Kingdom: HMRC online and Making Tax Digital
  ('20000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000005', 'CT600', 'Company Tax Return', 'UK corporation tax return with accounts and computations.', 'Corporation Tax', 'Annual', 'iXBRL', ARRAY['iXBRL', 'XML', 'PDF', 'CSV'], 'HMRC Corporation Tax online', 'https://www.gov.uk/government/collections/corporation-tax-online-filing-and-electronic-payment', 'Current HMRC requirements', 'https://www.gov.uk/guidance/the-company-tax-return-guide', '{"submission":"HMRC_approved_software","primary":"iXBRL","form":"CT600","supporting":["XML","PDF","CSV"]}', '{"required":["company_reference","accounting_period","CT600","accounts","tax_computations"],"authority_validation":"HMRC_online_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000005', 'VAT-RETURN', 'VAT Return', 'UK VAT return submitted through Making Tax Digital-compatible software.', 'VAT', 'Quarterly or monthly', 'API', ARRAY['JSON', 'XML', 'CSV', 'PDF'], 'HMRC Making Tax Digital for VAT', 'https://www.gov.uk/submit-vat-return', 'Current MTD requirements', 'https://www.gov.uk/submit-vat-return/how-to-send-vat-return', '{"submission":"MTD_API","primary":"JSON","supporting":["XML","CSV","PDF"]}', '{"required":["vat_registration_number","period_key","vat_boxes","digital_records"],"authority_validation":"HMRC_MTD_validation"}', TRUE),
  ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000005', 'SA100', 'Self Assessment Tax Return', 'Individual UK Self Assessment return.', 'Income Tax', 'Annual', 'Online form', ARRAY['PDF', 'CSV', 'XML'], 'HMRC Self Assessment', 'https://www.gov.uk/log-in-file-self-assessment-tax-return', 'Current HMRC requirements', 'https://www.gov.uk/log-in-file-self-assessment-tax-return', '{"submission":"online_or_approved_software","primary":"online_form","supporting":["PDF","CSV","XML"]}', '{"required":["unique_taxpayer_reference","tax_year","income","reliefs","tax_calculation"],"authority_validation":"HMRC_online_validation"}', TRUE)
ON CONFLICT (id) DO UPDATE SET
  country_id = EXCLUDED.country_id,
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  filing_category = EXCLUDED.filing_category,
  filing_frequency = EXCLUDED.filing_frequency,
  output_format = EXCLUDED.output_format,
  accepted_file_types = EXCLUDED.accepted_file_types,
  government_portal_name = EXCLUDED.government_portal_name,
  government_portal_url = EXCLUDED.government_portal_url,
  specification_version = EXCLUDED.specification_version,
  specification_url = EXCLUDED.specification_url,
  format_definition = EXCLUDED.format_definition,
  validation_rules = EXCLUDED.validation_rules,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
