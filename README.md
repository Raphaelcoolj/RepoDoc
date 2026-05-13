# RepoDoc

**Documentation-as-a-Service platform** — paste a GitHub repository URL, get instant AI-generated documentation with Mermaid.js architecture diagrams and plain-English code explanations.

---

## Architecture Decisions

### Cache-First (Core Constraint)
Every generation request checks MongoDB for an existing `GeneratedDoc` by `repoUrl` before invoking any AI or GitHub API. If a document exists, it is returned immediately — zero API calls, zero Cloudinary uploads. All users share the same cached document for any given repository.

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
cp .env.local.example .env.local
# Edit .env.local with your values

# 3. Run development server
npm run dev

# 4. Run tests
npm test
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

Payments and paid plans are deferred to a future phase. The schema already includes `freeDocsUsed` and `freeDocsResetAt` to support future rate limiting without a migration.

---

## Project Structure

```
/app
  /api/auth/[...nextauth]  → Auth.js v5 route handler
  /api/generate            → POST: doc generation pipeline
  /api/doc                 → GET: fetch doc metadata by slug
  /api/keys                → CRUD: BYOK key management
  /api/onboarding          → POST: mark onboarding complete
  /dashboard               → Protected user dashboard
  /doc/[slug]              → Public doc reader (no auth required)
  /login                   → OAuth sign-in page
  /onboarding              → First-login API key setup
  /settings                → BYOK key management UI

/lib
  /ai.ts                   → Unified multi-model AI service
  /cloudinary.ts           → Raw file upload/fetch
  /crypto.ts               → AES-256-CBC encrypt/decrypt
  /db.ts                   → MongoDB singleton connection
  /github.ts               → Hybrid fetch strategy

/models
  /User.ts                 → User schema (BYOK keys, rate limiting)
  /GeneratedDoc.ts         → Doc metadata schema

/components
  /DocReader.tsx           → Markdown + Mermaid renderer (client)
  /RepoForm.tsx            → Repo URL submission form (client)
  /KeySettings.tsx         → BYOK key management UI (client)

/types
  /next-auth.d.ts          → Session type augmentation

/__tests__
  /generate.test.ts        → Integration tests for generation pipeline
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.local`
4. Update OAuth callback URLs to your production domain
5. Deploy

No persistent filesystem is assumed outside `/tmp` (used only during zip extraction, cleaned up after each request).
