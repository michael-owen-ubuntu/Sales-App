# Local discovery worker

Run this Python 3.11+ worker from the `worker` directory. It uses only the standard library. It fetches configured HTTPS pages and their robots files, extracts Indonesian organizations from embedded JSON-LD, and sends evidence-backed candidates to the signed-in Supabase account’s discovery inbox. Company and contact records are created through the desktop review workflow.

## Try it with fictional data

```bash
cd worker
python3 -m discovery --config examples/sources.json --dry-run --source example-directory --limit 10
python3 -m unittest discover -s tests -v
```

On Windows, use `py -3` in place of `python3`. The supplied fixture reads a local HTML file and makes zero source requests. It demonstrates an eligible manufacturer, an excluded logistics provider, and a candidate that needs more evidence. A dry run with a live source configuration still fetches the listed pages. Candidate summaries go to stdout and each completed run writes diagnostics to `~/.gpi-sales-discovery/runs.jsonl`. Set `--state-dir` to override the directory. Runs sharing a state directory cannot overlap.

## Configure permitted sources

Create a JSON file outside source control with a `sources` array. Each live entry needs a unique lowercase `id`, display `name`, vetted public HTTPS `url`, and `"permitted": true`. Start with one source and only add pages you are allowed to fetch. The worker reads the configured page directly and checks its robots rules first. Choose a final URL that serves HTML without redirecting. Obtain permission and check site terms before adding a source.

Supported markup is embedded `application/ld+json` with `Organization`-style entries, including entries in `ItemList` or a JSON-LD graph. Sources must identify Indonesia in the organization’s structured postal address. The worker stages short published excerpts, timestamps, and reasons for suggested services. It reads receptionist or logistics PIC details only from named employees with an explicit role in the permitted public company profile. Phone and email must be published for that same person. Unlisted or ambiguous contacts stay blank. The worker does not infer names, business volumes, revenue, or transport modes. Pages that rely on rendered JavaScript, PDFs, login, or anti-bot challenges are outside the supported source set. The West Kalimantan government industrial directory uses the dedicated `kalbar-industry-xlsx` source format. Its business fields support a first-pass lead list. Verify company activity and contact details separately.

The config accepts these optional limits.

| Key | Default | Range |
| --- | ---: | --- |
| `max_requests` | 30 | 1–100, including robots requests and retries |
| `max_seconds` | 90 | 5–300 |
| `concurrency` | 2 | 1–4 |
| `timeout` | 8 | 1–20 seconds per request |
| `cooldown` | 2 | 1–60 seconds between starts on the same host |
| `max_bytes` | 524288 | 1024–2000000 per source response |
| `retries` | 2 | 0–3 |

The worker respects a longer robots crawl delay, request rate, or server Retry-After. `--limit` caps staged candidates at 100 per run and `--source` selects one configured source. Logistics providers are excluded by default. Set `"exclude_logistics": false` to stage flagged providers for review. The inbox continues to block standard prospect acceptance for flagged providers.

Identical source items use a stable fingerprint based on the permitted source URL and published item ID, or the normalized organization name, website host, and city when no item ID is available. Equivalent matches within a run require a shared name and website host or address and city. Supabase retries preserve the first staged record and its review decisions.

## Upload to Supabase

Apply the discovery inbox and worker run migrations. Provide `DISCOVERY_SUPABASE_URL`, `DISCOVERY_SUPABASE_PUBLISHABLE_KEY`, `DISCOVERY_EMAIL`, and `DISCOVERY_PASSWORD` to the worker process using a confirmed account whose inbox should receive the discoveries. Use the project’s publishable or legacy anon key and keep passwords outside source control. A systemd credential called `supabase-password` can supply the password instead of an environment value.

```bash
python3 -m discovery --config /path/to/sources.json --source approved-directory --limit 10 --dry-run
python3 -m discovery --config /path/to/sources.json --source approved-directory --limit 10
```

Use `--stage-fixtures` explicitly if sending fictional HTML-derived results to a development account. Uploads only call the candidate staging RPC and insert run summaries. In Settings, recent runs show candidate counts and source failures. **Submitted** counts staging acknowledgements, including previously staged fingerprints. Review status remains in Discover. If the network or Supabase is unavailable, see the local run log and retry the run. A partial run keeps its successful candidates and returns exit code 2.

## Optional Hermes handoff

The default classifier needs no model. For owner-reviewed assistance, run with `--classification-requests /path/to/new-requests.json` to export a bounded set of ambiguous fictional or allowed public excerpts. Review the excerpts before sharing them with any model. If using Hermes, choose its installed interface and configured provider explicitly. The worker itself makes no Hermes calls.

Save the judgments you approve as a JSON object. The keys are fingerprints from the requests file, and the values are `PROSPECT`, `LOGISTICS_PROVIDER`, or `UNKNOWN`. Pass the file with `--hermes-results /path/to/results.json` on a subsequent run. These labels guide classification only. The worker still uses source evidence to make service suggestions, and a prospect label cannot override deterministic provider exclusion. See the [Hermes CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands) for the operator interface.

## Schedule on the owner’s computer

Start with a manual pilot. Review 50–100 candidates in batches and track the share of valid prospects, duplicates, relevant services, and useful contacts you can verify. Expand by industry or region after checking quality. The same worker can run with separate approved source lists for new discovery and manual refresh. Reviewed candidates remain preserved by the staging RPC.

### Linux user timer

Place your live `sources.json` and `worker.env` in `~/.config/gpi-sales-discovery/`. In `worker.env`, set the Supabase URL, publishable key, and account email as `NAME=value` entries using the variable names above. Store only the password in the separate `supabase-password` file, readable only by your user. Adjust the checkout and Python paths in the supplied [service](schedule/gpi-sales-discovery.service) if needed. The supplied [timer](schedule/gpi-sales-discovery.timer) runs daily at 09:00 machine time with up to 20 minutes of jitter and can catch up once after downtime.

```bash
chmod 600 ~/.config/gpi-sales-discovery/supabase-password
mkdir -p ~/.config/systemd/user
cp schedule/gpi-sales-discovery.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start gpi-sales-discovery.service
systemctl --user enable --now gpi-sales-discovery.timer
systemctl --user list-timers gpi-sales-discovery.timer
```

Use `journalctl --user -u gpi-sales-discovery.service` for service diagnostics. Edit the timer’s `OnCalendar` for a different cadence. The service has a six-minute process timeout.

### Windows Task Scheduler

Create a private folder for the source config, connection JSON, and credential file. The connection JSON contains `url` and `publishableKey`. In Windows PowerShell, run `Get-Credential | Export-Clixml -Path C:\path\to\private\supabase.credential.xml` as the Windows user who will run the task.

Create a daily task for that same Windows account. Use `powershell.exe` with the following arguments, replacing the paths with your installation paths.

```text
-NoProfile -File "C:\Sales-App\worker\schedule\run-worker.ps1" -WorkerDirectory "C:\Sales-App\worker" -Config "C:\path\to\private\sources.json" -SettingsPath "C:\path\to\private\connection.json" -CredentialPath "C:\path\to\private\supabase.credential.xml" -PythonPath "C:\path\to\python.exe"
```

Set Task Scheduler to stop the task after six minutes and skip overlapping instances. Choose whether to run missed tasks when the PC is available. Use the signed-in Windows account that created the credential file. The worker runs when the owner’s computer and network are available. The app and the existing discovery inbox remain usable between runs.

### Run through Hermes

The supplied `schedule/hermes-discovery.py` runs the deterministic worker as a script-only Hermes cron job. It reads approved source settings from `~/.config/gpi-sales-discovery/sources.json`. The private `worker-auth.json` in that directory holds `email` and `password` for the CRM inbox account. Keep that file readable only by the owner. The script reads the project URL and publishable key from the app's `.env.local`.

Copy the wrapper into the Hermes profile's scripts directory before creating the job. Keep the job paused until the approved sources and sign-in are configured. With the Hermes scheduler running, resume it to run daily at 09:00 local time. A manual dry run is useful before resuming. On Linux, the optional `gpi-hermes-discovery-tick.timer` and matching service run a bare Hermes tick at 09:01 while the user service manager is active. Use them when the Hermes gateway is inactive. The worker uses the current Hermes Python interpreter and its standard library. [Hermes script-only jobs](https://hermes-agent.nousresearch.com/docs/guides/cron-script-only)

The worker keeps a private SQLite registry at `~/.gpi-sales-discovery/companies.sqlite3`. It checks stable source fingerprints and a company name paired with a website host or street address. Name alone is insufficient. Failed uploads remain pending, and an acknowledged candidate won't be uploaded on the next run. Validated candidates are sent to the discovery inbox in score order. Source excerpts and confirmed public contact fields are included, while raw pages and unrelated fields are discarded.

Priority combines evidence-backed service matches (up to 45), source confidence (up to 15), a website (10), city (10), a named logistics contact (10), and published direct contact information (10). Logistics providers score zero. This is a prioritization score, since response probability requires actual outreach outcomes.


### Regional discovery order

The worker prioritizes queued uploads by the configured source region: `jabodetabek`, `west-java` (outside Jabodetabek), `java` (the rest of Java), `sumatra`, then `other`. Scores sort candidates within each region. Tag a source only when its entries belong to that region. The Bekasi Regency industrial directory uses `bekasi-industry-html` and starts the Jabodetabek run.

Bekasi discovery checks up to six linked company profiles per run under the same request budget. It verifies the company name, extracts explicitly labeled website links and service signals, and avoids rechecking a successful profile for 14 days. Apply the discovery enrichment migration to enable the upload path for enriched candidates. Updates fill missing data only on unreviewed candidates from the same source.

### Google Maps links and optional place lookup

Discover and Companies have a Google Maps search link based on the company details already in the CRM. Search links need no API key. To save a confirmed Google Place ID for a company, apply the Google Place ID migration and use the company detail form.

For optional IDs-only lookup, enable Places API (New) in a Google Cloud project with billing enabled. Restrict a key to Places API (New), and keep it in the worker environment as `GOOGLE_PLACES_API_KEY`. From the `worker` directory, run `python3 -m discovery.maps_lookup "Company name" "Public company address"`. Open the returned links and confirm the branch before saving an ID. The lookup requests only `places.id` and does not fetch or store listing details. [Google Places pricing](https://developers.google.com/maps/billing-and-pricing/pricing) · [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id)
