# RepoDoc

**Documentation-as-a-Service platform** — paste a GitHub repository URL, get instant AI-generated documentation with Mermaid.js architecture diagrams and plain-English code explanations.

---

## Architecture Decisions

### Cache-First (Core Constraint)
Every generation request checks MongoDB for an existing `GeneratedDoc` by `repoKey` (falling back to the durable `repoId` for renamed repos) before invoking any AI. If the cached doc is current, it is returned immediately — zero AI calls, zero Cloudinary uploads. All users share the same cached document for any given repository.

### Freshness & Automatic Regeneration
Cached docs are revalidated on every authenticated resubmit of the repository URL (no manual "regenerate" button):

1. **Trigger evaluation** (`lib/freshness.ts`, `lib/significance.ts`) — GitHub `HEAD /commits/{branch}` with `If-None-Match` (ETag/304, cheap); on a moved head, `compare/{old}...{new}` classifies the change. Docs/lockfiles/tests/docs-only paths are ignored (`REGEN_MIN_SIGNIFICANT_FILES`, default 3). GitHub failures **fail open**: the cached doc is served untouched.
2. **Lock** (`lib/docLock.ts`) — atomic `findOneAndUpdate` on `status != generating OR lockedAt < now − REGEN_LOCK_TTL_MINUTES` (default 10 min, must exceed the function duration). A busy lock returns `{ status: "regenerating" }` without running a pipeline.
3. **Pipeline re-run** — same synchronous execution as initial generation: HEAD sha pinned *before* ingestion, files fetched at that ref, AI generation, then **validation gate** (`lib/docValidation.ts`: required sections, min length, balanced fences, Mermaid keyword/brackets, failure markers).
4. **Versioned storage + atomic promote** (`lib/cloudinary.ts`, `lib/promote.ts`) — upload to `docs/{slug}/v{n}` with `overwrite: false`, then a single `findOneAndUpdate` bumps `version`, rotates `previousPublicIds` (keeps exactly current + 1), clears the lock/`lastError`/`failureCount`, and returns `status: "ready"`. Only after a successful promote does the public id that fell out of rotation get destroyed. On any failure the orphan upload is destroyed, `failureCount`/`lastError` (sanitized) are recorded, and the **old doc stays live** (`{ status: "stale", reason: "regeneration_failed" }`).

`POST /api/generate` responses (discriminated union consumed by `RepoForm`):

| `status` | Meaning |
|---|---|
| `created` | First generation for this repo |
| `cached` | Doc is current (or GitHub is unreachable — fail open) |
| `regenerated` | Fresh doc promoted; includes new `version` |
| `regenerating` | Another request holds the lock |
| `stale` | Regeneration failed; previous version still served |

`GET /api/doc/[slug]/freshness` powers `DocFreshnessBanner` on the doc page: `up_to_date` / `behind` (+ `commitsBehind`) / `regenerating` / `unknown` / `source_unavailable`. It is read-only, fails open to `unknown`, and is cached for 30 s. The banner never offers a manual regenerate — resubmitting the repo URL is the only trigger.

Cloudinary keeps at most **two** live versions per slug (current + previous); versions are never overwritten (`overwrite: false`), so a failed promote can never clobber the live doc.

### Hybrid GitHub Fetch Strategy
| Condition | Strategy |
|---|---|
| Repo `size < 5 MB` | **Path A** — Download zip via GitHub's `/zipball` endpoint, extract in `/tmp`, filter by allowed extension, clean up after AI call |
| Repo `size ≥ 5 MB` | **Path B** — Fetch full file tree via `/git/trees?recursive=1`, cherry-pick high-signal files (README, package.json, entry points, config files), fetch individual file contents |

Both paths cap total AI input at **50 KB** and truncate single files over **10 KB** with a `[truncated]` marker.

### Multi-Model AI Routing
Each subtask is assigned to a primary provider with a robust fallback chain:

| Task | Primary | Fallback Chain |
|---|---|---|
| Project Overview | Gemini 2.0 Flash | Groq (LLaMA 3.1) → Mistral |
| Structure Analysis | Groq (LLaMA 3.1) | xAI (Grok) → Gemini |
| Function Breakdowns | Groq (LLaMA 3.1) | OpenAI (GPT-4o-mini) → DeepSeek → Hugging Face |
| Architecture + Mermaid | Mistral (7B) | Anthropic (Haiku) → Groq |

All AI calls are server-side only. Provider keys never reach the client.

### BYOK Encryption
API keys are encrypted with **AES-256-CBC** (Node.js built-in `crypto`) before storage in MongoDB. The IV is prepended to the ciphertext in `iv_hex:encrypted_hex` format. Decryption happens server-side on every generation request for BYOK users.

### Cloudinary Storage
Only metadata is stored in MongoDB. The full markdown document is uploaded to Cloudinary as a raw file. The doc reader fetches it client-side from the Cloudinary URL, keeping MongoDB lean and avoiding large document storage.

### Auth.js v5 Email-Based Account Linking
On every sign-in, if a user with the same email already exists in MongoDB, the new OAuth provider is appended to `accounts[]` rather than creating a duplicate user. This silently merges GitHub and Google logins for the same email address.

---

## Environment Variables

Create a `.env.local` file with the following keys:

```bash
# Auth.js v5
AUTH_SECRET=              # generate: openssl rand -base64 32

# GitHub OAuth (https://github.com/settings/developers)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Google OAuth (https://console.cloud.google.com/)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# MongoDB
MONGODB_URI=              # e.g. mongodb+srv://user:pass@cluster.mongodb.net/repodoc

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# AI Platform Keys (Free Tier)
GROQ_API_KEY=
GEMINI_API_KEY=
MISTRAL_API_KEY=
HUGGINGFACE_API_KEY=

# AI Platform Keys (Dormant Paid)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
XAI_API_KEY=
GOOGLE_GEMINI_PAID_API_KEY=
DEEPSEEK_API_KEY=

# AES-256-CBC key (32-byte hex): openssl rand -hex 32
ENCRYPTION_KEY=

# GitHub API token (optional: raises rate limit from 60 to 5000 req/hr)
GITHUB_TOKEN=

# Freshness / regeneration tuning (optional)
REGEN_LOCK_TTL_MINUTES=10    # lock staleness threshold (minutes)
REGEN_MIN_SIGNIFICANT_FILES=3 # changed files needed to trigger regeneration

# App
NEXTAUTH_URL=
```

---

## Setup

```bash
# 1. Clone and install
git clone <repo>
cd daas
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your values

# 3. Run development server
npm run dev

# 4. Run tests (spawns a temporary local `mongod` — must be on PATH)
npm test

# 5. Backfill freshness fields on an existing deployment (idempotent)
node --experimental-strip-types scripts/migrate-regen-fields.ts --dry-run
node --experimental-strip-types scripts/migrate-regen-fields.ts
```

---

## OAuth App Setup

### GitHub
1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. New OAuth App
3. Homepage URL: `http://localhost:3000`
4. Callback URL: `http://localhost:3000/api/auth/callback/github`
5. Scopes granted: `read:user`, `user:email`

### Google
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. APIs & Services → Credentials → Create OAuth 2.0 Client ID
3. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

---

## Freemium Model

| Tier | Generations | Keys |
|---|---|---|
| Free | 3/day (resets via `freeDocsResetAt`) | Platform keys |
| BYOK | Unlimited | Your own (encrypted at rest) |

A **free-tier credit is consumed when the AI call completes** — for initial generations and for regenerations alike — so failed regenerations cannot be retried in a loop to bypass the daily cap. Cache hits and insignificant-change checks never touch the quota. Payments and paid plans are deferred to a future phase.

---

## Project Structure

```
/app
  /api/auth/[...nextauth]  → Auth.js v5 route handler
  /api/generate            → POST: generation + freshness-triggered regeneration
  /api/doc                 → GET: fetch doc metadata by slug
  /api/doc/[slug]/freshness → GET: freshness status for the banner (read-only)
  /api/keys                → CRUD: BYOK key management
  /api/onboarding          → POST: mark onboarding complete
  /dashboard               → Protected user dashboard
  /doc/[slug]              → Public doc reader (no auth required)
  /login                   → OAuth sign-in page
  /onboarding              → First-login API key setup
  /settings                → BYOK key management UI

/lib
  /ai.ts                   → Unified multi-model AI service
  /cloudinary.ts           → Versioned raw upload (docs/{slug}/v{n}) / fetch / destroy
  /crypto.ts               → AES-256-CBC encrypt/decrypt
  /db.ts                   → MongoDB singleton connection
  /docLock.ts              → Atomic regeneration lock (acquire/release)
  /docValidation.ts        → Deterministic output validation gate
  /freshness.ts            → ETag/304 head check + change classification
  /github.ts               → Hybrid fetch strategy (ref-pinned ingestion)
  /promote.ts              → Atomic version promote + failure bookkeeping
  /quota.ts                → Free-tier quota + BYOK key resolution
  /repoUrl.ts              → Canonical GitHub URL parsing
  /significance.ts         → Ignore lists + significance threshold
  /pipelineVersion.ts      → PIPELINE_VERSION constant

/models
  /User.ts                 → User schema (BYOK keys, rate limiting)
  /GeneratedDoc.ts         → Doc schema (freshness, lock, version rotation)

/components
  /DocFreshnessBanner.tsx  → Freshness/regeneration banner (client)
  /DocReader.tsx           → Markdown + Mermaid renderer (client)
  /RepoForm.tsx            → Repo URL submission form (client)
  /KeySettings.tsx         → BYOK key management UI (client)

/scripts
  /migrate-regen-fields.ts → Idempotent backfill for existing deployments

/types
  /next-auth.d.ts          → Session type augmentation

/__tests__
  → unit suites (parsing, significance, validation, lock, promote)
  → route suites (generate, regeneration orchestration, freshness API)
  → regen.integration.test.ts (real local mongod: races, locks, rotation)
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.local`
4. Update OAuth callback URLs to your production domain
5. Deploy

No persistent filesystem is assumed outside `/tmp` (used only during zip extraction, cleaned up after each request).
