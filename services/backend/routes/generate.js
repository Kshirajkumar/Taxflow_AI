/**
 * TaxFlow.AI — AI Generator Routes (Notice Responses, Computation Sheets, Drafts)
 *
 * This module uses Gemini AI to generate:
 *  1. Income Tax / GST Notice Responses (professional legal drafts)
 *  2. Tax Computation Sheets (from verified client financial data)
 *  3. Client Summary Reports
 *
 * All generated text is:
 *  - Saved as a .txt file in the client's Local Vault (Generated/ folder)
 *  - AI usage logged to Supabase ai_usage_log
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { saveTextFileToVault } = require('../vault/vaultManager');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

/**
 * POST /api/v1/generate/notice-response
 * Generate a professional notice response draft using Gemini AI
 * Body: { clientId, noticeText, section, assessmentYear }
 */
router.post('/notice-response', async (req, res) => {
  const startTime = Date.now();
  const { clientId, noticeText, section, assessmentYear } = req.body;

  if (!clientId || !noticeText) {
    return res.status(400).json({ success: false, message: 'clientId and noticeText are required' });
  }

  try {
    // Fetch client profile from Supabase
    let client = { name: 'Valued Client', pan: 'N/A', id: clientId };
    if (isConnected) {
      const { data } = await supabase.from('clients').select('*').eq('id', clientId).single();
      if (data) client = data;
    }

    let draftText = '';
    let inputTokens = 0, outputTokens = 0;

    if (GEMINI_API_KEY && !GEMINI_API_KEY.includes('your_')) {
      // Call Gemini AI
      const prompt = `You are an expert Indian tax lawyer and Chartered Accountant. 
Draft a professional, formal response letter to the following Income Tax / GST Notice on behalf of the client.
The response should be legally sound, polite, and include placeholders for specific financial figures.

CLIENT DETAILS:
- Name: ${client.name}
- PAN: ${client.pan || 'N/A'}
- Entity Type: ${client.entity_type || 'N/A'}
- Assessment Year: ${assessmentYear || '2025-26'}
- Section Under Notice: ${section || 'Not specified'}

NOTICE CONTENT:
${noticeText}

Draft the response letter in formal English, including:
1. Reference to the notice
2. Summary of facts
3. Legal grounds / clarifications
4. Supporting documents to be attached
5. Request to drop/reduce demand
6. Signature block`;

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 3000 }
          })
        }
      );
      const geminiJson = await geminiRes.json();
      draftText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || getFallbackNoticeDraft(client, section, assessmentYear);
      inputTokens = geminiJson.usageMetadata?.promptTokenCount || 0;
      outputTokens = geminiJson.usageMetadata?.candidatesTokenCount || 0;
    } else {
      draftText = getFallbackNoticeDraft(client, section, assessmentYear);
    }

    const duration = Date.now() - startTime;

    // Save generated draft to Local Vault Storage
    const saved = saveTextFileToVault(client.name, `notice_response_${section || '143_1'}`, draftText, 'Generated');

    // Log AI usage to Supabase
    if (isConnected) {
      await supabase.from('ai_usage_log').insert([{
        client_id: clientId, operation: 'notice_generation', model_used: GEMINI_MODEL,
        input_tokens: inputTokens, output_tokens: outputTokens,
        cost_usd: ((inputTokens * 0.000075 + outputTokens * 0.0003) / 1000),
        duration_ms: duration, success: true
      }]);
      await supabase.rpc('increment_client_ai_calls', { cid: clientId }).catch(() => {});
    }

    res.json({
      success: true,
      data: {
        clientId, clientName: client.name, section,
        assessmentYear: assessmentYear || '2025-26',
        draftText,
        savedVaultPath: saved.vaultPath,
        generatedAt: new Date().toISOString(),
        duration_ms: duration
      }
    });

  } catch (err) {
    console.error('[Generator] Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/generate/computation-sheet
 * Generate a tax computation summary from client's verified extraction data
 */
router.post('/computation-sheet', async (req, res) => {
  const { clientId, assessmentYear } = req.body;
  if (!clientId) return res.status(400).json({ success: false, message: 'clientId is required' });

  try {
    let clientData = { name: 'Client', pan: 'N/A' };
    let extractedDocs = [];

    if (isConnected) {
      const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
      if (client) clientData = client;

      const { data: docs } = await supabase
        .from('documents_metadata')
        .select('file_name, category, extracted_data, confidence_score')
        .eq('client_id', clientId)
        .eq('status', 'Verified');
      if (docs) extractedDocs = docs;
    }

    const sheet = generateComputationSheet(clientData, extractedDocs, assessmentYear || '2026-27');
    const saved = saveTextFileToVault(clientData.name, `computation_sheet_${assessmentYear || '2026-27'}`, sheet, 'Generated');

    if (isConnected) {
      await supabase.from('ai_usage_log').insert([{
        client_id: clientId, operation: 'summary', model_used: 'template',
        success: true, duration_ms: 50
      }]);
    }

    res.json({ success: true, data: { clientId, clientName: clientData.name, sheet, savedVaultPath: saved.vaultPath } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Helpers ---

function getFallbackNoticeDraft(client, section, ay) {
  return `
DRAFT RESPONSE TO INCOME TAX NOTICE
Section: ${section || '143(1)'} | AY: ${ay || '2025-26'}

To,
The Assessing Officer,
Income Tax Department

Subject: Response to Notice u/s ${section || '143(1)'} for AY ${ay || '2025-26'} — ${client.name} (PAN: ${client.pan || 'N/A'})

Respected Sir/Madam,

This is in response to your Notice dated __________ issued under Section ${section || '143(1)'} of the Income Tax Act, 1961.

FACTS OF THE CASE:
We respectfully submit that:
1. The income/turnover reported in the ITR is accurate and supported by books of accounts.
2. Any variance highlighted in the notice is due to timing differences / accounting adjustments.
3. All income and deductions have been correctly reported as per applicable provisions.

SUPPORTING DOCUMENTS ENCLOSED:
• Audited Balance Sheet and P&L Statement
• GSTR-2B / GSTR-3B reconciliation
• Bank reconciliation statement
• Form 26AS and AIS reconciliation

In view of the above, we respectfully request your good office to drop the proposed adjustment.

Yours faithfully,
For ${client.name}
Authorized Signatory / CA Representative

[NOTE: This is an AI-generated draft. Please review and customize before submission.]
`.trim();
}

function generateComputationSheet(client, docs, ay) {
  const form16 = docs.find(d => d.category === 'Form16')?.extracted_data || {};
  const lines = [
    `TAX COMPUTATION SHEET — ${client.name} (PAN: ${client.pan || 'N/A'})`,
    `Assessment Year: ${ay}`,
    `Prepared by TaxFlow AI — ${new Date().toLocaleDateString('en-IN')}`,
    `${'─'.repeat(60)}`,
    `INCOME DETAILS`,
    `  Gross Salary / Income:        ₹ ${(form16.gross_salary || 0).toLocaleString('en-IN')}`,
    `  Less: Standard Deduction:     ₹ ${(form16.standard_deduction || 50000).toLocaleString('en-IN')}`,
    `  Less: HRA Exemption:          ₹ ${(form16.hra_exemption || 0).toLocaleString('en-IN')}`,
    `  Net Taxable Income:           ₹ ${(form16.net_taxable_income || 0).toLocaleString('en-IN')}`,
    `${'─'.repeat(60)}`,
    `DEDUCTIONS (Chapter VI-A)`,
    `  Section 80C:                  ₹ ${(form16.section_80c || 0).toLocaleString('en-IN')}`,
    `  Section 80D:                  ₹ ${(form16.section_80d || 0).toLocaleString('en-IN')}`,
    `${'─'.repeat(60)}`,
    `TAX COMPUTATION`,
    `  Total TDS Deducted:           ₹ ${(form16.total_tds || 0).toLocaleString('en-IN')}`,
    `${'─'.repeat(60)}`,
    `Documents verified: ${docs.length} | Generated: ${new Date().toISOString()}`
  ];
  return lines.join('\n');
}

module.exports = router;
