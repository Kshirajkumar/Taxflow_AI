# Taxflow.AI — Product Requirements Document

| | |
|---|---|
| **Version** | 4.0 (draft for review) |
| **Date** | 14 October 2026 |
| **Supersedes** | PRD v3.0 (14 October 2026) |
| **Status** | Vision and requirements. Not a description of what is built today. |
| **Changes from v3.0** | Additions only. Replacing ledger software such as Tally and Zoho Books becomes a planned goal, and new requirements (Sections 6.4, 7.8 to 7.16 and 8.5, Appendix D) make Taxflow able to do everything those products do, with a design target of matching or exceeding them on accuracy, safety and speed. Nothing else in v3.0 is removed or reworded, except the ledger-software statements in Sections 3.3 and 7.7 and these header rows. |
| **Changes from v2.0 (carried from v3.0)** | Two changes only. (1) Replacing ledger software such as Tally and Zoho Books is no longer listed as a non-goal. (2) Submission to government portals is decided country by country, according to whether the government provides an API or other authorised submission channel for that filing. All other content is unchanged. |
| **Inputs** | Product owner's updated vision; the "CA Practice Suite" demo (`demo_2.html`); the repository audit of 12 October 2026 (`docs/PRODUCTION_AUDIT.md`); public regulatory sources listed in Appendix B; the product owner's comparison of Taxflow with Tally and Zoho Books (v4.0) |

**How to read this document.** Every requirement is labelled with a priority (P0 = required for the first paid release of its phase, P1 = next, P2 = later). Statements about regulators are marked **Verified** (confirmed from a cited source), **To verify** (believed correct but not confirmed), or **Unknown**. Nothing marked "To verify" or "Unknown" should be committed to externally until it has been confirmed.

---

## 1. Executive summary

Taxflow.AI is an **AI filing agent with a mandatory human approval step**. A user (a chartered accountant, a firm, or an individual taxpayer) gives the agent a task in plain language, for example *"Generate GSTR-3B for Iyer & Sons for August"* or *"File my income tax return."* The agent:

1. shows a **step-by-step plan** before it starts,
2. executes the plan while the user **watches it live**,
3. produces the required files using **algorithms and rule engines** (not guesses),
4. stops at every important point and requests a **human review**, with the original document and the AI's work shown side by side,
5. treats the work as **complete only after the human gives full approval**, and
6. then either hands over the finished files or, in countries where the government provides an API or other authorised channel for that filing, submits them to the government portal.

The product has one engine and two editions:

- **Taxflow for Practices** — for CAs, tax consultants and accounting teams working for many clients. This is the product demonstrated in the current demo and codebase.
- **Taxflow Personal** — for ordinary individuals who want to say "file my return" or "prepare my return" without any accounting knowledge.

The product's promise is not "AI files your taxes." It is: **the AI does the work, a person is shown exactly what was done and why, and nothing is final until that person approves it.**

---

## 2. What changed from v1.0

| Topic | v1.0 (20 Sep 2026) | v2.0 (this document) |
|---|---|---|
| Customer | The firm only. "Never sell to end clients." | Firms **and** individuals, as two editions on one engine. |
| AI role | Reads documents, prepares worksheets. An accountant moves numbers into the portal. | An **agent** that plans, executes visibly and prepares complete filing files for every supported form. Submission through authorised channels is an explicit, phased goal. |
| Submission | Non-goal: "Submit anything to a tax authority ourselves." | Non-goal only as **autonomous** submission. Submission after explicit human approval, through an authorised channel, is in scope from Phase 3 (Section 8). |
| Human review | Review queue for extracted fields. | A **review gate** at every important step of every agent run, with side-by-side original and AI work. The run is not complete until approved. |
| AI visibility | Chat panel that answers questions and opens pages. | A **live agent view** in the right-hand panel showing the plan, the current step and each action as it happens. |
| Scope of forms | Worksheets and exports for a first jurisdiction. | Every form a CA prepares for a supported country, delivered country by country (Section 8). |

### Changes in v3.0 (14 October 2026)

| Topic | v2.0 | v3.0 |
|---|---|---|
| Ledger software | Listed as a non-goal: "Replacing the firm's ledger (Tally, Zoho Books and similar). Taxflow exports to them." | No longer a non-goal. Taxflow may replace such tools in the future. This is not planned for any current phase; export to them remains the current approach (Section 7.7). |
| Submission | Submission through an authorised channel in scope from Phase 3, described mainly for India. | Submission is decided **country by country and filing by filing**, by whether the government provides an API or other authorised channel for that filing. Where it does, the agent can submit after human approval. Where it does not, the agent prepares the files and does not submit (Sections 5.4 and 8.3). |

### Changes in v4.0 (14 October 2026)

| Topic | v3.0 | v4.0 |
|---|---|---|
| Ledger software | Taxflow "may in future" replace Tally, Zoho Books and similar tools. Not planned for any current phase. | **Planned.** Taxflow builds its own books, inventory, banking, e-invoicing, payroll, roles, reporting and platform capabilities in Phases 6 to 9 (Sections 7.8 to 7.16, Section 15). Export to Tally and Zoho Books continues so firms can migrate gradually. |
| Capability gaps versus Tally and Zoho Books | Eight gaps identified, handled by export or left to the ledger. | Each gap becomes a requirement with a phase, a safety rule and a measurable target (Appendix D). |
| Design target | Not stated. | On every capability, Taxflow is designed to match the accuracy of Tally and Zoho Books and to exceed them on source-document traceability, review gates, automation of data entry and safety of posting. This is a target to be proven by the measures in Section 16, not a claim about the product today. |
| Product structure | Nine pages and the right-hand assistant. | The same nine pages plus a **Books** group of pages (Section 6.4). The shell, navigation style and principles do not change. |
| Release plan | Phases 0 to 5. | Phases 0 to 5 unchanged; Phases 6 to 9 added (Section 15). |
| Open decisions | Seven. | Items 8 to 13 added (Section 14). |

---

## 3. Vision, goals and principles

### 3.1 Vision (3 years)
Anyone, from a one-person practice to a person filing their first return, can open Taxflow, say what they need, watch it done correctly and approve the result in minutes, without learning tax software.

### 3.2 Goals
1. Produce **filing-ready files** for every form a CA routinely prepares, in the format the relevant portal accepts.
2. Let a user hand a whole task to the AI in one sentence, while keeping them in control through visible plans and approval gates.
3. Remove repetitive collection, reading, checking and file-building work from CA practices.
4. Make tax preparation usable by a non-expert individual.
5. Keep every number traceable to its source document and every action traceable to a person and a time.
6. Provide, in phases, the books, inventory, banking, e-invoicing, payroll, access-control, reporting and platform capabilities that firms use Tally and Zoho Books for, so that a firm can run its whole practice in Taxflow, to an accuracy and safety standard at least equal to those products and with the traceability and review principles of this document applied to every entry.

### 3.3 Non-goals
- Autonomous filing: the agent never submits, signs or pays anything without a recorded human approval.
- Giving tax or legal advice that a professional is accountable for. In the CA edition the CA remains the responsible professional.
- Using customer documents to train models.

**Not a non-goal:** Taxflow replaces ledger software such as Tally and Zoho Books over time. From v4.0 this is a planned goal delivered in Phases 6 to 9 (Sections 7.8 to 7.16, Appendix D). Until those phases ship, Taxflow exports to them (Section 7.7).

### 3.4 Product principles
1. **Plan first, show everything.** The agent states its plan before acting and narrates each step as it runs.
2. **Humans approve what matters.** Approval is required before data is used, before a file is final, before any message is sent and before any submission.
3. **Algorithms calculate, AI reads.** Figures are computed by deterministic, versioned rule engines. A language model never produces a total, a tax amount or a filing value on its own.
4. **Every number has a source.** If a value cannot be linked to a document, a rule or a person's entry, it is not shown as fact.
5. **Show uncertainty.** Low-confidence fields and unusual items are flagged and routed to review, never silently accepted.
6. **Fail honestly.** If extraction, calculation or submission fails, the user sees a clear error. The system never substitutes sample or placeholder data.
7. **One shell, same pages.** The edition changes what is shown, not how the product is laid out (Section 6).

---

## 4. Users

| Persona | Edition | Goal | What they need from Taxflow |
|---|---|---|---|
| **Practice owner / partner** | Practices | Serve more clients without more headcount; never miss a deadline | Firm-wide view of who is behind; trustworthy automation; audit trail |
| **Senior accountant** | Practices | Review and advise, not type | A fast review queue; side-by-side comparison; reliable generated files |
| **Junior staff / article clerk** | Practices | Work through checklists without constant questions | Per-client checklist and step plan |
| **SME client of a firm** | Practices | Stay compliant with minimum effort | Send documents on WhatsApp; receive polite reminders; never learn new software |
| **Individual taxpayer (salaried, freelancer, small investor)** | Personal | File correctly without understanding forms | Plain-language guidance; "do it for me" with clear review; final file or filing |
| **Reviewer role** | Both | Sign off work | Clear approval screen; a record of what was approved |

---

## 5. Core concept: the Agent Run

Everything the AI does is an **Agent Run**. Whether the user typed a request, a deadline triggered it or a document arrived on WhatsApp, the same lifecycle applies.

### 5.1 Lifecycle

```
Request → Plan → (Plan approval, if required) → Live execution → Review gates → Final approval → Output → (Submission) → Close
```

| Stage | What happens | Who acts |
|---|---|---|
| **Request** | The user states a task in the AI panel, or a rule or deadline creates one. | User / System |
| **Plan** | The agent shows an ordered list of steps, what data each uses, and which steps will require review. | Agent |
| **Plan approval** | Required for any run that sends messages, uses paid credits above a set amount or can lead to submission. Optional otherwise. | User |
| **Live execution** | The user watches each step move from pending to running to done, with a one-line explanation per action. | Agent |
| **Review gate** | The run pauses and presents the work for human review (Section 5.3). | Human |
| **Final approval** | The reviewer approves the complete result. This is recorded with the reviewer's identity and time. | Human |
| **Output** | The final files are saved to the client folder and made available for download. | System |
| **Submission** | Only if the filing level allows it (Section 5.4) and only after a separate, explicit approval. Whether the level allows it depends on whether that country's government provides an API or other authorised channel for the filing (Section 8.3). | Human + System |
| **Close** | The deadline card updates, the client is notified if configured, and the full run is stored in the audit log. | System |

**Rule:** a run is "Complete" only after Final approval. Until then its status is "Awaiting review" and it is counted as open work on the dashboard.

### 5.2 Live agent view (right-hand panel)
The current demo's assistant panel answers questions and opens pages. In v2.0 it also hosts the live run:

- **Plan card** — numbered steps with status (pending, running, needs review, done, failed).
- **Activity stream** — one line per action ("Read 14 invoices", "Matched 12 to GSTR-2B", "Found 2 mismatches").
- **Controls** — pause, stop, ask a question, open the current step's page.
- **Review prompts** — when a gate is reached, the panel links directly to the side-by-side review screen.

Requirement (P0): the user can stop a run at any moment, and a stopped run changes nothing outside its own draft outputs.

### 5.3 The review gate (side by side)
Every review gate shows, on one screen:

| Left | Right |
|---|---|
| The **original** (invoice image, Form 16, bank statement, notice, the portal's previous return) | The **AI's work** (extracted fields, computed values, generated file contents) |

Required behaviour:
1. Hovering a field highlights its source on the original (present in the current demo's extraction page; retained and extended).
2. Each value shows its confidence and the reason for any flag (low confidence, mismatch with another document, duplicate invoice number, invalid tax ID format, total does not equal the sum of lines).
3. Every value can be edited. An edit is logged with before and after values and re-runs dependent calculations.
4. Computed values show their **derivation** (which inputs and which rule produced them).
5. The reviewer can approve one item, approve all unflagged items, or reject with a reason that returns the item to the agent.
6. Flagged items cannot be bulk-approved. They must be opened individually.

**Mandatory review points (P0).** These always require a human, in every edition:
- every extracted document that feeds a filing,
- every generated filing file, as a whole, before it is marked final,
- every outgoing client message (unless the user has explicitly set a template to auto-send),
- every submission to a government portal,
- any value the agent changed that a human had entered.

### 5.4 Execution levels
Each filing type in each country is assigned the highest level it supports. Whether L2 is available depends on whether that country's government provides an API or other authorised submission channel for that filing; where none exists, the highest level is L0 or L1 and the agent does not submit. The level is shown to the user before work starts.

| Level | Name | Behaviour | Typical requirement |
|---|---|---|---|
| **L0** | Prepare | The agent builds the filing files and worksheets. The user or CA uploads or types them into the portal. | None beyond Taxflow itself. |
| **L1** | Guided submission | L0, plus a step-by-step checklist with the exact values to enter at each portal screen, and verification that the final acknowledgement matches. | None beyond Taxflow itself. |
| **L2** | Authorised submission | After final approval, Taxflow transmits the return to the portal through an **officially authorised channel**, then reports the portal's response. | A government API or other authorised channel for that filing in that country, plus regulatory registration or a licensed partner (Section 8.3). |
| **L3** | Autonomous filing | The agent files without a human approving. | **Not supported.** |

Credentials and one-time passwords belong to the taxpayer or the CA. Taxflow does not store portal passwords and does not attempt to bypass any authentication step.

---

## 6. Product structure: same shell, same pages

The layout, navigation and visual language of the current demo are retained. The nine pages and the right-hand assistant remain the product's structure. This section states what each page becomes.

### 6.1 Navigation (unchanged)
- **Workspace:** Dashboard
- **Automation:** Invoice extraction, WhatsApp, Client folders, Deadlines, File generator
- **Practice:** Clients, Billing & fees, Settings
- **Right panel:** Taxflow Assistant (becomes the live agent view)

### 6.2 Page requirements

| Page | Purpose (demo) | v2.0 additions | Priority |
|---|---|---|---|
| **Dashboard** | Filings needing attention, reminders, document pipeline, clients missing documents, automation activity | Add **"Awaiting your review"** (open agent runs by gate), runs in progress, and credits remaining | P0 |
| **Invoice extraction** | Queue, original bill beside extracted fields with confidence, approve and save | Becomes the **review gate for documents**. Add duplicate detection, tax-ID format checks and line-total validation. Support all document types a filing needs (Section 7.1) | P0 |
| **WhatsApp** | Chats, scheduled reminders, templates; reminders can wait for approval | Agent can draft requests for exactly the missing items and queue them for approval. Inbound documents start extraction runs automatically | P0 |
| **Client folders** | Client / year / month / Raw, Extracted, Generated tree | Add **Approved** state on every generated file, link every file to its run, and show who approved it | P0 |
| **Deadlines** | Per-client filing cards with step checklists and progress | Steps tick automatically as agent runs complete; a step is "done" only when its gate is approved. Add at-risk flags | P0 |
| **File generator** | Choose client, period and file types; generate; preview; save | Becomes the **review gate for filing files**. Generation is an agent run with a plan, validation against the official format and a side-by-side review. Add the filing level (L0/L1/L2) per type | P0 |
| **Clients** | Client cards with services, tax ID, fees, work completed | Add filing obligations per client, jurisdiction, consent status and per-client automation preferences | P0 |
| **Billing & fees** | The firm's own fee invoices and collections | Add subscription, credit balance and usage (Section 12). Firm-fee invoicing remains | P1 |
| **Settings** | Integrations, automation rules, security and audit | Add approval policies, run history, role permissions, credit controls and the audit log export | P0 |
| **Assistant (right panel)** | Answers questions, opens pages | Hosts the live agent view (Section 5.2). Natural-language requests create Agent Runs | P0 |

### 6.3 Taxflow Personal on the same shell
The Personal edition uses the same pages in a simplified mode, so the product is learned once:

- The person is their own single client; family members can be added as additional clients.
- **Visible:** Dashboard, Documents (Invoice extraction renamed in plain language), Folders, Deadlines, File generator, Settings, Assistant.
- **Hidden by default:** WhatsApp inbox, Billing & fees, multi-client views.
- The assistant opens with plain-language prompts such as "File my income tax return" and "What documents do you need from me?"
- Review screens use plain explanations beside each field ("This is your total salary according to your Form 16").

Open decision: whether the Personal edition ships as the same Windows desktop app or as a web and mobile product (Section 14, item 3).

### 6.4 Books pages (v4.0, added to the same shell)
The nine pages and their layout are unchanged. A fourth navigation group, **Books**, is added below Practice. It uses the same visual language, the same review gates and the same assistant panel.

| Page | Purpose | Section | Phase | Priority |
|---|---|---|---|---|
| **Accounts** | Chart of accounts, vouchers, ledgers, day book, period locks | 7.8 | 6 | P1 |
| **Reports** | Trial balance, profit and loss, balance sheet, cash flow, GST/VAT and custom reports | 7.8, 7.15 | 6 | P1 |
| **Inventory** | Items, locations, batches, stock ledger and valuation | 7.9 | 7 | P1 |
| **Banking** | Statement import, feeds, reconciliation | 7.10 | 7 | P1 |
| **E-invoicing** | Invoice and e-way bill generation, registration status and errors | 7.11 | 8 | P1 |
| **Payroll** | Employees, salary runs, payslips, statutory deductions and returns | 7.12 | 8 | P1 |

- In **Taxflow Personal** the Books group is hidden by default (Section 6.3), except a simple income and expense view if the person turns it on.
- Every Books page opens the right-hand assistant with page-specific prompts, for example "Book this month's purchase invoices" or "Reconcile the HDFC account for August".

---

## 7. Functional requirements

### 7.1 Document intake and extraction (P0)
- Intake from WhatsApp, email forward, manual upload and, for Personal, camera or file picker.
- Supported documents in the first release: GST sales and purchase invoices, bank statements, Form 16, Form 26AS / AIS, TDS certificates, notices. Further document types are added with each filing type.
- Output per document: structured fields with per-field confidence, validation results and a link to the original.
- Validation is rule-based and separate from AI reading: tax-ID format, arithmetic consistency, duplicate detection, date plausibility.
- Failure behaviour: if reading fails, the document is marked "Could not be read" with a reason. No sample or fabricated data is ever saved.

### 7.2 Calculation and rule engines (P0)
- One engine per filing type per jurisdiction, versioned by tax year or period.
- Inputs are only approved documents and approved manual entries.
- Outputs include a **derivation trail** for every number.
- Engines are covered by test suites built from official examples and CA-verified cases before release. Rule changes are reviewed by a qualified professional.

### 7.3 Filing file generation (P0 for L0, per Section 8)
- Output in the format the destination expects (for example JSON for the GST portal, the prescribed format for the Income Tax return, XML for ledger import).
- Every file is **validated against the official specification or schema** before it is offered to the user. A file that fails validation is not shown as "Ready."
- Each file carries its run ID, the period, the engine version and the list of source documents.

### 7.4 Agent orchestration (P0)
- The agent can only use a defined set of tools: read documents, run extraction, run validation, run a rule engine, build a file, draft a message, read the client record and read deadlines. Sending, submitting and deleting are separate permissioned tools that always route through an approval.
- Text found inside documents is treated as data, never as instructions to the agent.
- Every tool call is logged with inputs and outputs.
- A run has a cost estimate shown in the plan and a hard credit limit.

### 7.5 Approvals and audit (P0)
- Role-based permissions: owner, senior, junior, read-only (Practices); owner (Personal).
- Every approval stores who, when, what was approved and the exact version approved.
- Approved outputs are immutable. A correction creates a new version linked to the old one.
- The audit log is exportable.

### 7.6 Communication (P0)
- WhatsApp Business Cloud API for requests and reminders using approved templates, with recorded consent and honoured opt-out.
- The agent drafts, a human approves, then it sends.
- Inbound messages are matched to the correct firm and client, de-duplicated and signature-verified (current gap, Section 13).

### 7.7 Integrations (P1)
- Ledger export: Tally voucher XML, Zoho Books, Excel and CSV (present as toggles in the demo's Settings).
- Taxflow replaces ledger software such as Tally and Zoho Books over time (Sections 7.8 to 7.16). Export to them stays supported after the replacement modules ship, so firms can migrate gradually or run both.
- Import from Tally (XML, Excel) and Zoho Books (export files or API) for migration, with the checks in Section 7.8, item 7.
- Portal-format export for each supported filing (Section 8).

### 7.8 Accounting engine and books (P1, Phase 6)
Taxflow's own double-entry books, built on the same principles as the rest of the product: every entry has a source, every posting passes a review gate, and every figure is computed by a deterministic engine.

1. **Chart of accounts.** Templates per jurisdiction, editable per client. Groups, ledgers, cost centres and tax ledgers (GST, VAT) are supported.
2. **Double entry enforced.** Voucher types: sales, purchase, receipt, payment, journal, contra, debit note, credit note. A voucher whose debits and credits differ cannot be saved. The rule is enforced in the engine and again in the database. (P0 within this module)
3. **Source-linked entries.** Every voucher links to its source document and to the Agent Run that proposed it. The agent may **propose** the ledger, tax treatment and party; the engine posts only after the review gate in Section 5.3 is approved. An AI model never posts an entry or computes an amount on its own (principle 3). (P0 within this module)
4. **Immutable posting.** A posted voucher is never edited in place. A correction is a reversal plus a new voucher, both linked and logged. Accounting periods can be locked; unlocking requires a permitted role and is logged. (P0 within this module)
5. **Multi-currency, multi-entity, configurable financial years** per jurisdiction, so that the books work outside India.
6. **Reports produced by the engine only.** Trial balance, profit and loss, balance sheet, cash flow, day book, ledger and group summaries, aged receivables and payables, GST/VAT ledgers and summaries. Every figure drills down from the report to the vouchers and from the voucher to the original document. Presentation formats required by each jurisdiction's accounting standards are to be confirmed with a professional per country (To verify).
7. **Migration in, with a parity check.** Masters, opening balances and vouchers are imported from Tally and Zoho Books. After import, the trial balance is compared with the source system's trial balance for the same date. The migration is not finalised until they match exactly, and every difference is listed by ledger. (P0 within this module)
8. **Where Taxflow is designed to be stronger than a manual ledger:** vouchers for a whole month are proposed from approved documents instead of being typed; the same client's past mappings are reused and shown for confirmation; duplicates, wrong tax IDs and arithmetic errors are flagged before posting; the books feed the filing engines directly (Section 7.13).

### 7.9 Inventory (P1, Phase 7)
- Items with units, HSN/SAC or the local classification code (format-validated), tax rates and opening stock.
- Locations (godowns, branches), batches and serial numbers, expiry where relevant.
- Stock movements are created from purchase and sales vouchers and from stock journals; stock can never go negative unless the firm explicitly allows it per item.
- Valuation methods: which methods are permitted differs by country and accounting standard, so the allowed set is configured per jurisdiction after professional confirmation (To verify). Weighted average and first-in-first-out are the planned starting methods.
- Reports: stock ledger, stock summary, movement, ageing, reorder alerts, and stock valuation reconciled to the inventory ledger accounts.
- The agent reads item lines from supplier and sales invoices, matches them to existing items, and proposes new items for approval. It never creates stock on its own.

### 7.10 Banking and reconciliation (P1, Phase 7)
- **Statement import (P1):** PDF, Excel, CSV and image statements are read as documents (Section 7.1) and become bank transactions only after review.
- **Reconciliation engine:** a deterministic matcher pairs bank lines with vouchers by amount, date window, reference and party. Ambiguous items are proposed by the AI with reasons and always confirmed by a human. Unmatched items are listed with suggested vouchers. Reconciliation statements are produced for any date.
- **Live bank feeds (P2):** read-only, consent-based access through a regulated route such as an account-aggregator framework or a licensed aggregator or the bank's own API. Which routes exist, their cost and their coverage by bank and country are **Unknown (to verify)** and are open decision 10 (Section 14). Until confirmed, statement import is the supported path.
- Taxflow does not store bank passwords and does not initiate payments in this release. Payment initiation, if ever added, is a separate L2-style feature with its own approval and regulatory review.

### 7.11 E-invoicing and e-way bills (P1, Phase 8)
- Taxflow generates invoice and e-way bill data in the government's prescribed schema and validates it before it is offered (Section 7.3).
- Registration of an e-invoice with the government system (in India, the Invoice Registration Portal, producing the invoice reference number) and e-way bill generation are submissions. They follow Sections 5.4 and 8.3: they are performed only where an authorised API or channel exists for that filing, only through that channel, and only after a separate human approval.
- Access route, eligibility thresholds and cost for India are **To verify** (Section 8.5). Where no channel is confirmed for a country, Taxflow prepares the data and the user submits it (L0/L1).
- Returned reference numbers, QR codes, acknowledgements and errors are stored against the voucher. A voucher with a registered e-invoice is locked against edits that would invalidate it; cancellation follows the rules and time limits of the relevant authority.

### 7.12 Payroll and statutory compliance (P1, Phase 8)
- Employee masters, salary structures, attendance and leave inputs, monthly payroll runs, payslips and payroll journals posted to the books through the same review gate.
- Statutory calculations (provident fund, state insurance, professional tax, tax deducted on salary and their jurisdictional equivalents) are versioned rule engines under Section 7.2, with rates and limits maintained by date and reviewed by a qualified professional before each change goes live.
- Challan data, statutory return files and salary certificates (for India, Form 16 and the quarterly salary TDS return data) are generated and validated as files at L0/L1, and submitted at L2 only where Section 8.5 confirms a channel.
- Payroll data is among the most sensitive data in the product. Access is restricted to named roles (Section 7.14), field-level masked by default and every view of salary data is logged.

### 7.13 Filing directly from the product (extends 7.3 and 8)
- Returns are built from approved ledger data as well as from documents: GSTR-1 and GSTR-3B (or the local VAT/GST return) are computed from posted vouchers by the filing engine, and reconciled against government-side data such as GSTR-2B.
- Submission is exactly as defined in Section 8.3: only through a government API or other authorised channel, per country and per filing, after the separate human approval, with the run recorded.
- The ledger and the filing are checked against each other: a filing whose totals do not equal the ledger totals for the period cannot reach Final approval until the difference is explained and recorded.

### 7.14 Roles, permissions and access control (extends 7.5; P0 for Phase 1 basics, P1 for the rest)
- Built-in roles: owner, partner, senior, junior, read-only (Practices); owner (Personal). Added in v4.0: **client view** (a client sees only their own data), **auditor** (read-only with export, time-limited) and **custom roles**.
- Permissions are set per page, per action (view, create, edit, approve, post, lock period, export, submit) and per client. A person sees only the clients assigned to them.
- **Maker-checker.** A person who prepared a voucher, filing or payroll run cannot be the one who approves it, unless the owner explicitly permits it for that firm; the exception is logged.
- **Approval limits.** A role can be limited to approving items up to an amount.
- **Authentication.** Two-factor sign-in is required for owners and for anyone with approve, post, lock or submit permission. Session timeouts and device lists are provided.
- Permissions are enforced at the API and database level and covered by automated tests that try each role against each action (Section 11).

### 7.15 Reports, API and platform (P1 to P2, Phase 9 unless stated)
- **Reports.** The engine provides the reports in Section 7.8 and the register and summary reports firms commonly use. The aim is not a fixed count of reports but coverage of the reports firms actually ask for, measured with design-partner firms (Section 16). Users can save report layouts and schedule them by email.
- **Natural-language reports (P1).** The assistant turns a request such as "Show purchases from Gujarat vendors above 50,000 this quarter" into a query on the engine. The figures come from the engine; the language model only builds the request and the explanation (principle 3). The query used is shown beside the result.
- **Public API and webhooks (P2).** Authenticated, rate-limited, per-firm scoped, covering clients, documents, vouchers, reports and runs.
- **Marketplace (P2).** A directory of approved integrations and extensions, each reviewed for security and data handling before listing. Not before Phases 6 to 8 are stable.
- **Web and mobile (P1).** Access from a browser and from phone apps (review and approve, upload documents, view reports, ask the assistant). This depends on the storage decision (Section 14, item 1) and platform decision (item 3). Offline use on the desktop app remains supported where the storage model allows.

### 7.16 Safety rules for the books modules (P0 for every module above)
1. **Integrity invariants are tests, not hopes.** The trial balance always balances; every posted voucher balances; stock quantities agree with the stock ledger; bank reconciliation differences equal listed unreconciled items. These are checked continuously and in the test suite, and a failure stops posting.
2. **Parity tests against Tally and Zoho Books.** Before each module's release, a set of real and synthetic datasets is run through Taxflow and through Tally and Zoho Books, and the trial balance, profit and loss, balance sheet, stock valuation and statutory totals must match. Differences are investigated and recorded.
3. **No silent posting, no silent changes.** Nothing is posted, reversed, locked or unlocked without a recorded actor, time and reason.
4. **Idempotent operations.** Importing, exporting, posting or submitting the same item twice cannot create two results.
5. **Dry run before commit.** Migrations and bulk imports run first in a preview that shows what would be created, changed or rejected.
6. **Encryption and backup.** Financial data is encrypted at rest and in transit; backups are tested; each client's books can be exported in full at any time so that no firm is locked in.
7. **Professional sign-off.** Accounting rules, statutory rates and formats for each country are reviewed by a qualified professional of that country before release (Section 7.2).
8. **Fail closed.** If a layer fails, the run stops with an explanation and nothing partial is marked final (Section 9).

---

## 8. Filing coverage and submission strategy

### 8.1 Forms in scope
The demo lists the following file types. v2.0 keeps them as the first set and requires every one to be validated against its official format.

| Filing | Jurisdiction | Demo output | Target level |
|---|---|---|---|
| GSTR-1 (outward supplies) | India | JSON | L0 → L2 |
| GSTR-3B (monthly summary and ITC) | India | JSON | L0 → L2 |
| GSTR-2B reconciliation | India | Excel | L0 (workpaper, not filed) |
| ITR computation and return | India | Excel (computation) | L0 → L2 |
| TDS 26Q data | India | CSV | L0 → L1 |
| VAT return workings | UAE, UK | Excel | L0 → L1 (UAE), L0 → L2 (UK, to verify) |
| Tally import | Any | XML | L0 |
| Sales and purchase register | Any | Excel | L0 |
| Client summary report | Any | PDF | L0 |

Further forms (ROC filings, audit support files, PF/ESI, payroll, advance tax, notice replies) are added by priority after the first release. The demo's deadline categories already list ROC, Audit, PF/ESI and Payroll.

**Current implementation note.** In the codebase today the file generator builds previews in the browser. Only simple GSTR-1, GSTR-3B and GSTR-2B text or JSON is produced, and other types produce a one-line stub. None of the output is validated against an official format. Closing this gap is the first requirement of Phase 1.

### 8.2 Delivery models and recommendation

| Model | What the AI does | What the human does | Regulatory load | Value to user | Recommendation |
|---|---|---|---|---|---|
| **A. Files only (L0/L1)** | Collects, reads, checks, calculates and builds validated files | Reviews, then uploads or types into the portal | Low | Removes most of the work; the last step stays manual | **Launch model** for the CA edition in India |
| **B. Assisted submission (L2)** | Everything in A, then transmits after approval through an authorised channel | Reviews, approves, supplies OTP or DSC where required, verifies | High: registration or a licensed partner, security review, liability | Highest: end-to-end | **Phase 3**, through partners where possible |
| **C. Fully autonomous (L3)** | Files without approval | None | Very high | High in demo, unacceptable in practice | **Not built** |

Which model applies to a given filing is decided per country and per filing, according to whether the government provides an API or other authorised submission channel for it (Section 8.3). Where none exists, Model A is the ceiling.

Reasoning:
- Model A can be launched without any regulatory permission from the tax authorities, and it already delivers the core time saving.
- Model B is the stronger long-term product and the stronger story for the individual edition, but it is gated by registration, partnerships and liability design, none of which can be bypassed by engineering.
- Model C conflicts with the product's own principle (human approval) and with how the portals authenticate taxpayers.

### 8.3 Submission pathways (L2)

Submission is decided **country by country and filing by filing**. The agent submits a filing only where that country's government provides an API or other authorised submission channel for it, and only after the separate human approval described in Section 5.3. Where no such channel exists, the agent prepares the files and the user or CA submits them (L0/L1).

| Country | Filing | Government API or authorised channel | Status of this statement | Planned level |
|---|---|---|---|---|
| India | Income Tax Return | Yes, through a registered e-Return Intermediary | Verified | L2 (Phase 3) |
| India | GST returns (including GSTR-1 and GSTR-3B) | Yes, through a GST Suvidha Provider | Verified for API access; the final filing authentication step is unknown | L2 (Phase 3) |
| India | TDS 26Q, ROC and other filings | Not confirmed in this document | Unknown | L0/L1 until confirmed |
| UAE | VAT | Not confirmed | Unknown | L0/L1 |
| UK | VAT | Believed yes (HMRC Making Tax Digital) | To verify | L0 → L2 if confirmed |
| Other countries | All filings | Assessed before each country launch | Unknown | Highest confirmed level |

**India — Income Tax Returns.** Third-party software can file returns on a taxpayer's behalf only as an **e-Return Intermediary (ERI)**.
- **Verified:** an ERI is "authorized by the Income Tax Department to file ITR on your behalf." Eligible applicants include chartered accountants, firms, companies and individuals; only resident applicants may register. Three registration types exist; **Type 2 is "own software application for taxpayers to file ITRs"** and requires the prescribed computing infrastructure and a due-diligence certificate from a certified ISA or CISA professional. A Class II or III digital signature certificate is required. The registration fee is ₹4,000 plus 18% GST (₹4,720). Registered ERIs must retain filing data for at least one year after the assessment year ends and must protect client privacy, and their duties include confirming that the taxpayer has verified the ITR and providing the acknowledgement.
- **To verify directly with the Income Tax Department and Protean before applying:** current infrastructure requirements (one source lists specifications that appear dated), the current approval timeline, and any additional requirements for software that files for many taxpayers.
- **Implication:** Taxflow either registers as a Type 2 ERI or partners with an existing ERI. Either way, the **taxpayer must still verify the return**, so the product's flow must include that step.

**India — GST.** Software reaches the GST system through a **GST Suvidha Provider (GSP)**.
- **Verified:** an Application Service Provider (ASP) "cannot reach the GST System directly" and "must connect through a GSP." A GSP is approved by GSTN. The taxpayer authorises a GSP–ASP pair on the GST portal and approves access by OTP; the access token is valid for the duration the taxpayer chooses (the portal's API-access settings allow sessions from six hours up to 30 days). The available API functions include return filing for GSTR-1 through GSTR-9.
- **Unknown (to verify):** the exact steps for the final "file" action, including whether an EVC or DSC is required at that step, and the contractual terms of GSP partners.
- **Implication:** Taxflow acts as an ASP and integrates with an established GSP rather than becoming one.

**UAE (VAT) and UK (VAT).**
- **Unknown (to verify):** whether the UAE Federal Tax Authority offers an authorised programmatic filing channel for third-party software; the UK's HMRC Making Tax Digital programme for VAT does offer API-based submission by recognised software, but the registration steps and requirements have not been confirmed for this document.
- Until confirmed, both are planned at L0/L1.

**Browser automation of portals.** Operating a government portal by controlling a browser with the user's credentials is **not** a planned submission method. No authoritative source on portal terms of use was reviewed for this document, so it is treated as a legal and security risk until a lawyer says otherwise. L2 uses official channels only. Where a country provides no API or other authorised channel for a filing, Taxflow does not submit it; it prepares the files for the user or CA to submit.

### 8.4 Taxpayer-side steps that cannot be removed
Authentication, OTP entry, digital signature use and the taxpayer's own verification of a filed return remain with the taxpayer or the responsible CA. The product's job is to make these steps short and clearly explained, not to remove them.

### 8.5 Government channels for the v4.0 modules
The rule of Section 8.3 applies unchanged: Taxflow submits only where a government API or other authorised channel exists for that filing in that country, and only after a separate human approval. Where it does not, the agent prepares the data and the user or CA submits it.

| Country | Filing or action | Government API or authorised channel | Status of this statement | Planned level |
|---|---|---|---|---|
| India | E-invoice registration | Believed yes, through the government's Invoice Registration Portal APIs, possibly via a GST Suvidha Provider | To verify (access route, thresholds, cost) | L0 until confirmed; L2 if confirmed |
| India | E-way bill generation | Believed yes, through the government's e-way bill system APIs | To verify | L0 until confirmed; L2 if confirmed |
| India | Provident fund, state insurance and professional tax returns | Not confirmed in this document | Unknown | L0/L1 until confirmed |
| India | TDS on salary (quarterly return data) | Not confirmed in this document | Unknown | L0/L1 until confirmed |
| India | Bank data (read-only feeds) | Believed to exist through a regulated account-aggregator framework | To verify | Statement import until confirmed |
| UAE, UK, other countries | E-invoicing, payroll filings, bank data | Assessed before each country launch | Unknown | Highest confirmed level |

---

## 9. AI and algorithm architecture

| Layer | Responsibility | Technology approach | Trust level |
|---|---|---|---|
| **Reading** | Turn images and PDFs into structured fields | OCR plus a document-understanding model (currently Google Gemini) | Probabilistic. Always shows confidence. Reviewed by a human |
| **Validation** | Check what was read | Deterministic rules: tax-ID formats, arithmetic, duplicates, dates | Deterministic |
| **Calculation** | Compute tax, totals, ITC, deductions | Versioned rule engines per filing and period | Deterministic. Tested against official and professional examples |
| **File building** | Produce the destination format | Template and schema-driven generators validated against official specifications | Deterministic. Fails closed |
| **Orchestration** | Plan, sequence tools, narrate, pause for review | An agent with a fixed, permissioned tool set and a step budget | Constrained. Cannot send, submit or delete without approval |
| **Explanation** | Plain-language reasons and summaries | Language model grounded only on the run's own data | Informational. Never a source of figures |

Design rules:
- The AI never computes a figure that appears in a filing.
- If any layer fails, the run stops at that step with an explanation and no partial output is marked final.
- Model providers sit behind an adapter so that a model can be swapped or a fallback used on outage without changing product behaviour.
- Customer documents are not used for model training. Provider terms must be confirmed before launch.

---

## 10. Data, privacy and trust

- **Storage.** The current architecture keeps client files in a local vault on the firm's PC and stores metadata only in the cloud. This suits the CA edition but is incompatible with (a) receiving WhatsApp documents on a public server and (b) a consumer product used from a phone. A decision is required (Section 14, items 1 and 3). Whatever is chosen, files must be encrypted at rest and access-controlled per firm and per user.
- **Isolation.** Each firm's data must be isolated at the database and API level. This is the first item in the production hardening plan (Section 13).
- **Consent and messaging.** Recorded consent for every WhatsApp contact, honoured opt-out, quiet hours, approved templates.
- **Audit.** Every run, tool call, edit and approval is logged and exportable.
- **Retention.** Configurable per jurisdiction. Where an authorisation scheme prescribes a minimum retention (for example the ERI scheme's one-year-after-assessment-year requirement, Section 8.3), the product enforces it.
- **Legal.** Data-protection compliance for each market, terms of service, a data-processing agreement for firms and a liability model for submitted filings require professional legal review before any L2 release. This document does not provide legal advice.

---

## 11. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | Filing engines have automated tests from official and professionally verified cases; no release with a failing engine test |
| Honesty | No sample, demo or fabricated data in any production code path |
| Security | Server-side secrets only; per-firm isolation tested at API and database level; webhook signature verification; rate limits on cost-bearing endpoints |
| Reliability | A run survives a restart (resumes or fails cleanly); duplicate submissions and duplicate messages are impossible by design |
| Performance | Extraction of a typical invoice and generation of a standard return return within an interactive time budget to be set during Phase 1 measurement |
| Accessibility | Keyboard navigation, accessible labels and contrast on every page |
| Observability | Structured logs, error tracking, per-run traces, usage and cost metrics |
| Recoverability | Tested backups and a documented rollback procedure |
| Ledger integrity (v4.0) | Trial balance, voucher balance, stock and bank reconciliation invariants checked in tests and at runtime; parity tests against Tally and Zoho Books before each module release (Section 7.16) |
| Permission safety (v4.0) | Automated tests run every role against every action at API and database level; maker-checker and two-factor enforcement tested |
| Portability (v4.0) | Full export of a client's books at any time in open formats |

---

## 12. Business model

The pricing structure below is the product owner's current plan; amounts are to be set after cost measurement.

- **Subscription tiers (3)** with a monthly-refilled **credit pool**. Higher tiers receive larger pools and higher limits.
- **Pay-as-you-go plan** for high-usage firms.
- **Credits are deducted** for WhatsApp messages, AI assistant use and document extraction, and for agent runs according to the cost estimate shown in the plan.
- **Requirements (P0 before charging):** authoritative server-side pricing, atomic credit deduction before the paid action, an append-only ledger, protection against concurrent overspending, refunds for failed runs and a reconciliation report.
- **Personal edition** pricing is separate and to be defined (per filing, subscription, or both).

---

## 13. Current state and prerequisites

The repository audit of 12 October 2026 concluded **NOT READY for real client data**. The following must be closed before the capabilities in this document are exposed to real users:

1. Per-firm data isolation across all routes (fixed in the hardening branch, not yet deployed).
2. Removal of fabricated extraction output (fixed in the hardening branch, not yet deployed).
3. Row-level security on remaining tables (migration written, not applied).
4. WhatsApp webhook: signature verification, firm mapping, media download and de-duplication.
5. Per-firm uniqueness of PAN and phone (currently global).
6. Credit ledger and rate limits.
7. A reproducible database schema as ordered migrations.
8. Continuous integration with tests, type checking and build.

Capabilities present in the demo but not implemented in the product today: the live agent view, plan-and-approve runs, confidence scores in production, side-by-side review for generated files, validated filing formats, a working AI assistant (the current assistant is a keyword matcher), reminder sending from the interface, deadline creation, firm fee invoicing and role-based permissions.

---

## 14. Open decisions

| # | Decision | Why it matters | Needed by |
|---|---|---|---|
| 1 | Where client files live: local vault only, cloud inbox that syncs to the vault, or cloud storage | Determines WhatsApp intake, the Personal edition and the security model | Before Phase 1 build |
| 2 | ERI route: register Taxflow as a Type 2 ERI, or partner with an existing ERI | Determines timeline, cost and liability for India ITR submission | Before Phase 3 |
| 3 | Personal edition platform: Windows desktop, web, mobile, or a combination | Determines storage, onboarding and distribution | Before Phase 4 |
| 4 | GSP partner for GST submission | Required for any GST L2 | Before Phase 3 |
| 5 | Liability and terms for submitted filings | Needed for any L2 | Before Phase 3 |
| 6 | Who qualifies as the "reviewer" in the Personal edition (the individual, or an optional professional reviewer service) | Affects trust and potential revenue | Before Phase 4 |
| 7 | Second country: UAE or UK first, once portal channels are confirmed | Determines Phase 5 scope | Before Phase 5 |
| 8 | Books scope and storage: Taxflow's own ledger for firms' client books, the firm's own books, or both first | Determines Phase 6 size and data model | Before Phase 6 |
| 9 | Accounting standards and presentation formats for the first countries, confirmed by professionals | Reports must meet local rules | Before Phase 6 |
| 10 | Bank data route: statement import only, or a regulated aggregator or bank APIs | Determines feed coverage, cost and consent design | Before Phase 7 |
| 11 | E-invoice and e-way bill access route (direct, or through a GSP partner) | Required for any L2 e-invoicing | Before Phase 8 |
| 12 | Payroll scope: which statutory returns at launch and for which states or countries | Determines rule-engine effort and professional review cost | Before Phase 8 |
| 13 | Marketplace and public API timing and review process | Security and support load | Before Phase 9 |

---

## 15. Release plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Production hardening** | Section 13 items 1–8 | Audit verdict is at least "ready for staging"; tests pass in CI |
| **1. CA edition, India, L0** | Agent runs with plan, live view, review gates and final approval; validated files for GSTR-1, GSTR-3B, GSTR-2B reconciliation, ITR computation, TDS 26Q, Tally import and registers; WhatsApp intake; credits | Design-partner firms complete real filing periods end to end, with zero unreviewed values used |
| **2. L1 guided submission** | Portal checklists with exact values and acknowledgement matching | Firms report portal entry time reduced |
| **3. L2 India** | GST via GSP partner; ITR via ERI route | Registered or partnered; first authorised submissions with approval and OTP/DSC flows |
| **4. Taxflow Personal** | Simplified shell, plain-language review, individual ITR | Individuals complete a return without professional help in usability tests |
| **5. Second country** | UAE or UK VAT at the highest confirmed level | Channel confirmed; local rules engine verified by a local professional |
| **6. Books** | Accounting engine, reports, migration from Tally and Zoho Books with parity check, maker-checker and custom roles, filing from the ledger (Sections 7.8, 7.13, 7.14) | Design-partner firms close a real month in Taxflow with trial balance parity against their previous software and zero unreviewed postings |
| **7. Inventory and banking** | Items, batches, stock ledger and valuation; statement import and reconciliation; bank feeds if confirmed (Sections 7.9, 7.10) | Stock and bank reconciliation parity on real datasets; reconciliation time reduced for design-partner firms |
| **8. E-invoicing, e-way bills and payroll** | Invoice and e-way bill generation and, where a channel is confirmed, submission; payroll and statutory files (Sections 7.11, 7.12, 8.5) | Registered or partnered where required; payroll parity on real datasets; first authorised e-invoice submissions with approval |
| **9. Platform** | Web and mobile access, saved and scheduled reports, public API, marketplace (Section 7.15) | Firms can run a full month from a browser and a phone; first reviewed third-party integrations listed |

---

## 16. Success metrics

| Metric | Definition |
|---|---|
| **North star** | Filings completed with final approval per active user per month, with no manual retyping |
| Time to first value | Share of new users whose first agent run completes within 48 hours |
| Review efficiency | Median review time per document and per filing; share of fields approved without edit |
| Correctness | Filing files rejected by a portal or corrected after approval (target: trending to zero) |
| Trust | Incidents of unreviewed data used, message sent without consent, or cross-account access (target: zero) |
| Adoption | Weekly active firms as a share of paying firms; share of runs started by natural-language request |
| Business | Monthly recurring revenue, gross margin after AI and messaging cost, credit utilisation, churn |
| Parity (v4.0) | Share of migrated datasets whose trial balance, profit and loss and balance sheet match the source software exactly (target: 100% before a module is released) |
| Better than incumbents (v4.0) | Median time to book 100 purchase invoices, entry errors found after posting, and time to reconcile a bank account, each measured with design-partner firms against their previous use of Tally or Zoho Books (target: lower on all three) |
| Safety (v4.0) | Postings without an approved review gate, unbalanced vouchers, permission-test failures (target: zero) |

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Extraction errors on poor documents | Wrong data reaches a filing | Mandatory review; published accuracy by document type; flag, never guess |
| Rule-engine errors or stale rules | Incorrect filings | Versioned engines, professional review, test suites from official examples |
| Regulatory path for submission is slower or narrower than assumed | Phase 3 delay | Launch value with L0/L1; confirm each channel before commitment; use partners |
| Liability for a filing the user approved | Legal exposure | Terms, approval records, clear separation of AI preparation from professional responsibility; legal review |
| Over-trusting the AI | Users approve without reading | Flagged items cannot be bulk-approved; show derivations; track approval time |
| WhatsApp policy or pricing change | Delivery and cost | Utility-style templates, email or portal fallback, policy monitoring |
| Competitors extend into agentic filing | Differentiation | Depth in firm workflow, multi-client view, review quality |
| Consumer product demands different security, support and acquisition costs | Distraction from the CA product | Phase 4 only after Phase 1–3 are stable |
| Scope growth from adding books, inventory, banking, e-invoicing and payroll | Delayed core product; thin quality in every area | Phases 6 to 9 start only after Phases 0 to 3 are stable; one module at a time with its own exit criteria |
| Accounting or statutory errors in the books modules | Wrong financial statements and wrong filings | Integrity invariants, parity tests against Tally and Zoho Books, professional review per country (Section 7.16) |
| Incumbents are entrenched and migration is hard | Slow adoption | Export and import stay supported; migration with parity check; run-alongside period; full data export at any time |
| Bank, e-invoice and payroll channels are narrower or costlier than assumed | Module delay | Confirm each channel before commitment (Section 8.5); statement import and L0/L1 are the fallback |
| Payroll and bank data are highly sensitive | Privacy incident | Field-level masking, restricted roles, access logging, encryption, no bank credentials stored |

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **Agent Run** | One execution of a task by the AI agent, from request to close |
| **Review gate** | A point where a run pauses for human review |
| **Final approval** | The recorded human sign-off that marks a run complete |
| **L0–L3** | Execution levels, from preparing files to autonomous filing (Section 5.4) |
| **ERI** | e-Return Intermediary, an entity authorised by the Indian Income Tax Department to file returns for taxpayers |
| **GSP / ASP** | GST Suvidha Provider (approved by GSTN to access the GST system) / Application Service Provider (software provider that connects through a GSP) |
| **DSC** | Digital Signature Certificate |
| **ITR** | Income Tax Return |
| **Derivation trail** | The recorded inputs and rules that produced a computed value |
| **Voucher** | A single accounting entry (sale, purchase, receipt, payment, journal, contra, debit or credit note) |
| **Chart of accounts** | The structured list of ledgers and groups in which a client's transactions are recorded |
| **Trial balance** | A list of all ledger balances whose debit total and credit total must be equal |
| **Parity test** | A test that runs the same data through Taxflow and through Tally or Zoho Books and requires identical results |
| **Maker-checker** | A rule that the person who prepares an item cannot be the person who approves it |
| **IRN / IRP** | Invoice Reference Number / Invoice Registration Portal, the Indian government system that registers e-invoices |
| **Godown** | A storage location for stock |
| **Account aggregator** | A regulated, consent-based channel for sharing financial data such as bank statements (India); route to be verified |

---

## Appendix A. Example Agent Runs

### A.1 Practices: "Generate GSTR-3B for Iyer & Sons for August"

| Step | Action | Review gate |
|---|---|---|
| 1 | Check that August sales and purchase documents are all received; list anything missing | — |
| 2 | Read any unread documents | **Gate 1:** side-by-side review of low-confidence or flagged documents |
| 3 | Validate: duplicates, tax IDs, arithmetic | Flags fed into Gate 1 |
| 4 | Reconcile purchases against GSTR-2B and list mismatches | **Gate 2:** mismatches reviewed and resolved |
| 5 | Calculate output tax, ITC and net payable with the GSTR-3B rule engine | — |
| 6 | Build the GSTR-3B file and validate it against the portal format | **Gate 3:** side-by-side of source totals and each filing box; derivation on every value |
| 7 | **Final approval** by the reviewer | Recorded with identity and version |
| 8 | Save to the client folder as Approved; update the Deadlines card | — |
| 9 | Level L0: hand over the file. Level L2 (later): request a separate submission approval, then submit through the GSP and show the portal response | **Submission approval** |

### A.2 Personal: "File my income tax return"

| Step | Action | Review gate |
|---|---|---|
| 1 | Ask which year and which income sources apply, in plain language | — |
| 2 | Request documents (Form 16, bank interest certificates, investment statements) and read them | **Gate 1:** side-by-side review with plain explanations |
| 3 | Pull in any available tax statements if the user connects them | **Gate 2:** confirm what was fetched |
| 4 | Compare tax regimes and deductions with the ITR rule engine; show both outcomes and the derivation | **Gate 3:** user chooses and confirms |
| 5 | Build the return and validate it | **Gate 4:** full return summary beside the source documents |
| 6 | **Final approval** by the user | Recorded |
| 7 | L0: give the user the finished file and exact upload steps. L2 (later): submit through the authorised channel, then guide the user through verification of the return | **Submission approval**, then taxpayer verification |

### A.3 Practices (v4.0): "Book August purchase invoices for Iyer & Sons and reconcile the bank"

| Step | Action | Review gate |
|---|---|---|
| 1 | Check that all August purchase invoices and the bank statement are received; list anything missing | — |
| 2 | Read any unread documents and validate: duplicates, tax IDs, arithmetic | **Gate 1:** side-by-side review of flagged documents |
| 3 | Propose purchase vouchers: party, expense or stock ledger, tax ledgers, reusing this client's past mappings; show what is new | **Gate 2:** reviewer approves, edits or rejects each proposed voucher; flagged ones are opened individually |
| 4 | Post approved vouchers to the books; check that the trial balance still balances | — |
| 5 | Import the bank statement and match lines to vouchers; list unmatched and ambiguous items with suggestions | **Gate 3:** reviewer confirms each ambiguous match and unmatched item |
| 6 | Produce the bank reconciliation statement and update stock for item lines | **Gate 4:** reconciliation difference must equal the listed unreconciled items |
| 7 | **Final approval** by a different person than the preparer where maker-checker applies | Recorded with identity and version |
| 8 | Save reports to the client folder as Approved; update the Deadlines card; export to Tally or Zoho Books if the firm still uses them | — |

---

## Appendix B. Regulatory facts and sources

Verified statements in Section 8.3 are taken from these pages. They are secondary or vendor sources and one official intermediary; **confirm each directly with the Income Tax Department, Protean and GSTN before any commitment.**

- [ClearTax — e-Return Intermediary (ERI) Income Tax](https://cleartax.in/s/e-return-intermediary-eri-income-tax): definition of an ERI, eligibility categories, DSC requirement, registration steps, fee, data-retention and privacy obligations, ERI duties including confirming the taxpayer's verification and providing the acknowledgement.
- [Protean — e-Return Intermediary](https://tin.tin.proteantech.in/eri): resident-applicant requirement, Type 1, 2 and 3 definitions, registration steps, required documents, fee of ₹4,720 including GST, permitted activity under the Electronic Furnishing of Return of Income Scheme, 2007.
- [Tally Solutions — ASP vs GSP in GST](https://tallysolutions.com/gst/asp-vs-gsp-in-gst-what-is-the-difference-and-how-do-they-work-together/): ASP and GSP roles, the requirement that ASPs connect through a GSP, taxpayer authorisation of a GSP–ASP pair by OTP.
- [ClearTax — GST API access](https://cleartax.in/s/gst-api-access): taxpayer-enabled API access from the GST portal, session duration, available API functions including GSTR-1 to GSTR-9 filing.

**Not verified for this document:** the final-filing authentication step for GST (EVC or DSC), UAE FTA programmatic filing, UK HMRC recognised-software requirements, portal terms of use regarding automation, and data-protection law by market.

**v4.0 additions not verified:** the capabilities attributed to Tally and Zoho Books in Appendix D come from the vendors' own product and help pages and are marketing descriptions, not independent tests; the access routes, thresholds and costs for e-invoicing, e-way bills, payroll returns and bank data in Section 8.5 are marked To verify or Unknown; and accounting-standard presentation formats per country (Section 7.8, item 6) have not been confirmed.

---

## Appendix C. Demo to product map

| Demo element | Retained as | Change |
|---|---|---|
| Left navigation (3 groups, 9 pages) | Unchanged | None |
| Dashboard KPIs, pipeline, activity | Unchanged layout | Adds awaiting-review and credits |
| Invoice extraction: queue, original beside fields, hover highlight, confidence, approve | Document review gate | Adds flags, derivations and mandatory review rules |
| WhatsApp: chats, scheduled reminders, templates, "needs approval" | Unchanged layout | Agent drafts; inbound documents start runs |
| Client folders: client / year / month / Raw, Extracted, Generated | Unchanged layout | Approved state and run link on every file |
| Deadlines: filing cards, step checklists, progress bars | Unchanged layout | Steps complete from approved runs |
| File generator: client, period, types, preview | Filing-file review gate | Plan, validation against official format, side-by-side review, level shown |
| Clients, Billing & fees | Unchanged layout | Obligations and consent; subscription and credits |
| Settings: integrations, rules, security and audit | Unchanged layout | Approval policies, run history, roles, credit controls |
| Assistant panel (keyword answers, opens pages) | Right-hand panel | Becomes the live agent view with plan, stream and review prompts |

---

## Appendix D. Tally and Zoho Books capability map (v4.0)

This table lists what Tally and Zoho Books offer (as described on the vendors' pages), what Taxflow does today, and the requirement that closes each gap. "Designed advantage" is where Taxflow's principles are expected to make the capability better; each is a target to be proven by Section 16, not a present fact.

| Capability | Taxflow today | v4.0 requirement | Designed advantage | Section | Phase |
|---|---|---|---|---|---|
| Double-entry ledgers, trial balance, profit and loss, balance sheet | None; stores invoices, not ledgers | Accounting engine, enforced double entry, engine-produced reports | Vouchers proposed from approved documents instead of typed; every figure drills to the source document | 7.8 | 6 |
| Inventory (stock, batches, locations) | None | Items, batches, locations, stock ledger, valuation | Item lines read from invoices and matched to items for approval | 7.9 | 7 |
| Bank feeds and reconciliation | None | Statement import and reconciliation engine; regulated feeds if confirmed | AI-proposed matches with reasons, always human-confirmed; faster monthly reconciliation | 7.10 | 7 |
| E-invoicing and e-way bills | None | Schema-valid generation; submission through an authorised channel where confirmed | Validated before submission; errors explained in plain language beside the voucher | 7.11, 8.5 | 8 |
| Payroll | None | Payroll runs, payslips, statutory calculation and files | Versioned, professionally reviewed rule engines; sensitive-data controls | 7.12 | 8 |
| Filing returns from the product | Planned for Phase 3 | Filing from ledger data through authorised channels only | Return totals must reconcile to the ledger before approval | 7.13, 8.3 | 3 and 6 |
| Roles and permissions | Not in the product yet | Role matrix, custom roles, maker-checker, approval limits, two-factor | Mandatory second person on high-impact actions; permission tests per role and action | 7.14 | 1 basics, 6 |
| Reports | Minimal | Standard reports from the engine, saved and scheduled layouts, natural-language report requests | Plain-language requests that show the underlying query; figures never produced by the model | 7.15 | 6 and 9 |
| Marketplace and integrations | Minimal | Public API, webhooks, reviewed marketplace | Reviewed listings; per-firm scoping | 7.15 | 9 |
| Mobile and web access | Desktop only | Browser and phone apps for review, approval, upload and reports | Approve from a phone with the same side-by-side review | 7.15 | 9 |
| Migration from and coexistence with Tally and Zoho Books | Export of Tally XML, Excel, CSV planned | Import with parity check; export retained | No lock-in; run-alongside period | 7.7, 7.8 | 6 |

### How "better than Tally and Zoho Books" is judged
1. **Accuracy.** Parity tests show identical results on the same data (Section 7.16, Section 16).
2. **Speed.** Time to book, reconcile and file is lower for design-partner firms than with their previous software (Section 16).
3. **Safety.** No posting without approval; no unbalanced vouchers; no permission failures (Sections 7.14, 7.16).
4. **Traceability.** Every number reaches its source document in one click (principle 4).
5. **Honesty.** Where a channel, rule or format has not been verified, the product and this document say so and fall back to preparing files (Sections 8.3 and 8.5).