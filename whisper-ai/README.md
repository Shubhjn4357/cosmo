---
title: Whisper AI Backend
emoji: "🧠"
colorFrom: blue
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# Whisper AI

FastAPI backend with:
- local chat runtime profiles
- admin dashboard and chat UI
- dataset upload/download/sync
- web research ingestion
- Turso-backed auth/profile/billing storage
- Drizzle schema + migration tooling
- Cloudflare Browser Rendering crawl integration
- optional GGUF and AirLLM runtime paths

## Hugging Face Space

This repo is configured for a Docker Space.

### Recommended Space settings

- SDK: `Docker`
- Hardware: `CPU Basic` for the fast profile, upgraded hardware for larger local models
- Persistent storage: recommended if you want local model downloads to survive restarts

### Required secrets / variables

Set these in Space Settings:

```bash
JWT_SECRET=your-secret-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me

TURSO_DATABASE_URL=libsql://your-db-name-your-org.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token
WHISPER_DB_PATH=/data/whisper/db/whisper.db

HF_TOKEN=your_huggingface_token
HF_DATASET_REPO=your-user/whisper-trained-data
GOOGLE_CLIENT_ID=your_google_oauth_client_id

GEMINI_API_KEY=optional
OPENAI_API_KEY=optional
REPLICATE_API_TOKEN=optional

CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_browser_rendering_token
```

### Runtime behavior

- Default runtime mode: `auto`
- Auto preference: `gguf-coder` when a local GGUF artifact plus llama backend is ready, otherwise `fast-coder`
- Admin UI: `/admin-ui`
- Chat UI: `/chat`
- Public health: `/api/health`

### Runtime efficiency controls

The backend now supports a lightweight power profile and background-job gating
so CPU deployments do not keep waking up work that is not needed.

Relevant env vars:

- `WHISPER_POWER_PROFILE=low-power|balanced|performance`
- `LOCAL_MODEL_THREADS=<int>`
- `WHISPER_HF_KEEPALIVE_ENABLED=true|false`
- `WHISPER_AUTO_COLLECTION_ENABLED=true|false`
- `WHISPER_AUTO_RESEARCH_ENABLED=true|false`
- `WHISPER_AUTO_TRAINING_ENABLED=true|false`
- `WHISPER_BOOTSTRAP_GGUF_RUNTIME=true|false`
- `WHISPER_BOOTSTRAP_GGUF_DOWNLOAD=true|false`
- `WHISPER_BOOTSTRAP_GGUF_INSTALL=true|false`

`low-power` caps thread counts more aggressively and disables background
collection, research, and auto-training unless you explicitly re-enable them.

The Docker image sets:

- `WHISPER_DATA_ROOT=/data/whisper`
- `WHISPER_DB_PATH=/data/whisper/db/whisper.db`
- `WHISPER_MODELS_DIR=/data/whisper/models`
- `WHISPER_UPLOADS_DIR=/data/whisper/uploads`
- `PYTHONUSERBASE=/data/whisper/runtime/python-user-base`

If persistent storage is attached, local downloads and generated files can live there.
If `/data` is not writable in the runtime, Whisper now falls back automatically
to a writable local path such as `data/` or `/tmp/whisper` instead of crashing
on startup.

## Local Development

```bash
python -m venv .venv
source .venv/bin/activate  # or use Scripts\\activate on Windows
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn api.route:app --host 0.0.0.0 --port 8000 --reload
```

Any virtualenv name is fine. The Windows startup script now auto-detects
`.venv`, `venv`, `venv312`, or a custom path supplied via `WHISPER_VENV`.

Or:

```bash
python app.py
```

### Turso + Drizzle

Python uses `libsql` for the live runtime. Drizzle is included as the schema and
migration toolchain for Turso:

```bash
npm install
npm run db:check   # via npx drizzle-kit check --config drizzle.config.ts
npm run db:push
```

The repo ships:

- `db/schema.ts` for Drizzle table definitions
- `drizzle/0000_whisper_initial.sql` as the bootstrap schema the Python app also applies
- `drizzle.config.ts` for Turso / local-file configuration

If `TURSO_DATABASE_URL` is not set, the app falls back to a local SQLite/libSQL
database at `WHISPER_DB_PATH`.

### Google Sign-In

The local Turso auth backend now supports Google ID-token sign-in when
`GOOGLE_CLIENT_ID` is configured.

- Route: `POST /api/auth/google`
- Status: `GET /api/auth/admin-status`
- Required validation: Google token signature, issuer, audience, expiry, and verified email

For local test-mode verification only, you can also set:

- `GOOGLE_TEST_ID_TOKEN_SECRET`

When that secret is present and `WHISPER_TEST_MODE=true`, the backend accepts
deterministic HS256 test tokens so the Google auth flow can be regression-tested
without live Google credentials.

### Hugging Face Dataset Sync

Learning-data sync, startup persistence, and admin dataset sync now share one
central Hugging Face dataset sync service with persisted status under the app
data root.

- Managed data now syncs with stable relative paths under the app data root, including:
  - `training_pairs.jsonl`
  - `feedback.jsonl`
  - `external_sources.jsonl`
  - `crawled_documents.jsonl`
- Research and retrieval state:
  - `research/history.jsonl`
  - `raw/scraper_state.json`
  - `knowledge/faiss.index`
  - `knowledge/metadata.jsonl`
- Runtime and model state:
  - `runtime/runtime_config.json`
  - `admin_model_state.json`
  - `checkpoints/latest.pt`
  - `checkpoints/latest-int8.pt`
  - `checkpoints/tokenizer.json`
  - `checkpoints/state.json`
- Uploaded/admin datasets sync under `datasets/<filename>`
- Admin routes:
  - `GET /api/learn/hf-status`
  - `POST /api/learn/validate-remote`
  - `POST /api/learn/sync-now`
  - `POST /api/learn/sync-now?wait=true`
  - `GET /api/learn/download-from-hf`
  - `POST /api/datasets/sync/{dataset_name}`

The admin UI now exposes HF validation and learning-data sync controls in the
Datasets panel, plus per-dataset sync actions for uploaded/exported datasets.
Research writes, runtime-profile changes, vector index saves, and completed
self-learner training runs all trigger incremental backups so a Space rebuild
can restore the latest memory and model state from the dataset repo.

### Chat Knowledge Fallback

Chat now follows a DB-first knowledge path:

- `/api/chat`
- `/api/chat/self-learner`
- `/api/chat/stream`

The runtime queries the local vector database first. If the retrieved context
is too thin, it can trigger the research ingestion pipeline, re-index the new
documents, and retry retrieval before generating the answer.

Relevant env vars:

- `WHISPER_ENABLE_WEB_KNOWLEDGE_FALLBACK=true|false`
- `WHISPER_WEB_FALLBACK_MIN_CONTEXT_CHARS=160`
- `WHISPER_WEB_FALLBACK_PROVIDER=auto|cloudflare|legacy`
- `WHISPER_WEB_FALLBACK_MAX_PAGES=2`
- `WHISPER_WEB_FALLBACK_MAX_SITES=1`
- `WHISPER_WEB_FALLBACK_DEPTH=1`
- `WHISPER_WEB_FALLBACK_RENDER=false`
- `WHISPER_WEB_FALLBACK_REFRESH_EXISTING=false`

### Self-Learner Readiness

The scratch transformer is kept behind a maturity gate so short warm-up runs do
not serve low-quality output.

Relevant env vars:

- `WHISPER_SELF_LEARNER_MIN_STEPS=50`
- `WHISPER_SELF_LEARNER_MIN_SEQUENCES=20`

### Embedding controls

The sentence-transformers embedder now runs with CPU-friendly defaults and a
small in-process cache.

Relevant env vars:

- `WHISPER_EMBEDDER_MODEL=sentence-transformers/all-MiniLM-L6-v2`
- `WHISPER_EMBEDDER_DEVICE=cpu`
- `WHISPER_EMBEDDER_BATCH_SIZE=8`
- `WHISPER_EMBEDDER_MAX_SEQ_LENGTH=256`
- `WHISPER_EMBEDDER_MAX_CHARS=1600`
- `WHISPER_EMBEDDER_CACHE_SIZE=512`

### GitHub Actions Deployment

The repo includes a GitHub Actions workflow at
`/.github/workflows/deploy-hf-space.yml` that deploys the `whisper-ai`
subdirectory to a Docker Space on every `main` push.

Required GitHub secrets:

- `HF_TOKEN`
- `HF_SPACE_ID` such as `your-user/your-space`

### Cloudflare Crawl

The research pipeline now prefers Cloudflare Browser Rendering crawl when
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set. It falls back to
the legacy search + scraper path if Cloudflare crawl is not configured.

The implementation defaults to:

- `render=false` for faster and cheaper crawl jobs
- `formats=["markdown"]` for clean ingestion into the RAG index
- bounded `max_pages`, `depth`, and `max_sites` controls
- app-side quota guards for the current Cloudflare free-plan shape:
  - `CLOUDFLARE_REST_REQUESTS_PER_MINUTE=6`
  - `CLOUDFLARE_CRAWL_JOBS_PER_DAY=5`
  - `CLOUDFLARE_CRAWL_PAGES_PER_JOB=100`
- source-policy enforcement with persisted config:
  - `RESEARCH_REQUIRE_ALLOWED_SOURCES`
  - `RESEARCH_REQUIRE_LICENSE_METADATA`
  - `RESEARCH_ALLOWED_DOMAINS`
  - `RESEARCH_ALLOWED_PREFIXES`
  - `RESEARCH_BLOCKED_DOMAINS`

If `provider=auto` and the Cloudflare crawl daily quota is exhausted, the app
falls back to the legacy search + scraper path and records that fallback in
research history. If `provider=cloudflare` is forced, the API returns a quota
error instead of silently switching providers.

Research API usage example:

```bash
curl -X POST http://127.0.0.1:7860/api/research/discover \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "cloudflare browser rendering crawl",
    "provider": "cloudflare",
    "start_url": "https://developers.cloudflare.com/browser-rendering/",
    "max_pages": 10,
    "depth": 1,
    "render": false,
    "formats": ["markdown"]
  }'
```

Recent crawl history is available to admins at:

- `GET /api/research/history`
- `GET /api/research/policy`
- `PUT /api/research/policy`
- `POST /api/research/cloudflare/validate`
- `GET /api/research/documents`
- `POST /api/research/documents/export`
- `DELETE /api/research/documents`
- `DELETE /api/research/history`
- `POST /api/research/quota/reset`
- `POST /api/research/scraper/reset`
- `POST /api/research/index/rebuild`

Cloudflare quota state is persisted under the app data root so restarts do not
reset the app-side crawl budget tracker. Research source policy is also
persisted under the app data root, and crawled documents now store provenance
metadata such as domain, provider, policy decision, and source notes. Filtered
research exports are written into the managed datasets directory so they can be
downloaded and synced like the other datasets. Manual research runs can also
set `refresh_existing=true` to re-crawl already visited URLs instead of being
blocked by scraper state. Research document deletion also prunes matching
legacy scraper state, and research index rebuild always rebuilds from the full
current research corpus so filtered maintenance operations do not silently drop
unrelated research vectors. The Cloudflare validation route uses the Browser
Rendering `/links` endpoint with inline HTML so the app can verify account/token
health without spending crawl jobs.

### Data Collection

The collection subsystem is now local-first. By default it uses a small local
image embedding path to feed collected images into `/api/feed/vision` without
depending on an external encoder service.

Collected vision samples are persisted under the managed app data root, preview
thumbnails are written under the uploads root, and retrieval mode can return
the nearest learned visual memories through `/api/feed/vision/generate` when a
trained local decoder is not available yet.

Relevant env vars:

- `IMAGE_ENCODER_BACKEND=local|auto|remote`
- `IMAGE_ENCODER_URL=` for optional remote mirroring
- `AUTO_COLLECTION_ENABLED=true|false`
- `AUTO_COLLECTION_INTERVAL_SECONDS=3600`
- `WHISPER_MAX_VISION_STORE=1000`

Useful endpoints:

- `GET /api/collect/config`
- `GET /api/collect/stats`
- `GET /api/collect/sources`
- `POST /api/collect/collect`
- `POST /api/collect/learn`
- `GET /api/feed/vision/stats`
- `GET /api/feed/vision/sample`
- `POST /api/feed/vision/generate`

In test mode the collector uses deterministic synthetic samples so collection
and local vision-feed ingestion can be verified without live network fetches.

### Smoke Check

Run the local runtime and API smoke pass against a running server:

```bash
python scripts/smoke_api.py --base-url http://127.0.0.1:7860
```

This covers health, runtime status, public UIs, chat, image generation, local
vision-feed seeding, and retrieval-based vision generation. Use `--skip-chat`
or `--skip-image` if you only want part of the flow.

If you want admin-only endpoints included, pass admin creds through env or flags:

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD=change-me python scripts/smoke_api.py
```

### GGUF Runtime Probe

If you want to inspect local GGUF readiness and auto-detection:

```bash
python scripts/gguf_runtime_probe.py
```

The GGUF profile can run through a bundled `llama.cpp` completion binary even
when `llama-cpp-python` is not installed. On Windows, native Build Tools are
still required only if you want the Python binding and pip cannot find a
prebuilt wheel.

## Runtime Profiles

Configured in the admin API:

- `fast-coder`: small CPU-friendly coder model
- `balanced-coder`: larger transformers profile
- `gguf-coder`: llama.cpp profile for downloaded GGUF weights
- `heavy-airllm`: experimental larger local profile

The `heavy-airllm` profile now prefers a downloaded local snapshot directory
when one exists under the managed model store. You can also point it explicitly
with:

- `AIRLLM_MODEL_ID`
- `LOCAL_AIRLLM_MODEL_PATH`

For fresh local installs, use the optional runtime dependencies so AirLLM gets
the compatible `optimum<2` line expected by the current integration.

Admin endpoints:

- `GET /api/admin/control-center`
- `GET /api/admin/runtime-profiles`
- `GET /api/admin/readiness`
- `POST /api/admin/database/validate`
- `POST /api/admin/payments/validate`
- `POST /api/admin/runtime-profiles/select`
- `POST /api/admin/runtime/validate`
- `POST /api/admin/runtime/download/{profile_id}`
- `POST /api/admin/runtime/bootstrap/gguf`
- `POST /api/admin/runtime/reload`
- `POST /api/admin/runtime/unload`
- `GET /api/admin/runtime/bootstrap-status`

`GET /api/admin/control-center` returns the aggregated payload used by the
admin AI control page: runtime state, readiness, self-learner status, dataset
sync, research snapshots, job state, and live training/generator log tails.

`POST /api/admin/runtime/validate` runs a fresh preflight probe for a profile
without mutating the live runtime. If you pass `test_load=true`, it also does a
temporary load test and reports whether that backend can actually initialize.

`GET /api/admin/readiness` aggregates the remaining operational blockers across
runtime, Turso/libsql, Hugging Face dataset sync, Cloudflare crawl, Google auth,
payments, and local model artifacts so the admin UI can show one deployment
readiness report instead of scattered per-service checks.

`POST /api/admin/database/validate` runs an explicit database connectivity and
schema probe. It reports whether the app is using local sqlite fallback or a
remote Turso/libsql connection, whether `SELECT 1` works, whether required
tables exist, and whether a remote `sync()` succeeds when applicable.

`POST /api/admin/payments/validate` runs a read-only Razorpay credential probe
against the orders API, persists the last validation result, and feeds that
state into the admin readiness report so payment readiness is based on a real
validation outcome instead of key presence alone.

## Notes

- On free HF CPU, `auto` is the practical default. It will use GGUF when a local artifact is ready and otherwise fall back to the fast transformers coder profile.
- The Docker Space build now defaults `INSTALL_GGUF_RUNTIME=false` so the optional `llama-cpp-python` backend is not compiled on every deploy.
- The Docker runtime sets `WHISPER_BOOTSTRAP_GGUF_RUNTIME=true`, so once the API is up it can download the GGUF asset and build `llama-cpp-python` in the background instead of blocking the image build.
- Background GGUF installs use `PYTHONUSERBASE=/data/whisper/runtime/python-user-base`, so attached persistent storage can keep the compiled runtime between restarts.
- Large fully local multimodal operation still needs stronger hardware.
- If you still want GGUF compiled during the Docker build itself, set `INSTALL_GGUF_RUNTIME=true` and expect a much slower image build.
