# Phase 4 and 5 implementation, 3 October 2026

This document records the initial 036/037 slice. The subsequent [migration 039 operations follow-up](OPERATIONS_MAINTENANCE.md) adds automatic private index maintenance, mapping pagination/reconciliation and webhook key rotation. Manual-refresh and missing-rotation statements below describe the initial slice; use the follow-up for the current rollout.

This is a tested local implementation of the integration and hosted-intelligence slices. It is not a claim that all Phase 4/5 work or hosted acceptance checks are complete. Calendar/mailbox connectors still require a provider decision and OAuth application setup; neither connector is implemented in this slice. Existing Supabase authentication/database and private R2 documents remain the storage architecture.

## Deploy in order

1. Back up your database. Apply migrations **036_integrations.sql**, then **037_intelligence.sql**, after existing migrations 001–035. Run these normally as the database owner in the Supabase SQL editor; they establish their own RLS and grants. Do not disable RLS.
2. Optionally run **supabase/optional/038_pgvector_index.sql** for the pgvector column/index. Migration 037 already supports exact cosine retrieval over PostgreSQL arrays, so the optional file is not required to use hosted search. The optional script discovers the extension's actual schema and adds a 384-dimensional vector column/HNSW index. Filters and live source fingerprints remain mandatory in both search implementations; filtered HNSW recall/throughput require hosted measurement.
3. Deploy this frontend and Netlify functions. Set server-only `SUPABASE_SERVICE_ROLE_KEY` and existing Supabase configuration. The scheduled `webhook-worker` runs every minute in production, with two deliveries per run. This worker does not run on a plain Vite dev server. DNS lookup is capped at two seconds, delivery at five, and worker database calls at three seconds. Failed claims/completions can recover after the two-minute lease expires.
4. In workspace settings, create a **paused** webhook subscription with a public HTTPS receiver and a random signing secret of at least 32 characters. Keep the same secret in the receiver. Enable the subscription after deploying signature verification/deduplication. Never put signing secrets into a public repository.
5. In Candidates → Hosted talent intelligence, click **Refresh shared index**, then **Index next 20 candidates** until the pass completes. Refresh after professional-field changes. A candidate with a changed professional projection or merge marker is excluded immediately from old-vector retrieval. Name/contact-only changes do not require reindexing; search reads those current record values. Index refresh is manual in this version; it is not an automatic nightly service.
6. Optional AI: add server-only `OPENAI_API_KEY`, `AI_EMBEDDING_MODEL` (default `text-embedding-3-small`), and an explicitly chosen Responses-compatible `AI_DRAFT_MODEL` in Netlify; redeploy. Then enable external AI in workspace settings. No AI key is needed for shared-index search. AI remains disabled by default and calls are billed separately by the configured provider.

## Integration writes and reconciliation

`POST /.netlify/functions/integration-candidate` accepts a signed-in workspace editor's bearer token. No shared service key is accepted from the browser. Authentication is Supabase user authentication; a dedicated machine-account/token lifecycle is future work.

Example body (fictional candidate):

```json
{
  "source": "crm-import",
  "externalId": "record-42",
  "candidate": {
    "name": "Example Candidate",
    "email": "example@example.com",
    "title": "React engineer",
    "skills": ["React", "TypeScript"]
  }
}
```

Send `Authorization: Bearer <user access token>`, `Content-Type: application/json`, and `Idempotency-Key: <unique request key>`. A successful write returns `candidateId`, `version` and `replayed`. Reusing an identical request/key returns the stored response without writing again; reusing a key for different data returns HTTP 409. Existing external IDs require the last returned `version`, and conflicts return 409. UI changes also advance the external mapping version. Read `api_external_mappings(p_source)` to reconcile the latest 100 mappings; pagination and bulk reconciliation are future work.

The write and receipt commit atomically. Candidate validation, tenant links, uniqueness, audit triggers, server assignment and workflows apply. Only explicitly allowed candidate fields can be written. No salary, tenant ID, custom admin data or merge markers can be injected. Merged candidates require explicit reconciliation rather than silently redirecting writes.

## Webhook receiver contract

Events cover insert/update on candidates, demands, considerations, interviews and offers. A payload contains a UUID `id`, `type`, `workspaceId`, `occurredAt` and `data.id`. It contains **no candidate contact data or raw documents**. A receiver may retrieve additional permitted fields using an authenticated API.

Headers:

- `Anthroprime-Event-Id`: stable event UUID for deduplication.
- `Anthroprime-Timestamp`: Unix seconds.
- `Anthroprime-Signature`: `v1=<hex HMAC-SHA256>` of `timestamp + "." + exact request body bytes`, using the subscription secret.

Verify the exact body before parsing, compare signatures in constant time, reject timestamps older/newer than five minutes, and persist deduplication keyed by event ID. A successful HTTP 2xx acknowledges delivery. Delivery is **at least once**: a worker can crash after the receiver accepts but before recording completion. Retries retain the event ID and use a fresh timestamp/signature. Non-2xx, redirects, timeouts and connection failures retry with exponential delay, up to five attempts. Admins can retry terminal failures only while the subscription is enabled; completed deliveries cannot be replayed through the admin control. Receiver/network errors are sanitized in logs/status.

HTTPS port 443 is required; URL credentials, fragments, private/reserved/local/mapped/tunnel IPs and redirect following are blocked. DNS is validated and pinned for the actual request to avoid rebinding. Signing secrets and queued payloads are not readable by authenticated users directly; admin RPC output excludes secrets. Secrets are stored in the protected database, not encrypted with a separate application key. Rotation UI, delivery retention/pruning, receiver throughput tests and migration rollback drills remain work.

## Hosted retrieval and optional AI

Shared search uses deterministic 384-dimensional feature hashing computed locally and stores vectors in Supabase. This is a private text/skill similarity fallback, **not language-model semantic understanding**. Location, status and minimum experience filters execute in PostgreSQL. Results are limited to 20, the active workspace and current, unmerged candidate projections. Similarity is not a qualification or hiring probability. Existing explainable weighted candidate-demand matching remains available.

Optional OpenAI embeddings use a separate model/version namespace: `openai:<model>:384:v1`. Index a candidate for AI search before expecting it in AI results. Changing embedding models requires reindexing with the new model; old model vectors are not mixed. AI query search currently has no structured filters; the UI directs filtered searches to the shared index. Other AI-provider adapters, automated/bulk embedding jobs and model migration cleanup remain work.

The server constructs a projection containing **title, skills, experience, location and work mode**. It excludes names, employer names, emails, phones, salaries, notes, summaries and raw CV content. Values may still contain identifying information if a recruiter enters it into a professional field; the projection is field minimization, not guaranteed anonymization. An admin opts in before processing. AI query text is also sent when using AI search.

Atomic workspace reservations enforce a configurable 1–100 requests/day UTC across draft, embedding and AI-query operations. Failed calls consume the reserved count. This is a request cap, not a monetary budget; costs vary by the configured model. Input/output sizes and provider timeouts are bounded. Provider errors/keys are not shown to users. If a function dies before cleanup, a request can remain pending; it still counts for that day. Administrative cleanup of such requests is future work.

Drafts use Responses with `store: false`, fixed instructions, bounded output and a versioned professional projection. They record provider/model/version/status and creator/reviewer identities and require a recruiter to edit/review and approve or reject them. The original generated content is retained separately from the edited draft. Stale drafts cannot be approved. Approval stores the reviewed artifact **without updating the candidate profile**. Changing or disabling AI settings cannot silently rewrite business records. Metadata-only history records AI configuration/request status and webhook configuration/delivery changes without exposing secrets or generated content. A larger relevance benchmark and artifact export/version comparison remain work. The tiny deterministic retrieval fixtures are regression checks, not a production relevance evaluation or a live-provider benchmark.

References: [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings), [Responses migration and storage controls](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Supabase semantic search](https://supabase.com/docs/guides/ai/semantic-search).

## Local verification and hosted acceptance

The tests exercise PostgreSQL migrations with real pgvector, tenant isolation, editor/admin restrictions, transactional receipts, import validation, stale external versions, private index projection, source invalidation, disabled AI, quota reservation, draft review, signed delivery, DNS pinning and blocked destinations. Provider tests use mocks; no candidate data was sent to an external AI account.

Before production use, verify with two separate workspaces on the actual Supabase project: import/replay/conflict, filtered searches, edited-candidate invalidation, signed delivery to an owned receiver, retry after receiver outage, disabled-AI behavior, provider configuration and edited-draft approval. Confirm scheduled functions run in Netlify and confirm quotas remain correct under concurrent requests. These authenticated hosted checks have not been performed by this local implementation.
