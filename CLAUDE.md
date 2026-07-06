# DataDrop — Claude Code Context

DataDrop is a privacy-first cloud storage service built entirely on Cloudflare's edge infrastructure. Users upload files to Backblaze B2 (cold storage) and Cloudflare R2 (hot storage), pay per GB/month via Razorpay wallet, and can optionally lock files in an end-to-end encrypted Vault.

## Repository layout

```
datadrop-storage/
├── wrangler.toml              # Main worker config (datadrop-api, Account A)
├── package.json               # Dev deps: wrangler only
├── scripts/
│   └── deploy.sh              # Full infrastructure bootstrap script
├── schema/
│   ├── schema.sql             # Canonical D1 schema (run once on new DB)
│   └── migration_v*.sql      # Incremental migrations (apply in version order)
├── workers/
│   ├── api-router/            # Main router + route handlers (bundled into datadrop-api)
│   │   ├── index.js           # Subdomain routing + scheduled + queue entrypoint
│   │   ├── files.js           # File CRUD, folders, sharing, versions, trash
│   │   ├── shares.js          # Share link management
│   │   ├── user.js            # Profile, wallet top-up, OTP, billing meter
│   │   ├── vault.js           # E2EE vault (v1 PIN+AES, v2 ECDH P-256+per-file DEK)
│   │   └── teams.js           # E2EE account-to-account team workspaces
│   ├── upload/                # Separate worker: datadrop-upload (own wrangler.toml)
│   │   └── index.js           # B2 chunked/multipart upload proxy
│   ├── download/              # files.datadrop.co.in — CDN download handler
│   ├── stream/                # stream.datadrop.co.in — video streaming
│   ├── admin/                 # admin.datadrop.co.in — admin panel
│   ├── billing/               # Cron: Razorpay billing (1st of month)
│   ├── backup/                # Cron: daily R2→B2 backup
│   ├── trial/                 # Cron: trial expiry enforcement
│   ├── reconcile/             # Cron: hourly storage byte reconciliation
│   ├── migration/             # Queue consumer: async file migrations
│   ├── report/                # User-initiated file reports
│   ├── webhook/               # Clerk + Razorpay webhook handlers
│   ├── r2-hot/                # SEPARATE Cloudflare account (Account B), own wrangler.toml
│   │   └── index.js           # Serves datadrop-hot R2 bucket via INTERNAL_SECRET auth
│   └── shared/
│       └── utils.js           # Shared utilities: auth, CORS, D1 helpers, B2 API, email
└── app/                       # Frontend (React + Vite) — Cloudflare Pages project: datadrop-app
    ├── src/
    │   ├── pages/Dashboard.jsx   # Main app shell — all views, upload, file management
    │   ├── components/FileGrid.jsx   # Shared file/folder grid (files, vault, teams views)
    │   ├── components/VaultSetup.jsx # Vault unlock, E2EE operations, vault FileGrid
    │   ├── components/TeamsView.jsx  # Team workspace UI
    │   └── lib/api.js            # Typed API client wrapping all worker endpoints
    └── vite.config.js
```

## Infrastructure

| Resource | Provider | Name | Account |
|---|---|---|---|
| Cloudflare Workers | Cloudflare | datadrop-api, datadrop-upload | Account A |
| Cloudflare Workers | Cloudflare | datadrop-r2-hot | Account B |
| D1 Database | Cloudflare | datadrop-db | Account A |
| KV Namespace | Cloudflare | (id in wrangler.toml) | Account A |
| R2 Bucket | Cloudflare | datadrop-hot | Account B |
| R2 Bucket | Cloudflare | datadrop-backup | Account A |
| Cold Storage | Backblaze B2 | datadrop-cold | — |
| Vault Storage | Backblaze B2 | datadrop-vault | — |
| Auth | Clerk | — | — |
| Email | Resend | — | — |
| SMS/OTP | MSG91 | — | — |
| Payments | Razorpay | — | — |
| Frontend | Cloudflare Pages | datadrop-app | Account A |

## Subdomains and routing

```
api.datadrop.co.in    → datadrop-api worker (main API, /user, /files, /vault, /teams, /shares)
api.datadrop.co.in/upload/*  → datadrop-upload worker (chunked B2 uploads)
files.datadrop.co.in  → download handler (CDN file delivery)
stream.datadrop.co.in → stream handler (video streaming)
admin.datadrop.co.in  → admin handler (internal admin panel)
app.datadrop.co.in    → Cloudflare Pages (React frontend)
```

## Common commands

```bash
# Deploy main API worker (from repo root)
npx wrangler deploy

# Deploy upload worker
npx wrangler deploy --config workers/upload/wrangler.toml

# Deploy r2-hot worker (Account B — different API token required)
CLOUDFLARE_API_TOKEN=<account-b-token> CLOUDFLARE_ACCOUNT_ID=5b761b45997f1aa8bdcf455bbdf34324 \
  npx wrangler deploy --config workers/r2-hot/wrangler.toml

# Build and deploy frontend
cd app && npm run build && npx wrangler pages deploy dist --project-name datadrop-app

# Tail live worker logs
npx wrangler tail datadrop-api

# Apply D1 schema (new installation only)
npx wrangler d1 execute datadrop-db --remote --file=schema/schema.sql

# Apply a migration
npx wrangler d1 execute datadrop-db --remote --file=schema/migration_v4.sql

# Full infrastructure bootstrap (first-time setup)
bash scripts/deploy.sh

# Frontend local dev (proxies to live API)
cd app && npm run dev
```

## Key architecture decisions

**Authentication:** All API requests carry an `X-Session-Token` header. `validateSession()` in `shared/utils.js` verifies it against Clerk's session API and caches results in KV (5-minute TTL) to avoid hitting Clerk on every request.

**Storage split:** Regular files go to Backblaze B2 cold bucket. Vault files go to Backblaze B2 vault bucket. Hot/recently-accessed files are cached in Cloudflare R2 (datadrop-hot) served by the Account B worker via `INTERNAL_SECRET` auth.

**E2EE Vault:**
- V1 (legacy): PIN → PBKDF2 → AES-256 vault key → encrypt file client-side before upload
- V2 (current): ECDH P-256 key pair per user → per-file DEK (data encryption key) wrapped with user's public key → stored in D1 `file_keys` table → private key encrypted with PIN and stored in vault_config

**Chunked uploads:** Files > 100 MB use B2 large file API (multi-part). Upload worker handles the proxy — browser sends chunks directly to `datadrop-upload` worker which forwards to B2.

**Queue:** File migrations (files→vault, vault→files, team moves) are queued as messages. The `migration/index.js` queue consumer processes them asynchronously to avoid Worker CPU time limits.

**Billing:** Razorpay wallet model. Users top up a wallet; storage costs (₹/GB/month) are deducted on the 1st of each month via cron. Bill preview is computed on the last days of the month.

**Cron schedule (UTC):**
- `0 18 1 * *` — Monthly billing deduction (00:05 IST)
- `0 18 28-31 * *` — End-of-month bill preview
- `0 20 * * *` — Daily B2 backup (02:00 IST)
- `0 2 * * *` — Trial management (07:30 IST)
- `0 * * * *` — Hourly storage reconciliation

## Secrets

All secrets are set via `wrangler secret put <NAME>`. They are NOT in any committed file. The full list is documented in `wrangler.toml` under the `# Secrets` comment and in `scripts/deploy.sh`. Key ones:

- `CLERK_SECRET_KEY` — Clerk backend secret for session validation
- `B2_COLD_KEY_ID / B2_COLD_APP_KEY / B2_COLD_BUCKET_ID` — Backblaze cold storage
- `B2_VAULT_KEY_ID / B2_VAULT_APP_KEY / B2_VAULT_BUCKET_ID` — Backblaze vault storage
- `RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET` — Payment processing
- `RESEND_API_KEY` — Transactional email
- `MSG91_AUTH_KEY` — SMS OTP
- `STREAM_SECRET` — Signed URL generation for streaming
- `ADMIN_SECRET / ADMIN_PASSWORD` — Admin panel access
- `INTERNAL_SECRET` — Shared between Account A and Account B for R2 hot access
- `CF_API_TOKEN` — Cloudflare API token (used internally by some workers)

## CI/CD

GitHub Actions (`.github/workflows/deploy.yml`) deploys automatically on every push to `main`:
1. `datadrop-api` — main worker, Account A
2. `datadrop-upload` — upload worker, Account A
3. `datadrop-r2-hot` — hot storage worker, Account B
4. Frontend → Cloudflare Pages (`datadrop-app`)

Required GitHub Secrets: `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ACCOUNT_B_TOKEN`, `CF_ACCOUNT_B_ID`

## Things to avoid

- **Never hardcode tokens or secrets** in worker code or wrangler.toml — use `wrangler secret put`
- **Don't run `bash scripts/deploy.sh` on an existing live deployment** — it re-creates resources and overwrites wrangler.toml IDs
- **Don't apply schema.sql to an existing DB** — only run incremental `migration_v*.sql` files
- **Account B has different credentials** — always use `CF_ACCOUNT_B_TOKEN` when deploying r2-hot
