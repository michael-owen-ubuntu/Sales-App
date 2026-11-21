# GPI Sales Intelligence

> **Instructions for Codex CLI** — Build a lightweight, distributable desktop application for researching Indonesian businesses that may need logistics services, managing prospect contacts, follow-ups, and eventually personal gross-profit performance. **Read this entire README before making changes.**

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

### Discovery region priority

Process eligible public sources in this order:

1. **Jabodetabek** (Jakarta, Bogor, Depok, Tangerang, and Bekasi).
2. **Rest of Java**, excluding areas already covered in Jabodetabek.
3. **Sumatra**.
4. **Other Indonesian regions**.

Start the pilot in Jabodetabek. For expanded runs, schedule eligible work by region before applying the per-run budget. Use the prospect's evidenced business location for candidate classification. Keep uncertain locations unclassified for review until verified.

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
