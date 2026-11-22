# GPI Sales Intelligence

> **Instructions for Codex CLI** — Build a lightweight, distributable desktop application for researching Indonesian businesses that may need logistics services, managing prospect contacts, follow-ups, and eventually personal gross-profit performance. **Read this entire README before making changes.**

## Run the CRM

The CRM includes company and contact management, scheduled follow-ups, an activity history, and an evidence-backed discovery inbox. With both Supabase settings blank, the app opens a fictional example workspace. You can try creating and editing records there. Changes are kept in memory until you reload or close the app.

Use Node.js 22 LTS (22.13 or newer within that release line) and npm. For native development, install Rust and the platform dependencies in the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/). On Linux these include the WebKitGTK 4.1 development libraries.

```bash
npm ci
npm run tauri dev
```

For a browser preview, run `npm run dev` and open `http://localhost:1420`. For local verification, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. The build command produces the frontend bundle in `dist/`.

### Connect Supabase

1. In a development Supabase project, apply [CRM](supabase/migrations/202611210001_crm.sql), [Follow-ups](supabase/migrations/202611210002_followups.sql), [Discovery](supabase/migrations/202611210003_discovery.sql), [Discovery run logs](supabase/migrations/202611210004_discovery_runs.sql), and [Spreadsheet import](supabase/migrations/202611210005_spreadsheet_import.sql) in that order. Then apply [Indonesian discovery contacts](supabase/migrations/202611210006_indonesian_discovery.sql). Then apply [Discovery ranking](supabase/migrations/202611210007_discovery_ranking.sql). Apply [Discovery enrichment](supabase/migrations/202611210008_discovery_enrichment.sql) for profile updates. Apply [Google Place IDs](supabase/migrations/202611210009_google_place_id.sql) to save confirmed map locations. Run pending migrations once in the SQL Editor or through your existing Supabase migration workflow.
2. Enable Email authentication and create a confirmed email/password user in **Authentication → Users**. For a private pilot, keep public sign-up disabled.
3. Run `cp .env.example .env.local`. Set `VITE_SUPABASE_URL` to your project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to your publishable key or legacy anon key. Vite embeds these public values into the build.
4. Restart `npm run dev` or `npm run tauri dev`, then sign in. Rebuild the desktop package after changing these settings.

Each company has one sales lead. Archiving hides the company from the active directory and preserves its contacts and follow-up status. Open the archived directory to restore it.

### Track follow-ups and activity

- Use **Follow-ups** or a company’s **Follow-up tasks** section to schedule, reschedule, complete, cancel, or reopen a task. Completed and cancelled tasks are available through the status filter.
- The dashboard groups open tasks for active companies into **Overdue**, **Today**, and **Upcoming**. Overdue means the due time has passed. Dates and times use your device’s time zone, and the database stores the underlying timestamps.
- Use **Activities** or a company’s activity section to log an interaction and optionally associate a contact. The timeline includes subsequent lead and task status changes. Deleting a task preserves its prior status changes, and removing a contact preserves its recorded name in past activities.

### Try the discovery inbox

Open **Discover** in the fictional example workspace. The examples cover a likely prospect, an existing CRM match, a logistics provider, and a candidate with limited evidence. Each candidate shows source excerpts, capture times, and evidence behind the suggested services.

Choose **Accept as company**, **Reject**, **Mark duplicate**, or **Needs review**. Acceptance creates a new prospect with status **New** and links the company back to the evidence. The inbox shows the requested company and contact fields. Explicitly published receptionist and logistics contacts carry over when accepted. Missing values stay blank. Possible matches require confirmation before creating a separate company. Flagged logistics providers can be reviewed, and acceptance is disabled.

To exercise staging in a development Supabase project, set `DISCOVERY_TEST_EMAIL` and `DISCOVERY_TEST_PASSWORD` in the shell for a confirmed test account. Use the public Supabase settings from `.env.local` or the shell environment.

```bash
npm run discovery:examples -- --dry-run
npm run discovery:examples
```

The dry run lists the four fictional entries. The second command stages them for the signed-in test user. Repeating it leaves the original evidence and review decisions intact because the RPC uses an owner-scoped stable fingerprint. Sign in with that test account to review the staged entries. The example script uses no discovery services and the app can run with an empty inbox.

### Run the local worker

The Python 3.11+ worker reads approved public pages containing structured organization data and stages candidates for review. Try the included local HTML fixture with no credentials or network access.

```bash
cd worker
python3 -m discovery --config examples/sources.json --dry-run --source example-directory --limit 10
python3 -m unittest discover -s tests -v
```

The [worker guide](worker/README.md) covers source configuration, Supabase sign-in, the optional reviewed Hermes handoff, and scheduling on Linux and Windows. **Settings → Discovery worker** shows recent synced run summaries.

### Import and export spreadsheets

1. Open **Companies → Import** and choose an XLSX workbook or UTF-8 CSV file. The file limit is 5 MiB, and XLSX workbooks can expand to 16 MiB. Each workbook can contain up to 10 worksheets, with up to 1,025 rows and 64 columns per sheet. Choose a worksheet and header row when needed.
2. Verify the column mapping. **Company name** is required, and each contact you import needs a name. You can map company details, preferred receptionist and logistics PIC fields, and an additional contact with a role. Format phone numbers as text in Excel to preserve leading zeros. Use full HTTP or HTTPS URLs and ISO dates (`YYYY-MM-DD`) in CSV. Separate suggested services with a vertical bar.
3. Review the preview and any possible matches against CRM records or earlier spreadsheet rows. Duplicate rows start as **Skip**. You can explicitly create a separate company or add new contacts to a selected match. Attaching contacts preserves existing company details and preferred contacts.
4. Choose **Import** to save the selected rows. Each row saves its company and contacts together. After a partial failure, retry from the same open dialog to reuse the import receipts. Use **Download error report** for invalid rows, skipped duplicates, and save errors.

Use **Export** in **Companies** or **Follow-ups** to save the current filtered view as XLSX or CSV. Company exports include the preferred receptionist and logistics PIC. Follow-up exports label UTC timestamps and include the current due bucket for open tasks. XLSX cells are written as text, and CSV formula-like values are escaped. Use XLSX to preserve phone numbers as text when reopening in Excel.

### Verify row-level security

In a disposable Supabase project with the migration applied, run [the two-user RLS check](supabase/tests/crm_rls.sql) as the database owner in the SQL Editor. It uses fictional data inside a rolled-back transaction. It checks owner access, cross-user read and write restrictions, cross-owner foreign keys, preferred-contact reassignment, and anonymous access.

Run [the follow-up RLS check](supabase/tests/followups_rls.sql) after both migrations. It checks task and activity isolation, status history, rescheduling, contact removal, and archived company behavior.

Run [the discovery RLS check](supabase/tests/discovery_rls.sql) after applying the discovery migration. It checks owner isolation, fingerprint retries, review permissions, acceptance rollback, and CRM duplicate protection.

Run [the worker log RLS check](supabase/tests/discovery_runs_rls.sql) after applying the run log migration. It checks owner isolation and append-only, idempotent run records.

Run [the spreadsheet import check](supabase/tests/spreadsheet_import_rls.sql) after applying the spreadsheet migration. It verifies row rollback, idempotent retries, company and contact preservation, and cross-account isolation.

For an end-to-end check, create two confirmed test accounts. Sign in with account A and create a synthetic company with a logistics contact, follow-up task, and activity. Copy that company’s app route, then sign out and sign in with account B. A’s records should be absent from the workspace, and opening the company route should show **Company unavailable**. Create records as B and repeat the check in the opposite direction.

## 0. Non-negotiable product context

- This is initially a **personal productivity tool**, not an official GPI Logistics system or a multi-user enterprise CRM. It may later be installed by a few trusted colleagues. Do not implement manager hierarchies, team roles, or shared ownership workflows in the MVP.
- The user **sells logistics services**: international air and sea freight (including LCL/FCL), customs clearance/PPJK, domestic transportation/trucking, warehousing, and integrated logistics solutions.
- **Prospects are Indonesian businesses that need these services**, especially manufacturers, importers, exporters, distributors, retailers, and industrial firms. **Do not target freight forwarders, logistics brokers, trucking companies, or 3PL providers by default**; those are potential partners, not primary prospects.
- Core company fields: **Company Name, Website, Address, Receptionist's Name, Logistics Contact Person, Contact Person's Phone Number, Email Address, Current Follow-up Status**.
- Desired budget: **zero recurring cloud hosting fees within free-tier limits**. Desktop installation means **no Vercel or Cloudflare frontend hosting**.
- The discovery agent runs on the owner's **Linux/Windows PC**; it periodically uploads validated discoveries to Supabase. Other users of the desktop executable should **not** need to run Hermes or a local LLM.
- Build a usable app without Hermes configured. Discovery is optional and must degrade gracefully.
- The UI should be desktop-first, responsive, with clean business-oriented styling and good keyboard support. Optional Android support is **out of scope** for the MVP.

## 1. Bootstrap: use maintained templates, not hand-written scaffolding

**Start from the official Tauri create-tauri-app React + TypeScript template**, not a random third-party repository. It is maintained by the Tauri project and reduces setup code, dependency uncertainty, and Codex token usage.

Official references:
- Tauri scaffold: https://tauri.app/start/create-project/
- Scaffold repository: https://github.com/tauri-apps/create-tauri-app
- Tauri prerequisites: https://tauri.app/start/prerequisites/
- Supabase React/Auth: https://supabase.com/docs/guides/auth/quickstarts/react
- Supabase React database quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/reactjs
- Hermes Agent: https://github.com/NousResearch/hermes-agent

From an empty parent directory, prefer:

```bash
npm create tauri-app@latest gpi-sales-intelligence -- --template react-ts
cd gpi-sales-intelligence
npm install
npm run tauri dev
```

If the generator prompts, choose **TypeScript/JavaScript → npm → React → TypeScript**. If working inside an existing repo, inspect it first; **do not overwrite existing code**. If the scaffold command or options have changed, consult the official documentation and adapt, rather than fabricating a command.

Then add only libraries needed for the current milestone:
- `@supabase/supabase-js` for auth/database
- `react-router-dom` (or current official React Router package) for navigation
- `@tanstack/react-query` for server state
- `react-hook-form` + `zod` for forms and validation
- Tailwind CSS + shadcn/ui for reusable UI components; use the **official shadcn CLI and Tauri/Vite installation guidance**, and avoid recreating component primitives manually
- `lucide-react` for icons
- `date-fns` for date display
- `vitest` and React Testing Library for tests
- Add Excel parsing (`xlsx` or another maintained library) **only when implementing imports**, after checking package maintenance/security and local-file parsing needs

Do not add Redux, Next.js, NestJS, Spring Boot, a custom API server, or complex state management without a demonstrated requirement. Pin versions in the lockfile; avoid mass upgrades.

## 2. Intended deployment and operating model

- **Desktop app:** Tauri v2 + React + TypeScript. Build distributable Windows installer and Linux package where toolchains are available.
- **Data:** Supabase Free PostgreSQL with Supabase Auth and strict Row Level Security (RLS). Every record belongs to an authenticated user in MVP; separate users' records unless explicit sharing is designed later.
- **No web server required:** desktop frontend communicates with Supabase using the public publishable/anon key and authenticated user session.
- **Discovery:** separate local Python worker with optional Hermes integration; periodic jobs push to a *staging* area, not directly to manually edited CRM records.
- **No requirement that the PC be on all day:** desktop CRM is accessible while Supabase is online; discovery runs only when the owner's PC is awake.
- **Optional offline mode:** later; do not claim offline functionality until local persistence and sync/conflict handling exist.
- **Cost:** free-tier use is a goal, not a guarantee; monitor quotas, possible project pauses, electricity, and AI API charges.

### Security rules

1. Never put Supabase `service_role`, secret keys, LLM API keys, or database passwords in the frontend, bundled Tauri resources, source control, logs, or screenshots. `VITE_` variables are bundled and are **not secret**.
2. Use Supabase Auth and RLS on **every user-owned table**. Verify with two distinct test users that neither can read or modify the other's records. Do not grant broad anonymous access.
3. If an unattended ingestion worker needs elevated privileges, keep them only on the owner's machine, preferably in an OS secret store or protected environment; prefer a restricted ingestion endpoint/role or user-scoped auth. Never expose elevated credentials to other distributed clients.
4. Do not silently overwrite salesperson-entered or manually verified contacts with scraped data. Require review/merge for conflicts.
5. Do not collect private, nonpublic, or access-controlled personal data. Respect site terms, robots/access restrictions where applicable, reasonable rate limits, and Indonesian personal-data obligations. Never bypass CAPTCHAs, authentication, or anti-bot protections.
6. Before uploading actual customer records, contact information, or GP reports to personal cloud accounts or third-party AI services, confirm permission from the data owner/employer. Use synthetic data during development.
7. Protect against spreadsheet formula injection on export, validate URLs and email/phone fields, and limit external URL opening to safe schemes.

## 3. MVP user stories

### A. Companies (highest priority)

- Create, read, edit, archive, and search Indonesian company records.
- Display: Company Name, Website, Address, Receptionist's Name, Logistics Contact Person, Contact Person's Phone Number, Email Address, Current Follow-up Status.
- Additional useful fields: city, province, industry, lead source, company type, suggested logistics services, evidence/source URL, last verified date, notes, next follow-up date.
- A company can have multiple contacts: receptionist, logistics PIC, purchasing PIC, and other. The main company view shows the preferred receptionist and logistics PIC.
- Normalize domains and company names, and warn about potential duplicates. **Never merge solely because names are similar**.
- Search/filter by company, industry, province/city, follow-up status, service fit, and missing contact fields.
- Support click-to-open website, copy phone/email, and email links.

### B. Follow-up and activity tracking

- Lead statuses: `NEW`, `CONTACTED`, `FOLLOW_UP_REQUIRED`, `QUALIFIED`, `NOT_INTERESTED`, `UNQUALIFIED`, `CLOSED`.
- Task statuses: `OPEN`, `DONE`, `CANCELLED` (overdue is **derived from due date**, not stored as a conflicting status).
- Log activities: `CALL`, `EMAIL`, `WHATSAPP`, `MEETING`, `VISIT`, `NOTE`, `OTHER` with timestamp, outcome, and notes.
- Create next-follow-up tasks; dashboard shows overdue, today, upcoming.
- Preserve activity history and status changes. Allow reschedule, complete, and cancel.
- Avoid mixing company lifecycle, contact status, and commercial opportunity stages in one enum.

### C. Discovery inbox

- Show candidate companies discovered by a local worker, with evidence URLs and verification timestamps.
- Actions: **Accept as company**, **Reject**, **Mark duplicate**, **Needs review**.
- Show a reason for each suggested service (e.g. company states it imports components). Do not assert shipping volume, revenue, or demand without evidence.
- Missing receptionist/PIC details stay **blank/unknown**; do not hallucinate them.
- Reject or flag default-target exclusions such as freight forwarders and 3PL providers.

### D. Personal dashboard

- Total prospects, new prospects, missing contacts, due/overdue follow-ups, recent activities, and recommended companies.
- GP target/actual panel is a **later milestone** and must not show fabricated values.

### E. Excel import/export (after CRM works)

- Import existing company/contact lists with preview, column mapping, validation, duplicate review, and error report.
- Export filtered company lists and follow-up tasks to Excel/CSV.
- GP import later: actual GP by shipment/job, customer, salesperson, and period **only when source Excel contains those dimensions**. Do not infer unavailable granularity. GP = net revenue minus direct costs where raw values are available; otherwise preserve imported reported GP with source metadata.

## 4. Suggested database schema (migrations required)

Use SQL migrations in `supabase/migrations/`. Favor UUID PKs, `timestamptz`, foreign keys, check constraints, indexed ownership, and audit timestamps. Implement the actual SQL, not just types.

**MVP tables**:

- `companies`: `id`, `user_id`, `name`, `normalized_name`, `website`, `normalized_domain`, `address`, `city`, `province`, `industry`, `account_status`, `source_type`, `notes`, `created_at`, `updated_at`, `archived_at`.
- `company_contacts`: `id`, `user_id`, `company_id`, `name`, `role` (`RECEPTIONIST`, `LOGISTICS_PIC`, `OTHER`), `phone`, `email`, `is_primary`, `verification_status`, `source_url`, `verified_at`, timestamps.
- `sales_leads`: `id`, `user_id`, `company_id`, `status`, `source_type`, `qualification_notes`, timestamps. Decide and enforce whether MVP allows one active lead per company per user.
- `sales_activities`: `id`, `user_id`, `company_id`, optional `lead_id`, optional `contact_id`, `type`, `outcome`, `notes`, `occurred_at`, `created_at`.
- `follow_up_tasks`: `id`, `user_id`, `company_id`, optional `lead_id`, `title`, `due_at`, `status`, `completed_at`, timestamps.
- `discovery_candidates`: `id`, `user_id`, `source_url`, `source_name`, `company_name`, `website`, `address`, `industry`, `city`, `province`, `suggested_services` (JSONB or join table), `reason`, `evidence` (JSONB), `confidence`, `status`, `discovered_at`, `last_checked_at`, `content_fingerprint`.
- `discovery_runs`: `id`, `user_id`, `started_at`, `finished_at`, `status`, `source`, `found_count`, `accepted_count`, `error_summary`.

**Later tables**:
- `opportunities`, `opportunity_stage_history`, `quotations`, `sales_targets`, `shipment_gp_actuals`, `gp_import_batches`, `company_evidence`.

**RLS policy principle:** all selects/inserts/updates/deletes restricted by `user_id = auth.uid()`; on inserts enforce ownership via `WITH CHECK`; on updates enforce both `USING` and `WITH CHECK`. Ensure child records cannot reference another user's company, e.g. via composite ownership constraints or secure database checks. Test these policies.

**Deduplication:** canonicalize website host (remove scheme, `www`, trailing slash where appropriate), normalize punctuation/case for names, compare address/city, and surface candidates for manual review. Do not globally unique-constrain company names; distinct legal entities can share similar names.

## 5. Discovery worker: hybrid scheduling

Build this **after** manual CRM and discovery inbox are usable.

### Discovery targets

- Indonesian manufacturers, importers, exporters, distributors, retail/FMCG companies, automotive/electronics suppliers, and businesses with warehouses or distribution operations.
- Potential service signals: international sourcing/export, factories, raw material imports, export markets, nationwide distribution, new warehouse, expansion announcement.
- **Exclude logistics service providers by default**; make the exclusion configurable for future partnerships.

### Sources and extraction

- Begin with permitted public company websites, public industry directories, association listings, trade fair exhibitor lists, and business announcements.
- Preserve source URL, capture timestamp, exact evidence snippets (short), and confidence/verification status.
- Only extract published business contact information; don't guess receptionist or PIC names.
- Separate `discover → extract → normalize → validate → deduplicate → stage → user review`.
- Python deterministic parsers first; optional Hermes for ambiguous classification/enrichment. Do not assume Hermes is installed, free to use, or exposes a stable SDK. Consult the actual installed Hermes CLI documentation before invoking it; implement an adapter interface with a no-op/mock provider.
- Use rate limits, bounded concurrency, retries with backoff, domain cooldowns, and per-run budgets. Avoid collecting full-site copies or bulk personal information.

### Schedule

1. **Pilot:** manually review 50–100 candidates and measure validity, duplicate rate, useful contacts, and logistics relevance.
2. **Initial discovery:** expand by industry/region only if pilot quality is acceptable.
3. **Incremental discovery:** optionally daily or every 2–3 days; prefer new sources/changes.
4. **Enrichment:** weekly for incomplete/high-priority records.
5. **Refresh:** monthly or quarterly based on staleness and prospect priority.

Use a configurable OS scheduler (`systemd` timer/cron on Linux; Task Scheduler on Windows). A sleeping/offline PC skips or delays runs; the app must remain usable.

### Ingestion safety

- Worker writes to staging (`discovery_candidates`), **not directly to `companies` or `company_contacts`**.
- Use idempotency keys/fingerprints and upsert carefully to prevent duplicate runs from duplicating candidates.
- Record failed sources without crashing the whole run.
- Support `--dry-run`, `--limit`, and `--source` flags.
- Keep an audit trail of accepted/rejected candidates.

## 6. UI screens

Desktop sidebar navigation:
1. **Dashboard** — today's follow-ups, overdue, recent discoveries.
2. **Companies** — searchable/filterable table, import/export, company detail.
3. **Discover** — candidate inbox, evidence, suggested GPI services, accept/reject.
4. **Follow-ups** — tasks, due dates, status, notes.
5. **Activities** — chronological contact history.
6. **Settings** — Supabase configuration guidance, discovery settings/status, export/backup.
7. **GP Performance** — disabled/coming soon until GP milestone is implemented.

Company detail should provide company information, contacts (including receptionist and logistics PIC), activities, follow-ups, and source evidence. Prioritize data density, clear empty states, keyboard navigation, loading/error states, and accessible forms. Use synthetic Indonesian sample companies in dev fixtures; label them clearly as examples.

## 7. Suggested repository layout

```text
gpi-sales-intelligence/
├── README.md
├── AGENTS.md                   # short Codex working rules
├── .env.example                # public Supabase config only
├── src/
│   ├── app/                   # router, providers, layout
│   ├── components/ui/         # shadcn-generated components
│   ├── features/
│   │   ├── companies/
│   │   ├── contacts/
│   │   ├── discovery/
│   │   ├── followups/
│   │   ├── activities/
│   │   └── dashboard/
│   ├── lib/                   # supabase client, validation, helpers
│   └── types/
├── src-tauri/                 # generated Tauri/Rust project
├── supabase/migrations/
├── worker/                    # Python, separate dependencies
│   ├── README.md
│   ├── discovery/
│   └── tests/
└── tests/
```

Do not create empty directories or speculative abstractions until needed.

## 8. Implementation milestones — stop after each

**M0 — Bootstrap:** scaffold official Tauri React TS starter; configure Tailwind/shadcn, routing, lint/typecheck/tests, clean layout, `.env.example`, and local development commands. Run `npm run tauri dev` if environment permits. **Stop and report.**

**M1 — CRM:** Supabase Auth, migrations/RLS, company list/detail/CRUD, contacts, duplicate warning, synthetic fixtures, unit tests and RLS test procedure. **Stop and report.**

**M2 — Follow-ups:** activity logging, task CRUD, due/overdue dashboard, history, filters and tests. **Stop and report.**

**M3 — Discovery inbox:** staging schema, review UI, accept/reject, evidence and idempotency. Build a fake-data ingestion fixture before real scraping. **Stop and report.**

**M4 — Local worker:** Python deterministic scraping of allowed sources, optional Hermes adapter, bounded scheduling, staging ingestion, run logs and tests. **Stop and report.**

**M5 — Import/export:** Excel/CSV mapping, validation, duplicates, safe export. **Stop and report.**

**M6 — GP:** only after reviewing an actual sanitized GP Excel format; implement target/actual reporting at the source's supported granularity. **Stop and report.**

**M7 — Distribution:** build Windows/Linux packages where build hosts permit; document OS prerequisites, installation, update strategy, backups, and signing warnings. **Stop and report.**

### Definition of done for every milestone

- Working functionality (not just UI mockups), or clearly labeled demo-only behavior.
- Typecheck, lint, and tests pass where applicable; document any environment-dependent checks not run.
- No secrets committed; no permissive RLS policies.
- UI includes loading, empty, validation, and error states.
- `README.md` updated with actual commands and setup steps; migrations committed.
- Short summary of files changed, tests run, known limitations, and next milestone.

## 9. Codex CLI working rules (token efficiency)

1. **Do not implement the entire roadmap in one prompt.** Start with M0 only unless explicitly asked otherwise.
2. **Reuse official templates and generated components.** Do not reimplement routing, forms, auth, or UI primitives when maintained libraries solve them.
3. Read only files relevant to the current task; avoid repeatedly dumping the full repository or documentation.
4. Prefer small, focused changes and working vertical slices; do not create placeholder implementations for future modules.
5. Before adding a dependency, verify it is necessary and compatible with the chosen Tauri/Vite version.
6. Do not invent Hermes API contracts, Supabase credentials, source websites, company contacts, or GP figures.
7. Ask only when blocked by a genuinely required external decision/credential; otherwise use documented safe defaults.
8. Never automatically run uncontrolled crawling or spend money on external APIs.
9. Keep `AGENTS.md` concise: reference this README, current milestone, code conventions, and test commands.
10. End each task with a concise completion report, then **wait for approval** before starting the next milestone.

## 10. First prompt to give Codex CLI

```text
Read README.md completely and treat it as the project specification.
Implement ONLY Milestone M0 (Bootstrap).
Use the official create-tauri-app React + TypeScript starter, not a custom scaffold.
Use the official Tailwind/shadcn setup compatible with the generated Vite project.
Set up the basic desktop layout, navigation, lint/typecheck/test scripts,
.env.example, and minimal AGENTS.md. Do not implement Supabase tables,
Hermes integration, scraping, GP, or other milestones yet.
Run available validation commands. Report changed files, test results,
missing prerequisites, and exact commands to launch the app.
Stop after M0 and wait for my approval.
```

## 11. Local setup and packaging notes

- Required for Tauri development: Node.js/npm, Rust toolchain, and platform-specific prerequisites from the official Tauri documentation (Linux WebKit/GTK dependencies; Windows C++ build tools and WebView2 as applicable).
- Use `npm run tauri dev` for development and `npm run tauri build` for packaging after setup. Verify the generated package scripts rather than assuming them.
- Building Windows installers is normally simplest on Windows; Linux packages on Linux. Do not promise a cross-compiled installer without validating the toolchain.
- Public frontend configuration example:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

- For a private single-user pilot, create an authenticated account and keep sign-up restricted where practical. If distributing to others, decide explicitly whether data is isolated by user or shared; **MVP default is isolated**.
- Keep a secure export/backup procedure; Supabase Free should not be treated as a substitute for backups.

---

**Success criterion:** A user can install the desktop app, log in, maintain an accurate list of Indonesian businesses that might need GPI's logistics services, record receptionist/logistics contacts, track follow-ups, review evidence-backed discoveries staged by a local agent, and export their work—without paying for frontend hosting or requiring Hermes on every laptop.
