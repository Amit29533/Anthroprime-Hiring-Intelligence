# Private CV storage with Cloudflare R2

The application keeps candidate, job and document metadata in Supabase. New document binaries are stored in a private Cloudflare R2 bucket. Netlify Functions verify the caller's Supabase session and workspace before issuing a five-minute URL for one upload or download.

## 1. Create the private bucket

1. In Cloudflare, open **Storage & databases → R2 → Overview** and activate R2.
2. Create a bucket named `anthroprime-documents`.
3. Keep public development URLs and custom-domain public access disabled. Files are reached only through signed S3 API URLs.

## 2. Configure browser upload CORS

Open the bucket's **Settings → CORS Policy** and use this policy after replacing the Netlify domain:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:8888",
      "https://YOUR-SITE.netlify.app"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add your custom production domain as another allowed origin when applicable. An origin contains the protocol and host without a trailing slash.

## 3. Create limited R2 credentials

1. Open **R2 → Overview → Manage R2 API Tokens**.
2. Create an **Object Read & Write** token.
3. Restrict it to the `anthroprime-documents` bucket.
4. Copy the Access Key ID and Secret Access Key when Cloudflare displays them.

The secret is used only by Netlify Functions. Never put it in source control, a browser variable or any variable beginning with `VITE_`.

## 4. Configure Netlify

In **Site configuration → Environment variables**, add:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
R2_ACCOUNT_ID=YOUR_CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=anthroprime-documents
```

`SUPABASE_ANON_KEY` is intentionally the public anonymous/publishable key. The Functions pass the signed-in user's bearer token to Supabase, so the existing row-level security policies remain the authorization boundary. Do not use the Supabase service-role key.

Trigger a new production deployment after saving the variables.

## 5. Apply the metadata migration

Apply the complete migration chain in filename order; see [current Netlify deployment instructions](NETLIFY_DEPLOYMENT.md). Migration `030_document_storage_provider.sql` introduces the R2 provider fields; later attachment functions require the timestamped Phase C migrations too. Existing rows default to `supabase`, so files already uploaded to the old private bucket continue to open. New uploads are marked `r2`.

Do not remove the old Supabase `documents` bucket until its objects have been migrated and every related metadata row has been updated to `storageProvider = 'r2'` with the new R2 object path.

## 6. Verify access

1. Sign in as an admin or recruiter and upload a small PDF to an existing candidate.
2. Open the document and confirm it downloads in a new tab.
3. In Supabase, confirm the `documents` row has `storageProvider = 'r2'` and a path beginning with the workspace UUID.
4. Sign in as a viewer. Confirm the document opens and that upload controls remain unavailable.
5. Sign out and confirm the application no longer exposes candidate records or download links.

For local cloud-mode testing, put the same variables in `.env.local` and run:

```sh
npx netlify-cli dev
```

Netlify Dev normally serves the site at `http://localhost:8888`, which must appear in the bucket CORS policy.
