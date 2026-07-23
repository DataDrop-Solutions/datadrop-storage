# DataDrop — Claude Code Skills

Custom slash commands available in this repository.

---

## /deploy

Deploy all Cloudflare Workers to production.

**Usage:** `/deploy` — deploys both workers in sequence

**What it does:**
1. Deploys `datadrop-api` (main API worker) from repo root
2. Deploys `datadrop-upload` from `workers/upload/wrangler.toml`

**Requires:** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set in environment.

---

## /deploy-api

Deploy only the main `datadrop-api` worker.

**Usage:** `/deploy-api`

**Command:** `npx wrangler deploy`

Use this when you've changed anything under `workers/api-router/`, `workers/billing/`, `workers/backup/`, `workers/stream/`, `workers/admin/`, `workers/download/`, `workers/trial/`, `workers/reconcile/`, `workers/migration/`, `workers/report/`, `workers/webhook/`, or `workers/shared/`.

---

## /deploy-upload

Deploy only the `datadrop-upload` worker.

**Usage:** `/deploy-upload`

**Command:** `npx wrangler deploy --config workers/upload/wrangler.toml`

Use this when you've changed `workers/upload/index.js` or `workers/shared/utils.js` (upload paths).

---

## /deploy-frontend

Build and deploy the React frontend to Cloudflare Pages.

**Usage:** `/deploy-frontend`

**Commands:**
```bash
cd app && npm run build
npx wrangler pages deploy dist --project-name datadrop-app
```

---

## /db-migrate

Apply a D1 schema migration to the remote database.

**Usage:** `/db-migrate <migration-file>`

**Example:** `/db-migrate schema/migration_v4.sql`

**Command:** `npx wrangler d1 execute datadrop-db --remote --file=<migration-file>`

**Rules:**
- Never run `schema/schema.sql` on an existing live DB — that is for first-time setup only
- Apply migrations in version order (`migration_v2.sql` before `migration_v3.sql`, etc.)
- Always test the SQL locally or on a staging D1 before applying to production

---

## /tail

Stream live logs from the main `datadrop-api` worker.

**Usage:** `/tail`

**Command:** `npx wrangler tail datadrop-api`

---

## /dev

Start local development server for the frontend (proxies API calls to the live `api.datadrop.co.in`).

**Usage:** `/dev`

**Command:** `cd app && npm run dev`

The Vite dev server runs on port 3000 and proxies `/api/*` → `https://api.datadrop.co.in`.

---

## /set-secret

Set a Cloudflare Worker secret.

**Usage:** `/set-secret <SECRET_NAME>`

**Command:** `wrangler secret put <SECRET_NAME>`

See `wrangler.toml` comments for the full list of required secrets.
