# Local LinkedIn extractor experiment

The user-supplied Python script has been revised in
`tools/linkedin_profile_extractor.py`. It runs locally and connects to the
website through a reviewed JSON file import. It is not a Netlify browser
worker. No credentials are bundled or sent to the website.

## Website workflow

Open Candidates → Import → Import from LinkedIn → **Import a local LinkedIn
export**. Download the packaged tool, unzip it, and follow the local-run
instructions below. Choose its JSON output in **LinkedIn JSON export**.

The website validates one profile per file (maximum 200 KiB), checks any
entered URL against the export, blocks credential/unsafe fields and malformed
sections, and refuses duplicates. It imports only the explicitly captured
professional fields; raw page text is not used to infer contact details or
skills. Add a known email or phone yourself.

Review extraction warnings and each bounded employment, education, or
certification excerpt. Unreviewed excerpts block saving. The original export
text is shown for comparison; large sections disclose excerpt omissions.
You can remove an excerpt that should not be saved or build cited records
using the existing evidence editor. Confirm the profile, then save through
the usual candidate persistence and Anthro-ID assignment. These remain
recruiter-reviewed claims, not independently validated credentials or skills.
Candidate 360 shows the retained LinkedIn evidence after saving. Full raw
JSON and session credentials are not persisted.

The downloadable ZIP contains only the Python extractor, its shared DOM
extractor, and this README. Production builds verify its SHA-256 manifest
against source files. After editing the tool or this README, regenerate it:

```powershell
python tools/package_linkedin_extractor.py
```

## Verification status

The automated suite uses fake browser objects and fictional profile sections.
It does not log into LinkedIn, launch Chromium, or transmit cookies.
There are 22 Python checks plus five DOM fixture checks:

Run fixture checks:

```powershell
python -m unittest discover -s tools -p test_linkedin_profile_extractor.py -v
node --test tools/test_linkedin_visible_profile.mjs
```

Coverage includes complete URL validation, redirects to another profile,
login/checkpoint and visible CAPTCHA detection, visible-name selection,
deduplication of nested/hidden section entries, paragraph preservation,
missing/failed section warnings, bounded output, cookie omission from output,
browser cleanup on success/error, and refusing to overwrite an output file.

### Authenticated browser check — 2026-10-09

At the user's request, the profile `https://www.linkedin.com/in/amit29533/`
was inspected using their authenticated in-app browser session. No session
cookie was read, exported, or passed to the standalone script.

The original selectors failed against this page: there was no `main h1`
and no legacy `section:has(div#experience)` markup. The revised read-only
DOM extractor (`tools/linkedin_visible_profile.js`) was evaluated against
the actual live page. It returned the profile name, professional headline,
company, location, one experience entry, two separate education entries,
and two separate certification entries. Additional education/certification
entries remained collapsed and were explicitly reported in warnings.
About and Skills were not observed; they are not inferred from activity posts.

The live check also caught and corrected grouping that initially combined
multiple education/certification entries. Regression fixtures cover the
actual wrapper pattern that caused this error.

Only the requested profile was examined. Output is saved locally under
`artifacts/linkedin-local/browser-extraction.json`, which is Git-ignored.
It is the DOM extractor's output, not proof of standalone cookie-login success.
No candidate was created, and no LinkedIn data was uploaded to the portal.

**Still unverified:** launching the standalone Python/Chromium tool with a
locally supplied `LI_AT` cookie, successful cookie authentication, and
compatibility with other profiles, languages, or LinkedIn layout variants.
The authenticated browser check does not establish these outcomes.

## Optional local run

Use a local virtual environment and install Playwright/Chromium using the
official package tools:

```powershell
python -m venv .venv-linkedin
.\.venv-linkedin\Scripts\python.exe -m pip install playwright
.\.venv-linkedin\Scripts\python.exe -m playwright install chromium
```

### Recommended: normal local sign-in (no cookie copying)

From the unzipped folder containing `tools`, run:

```powershell
.\.venv-linkedin\Scripts\python.exe tools/linkedin_profile_extractor.py `
  'https://www.linkedin.com/in/YOUR-TEST-HANDLE/' `
  --login --out profile.json
```

Sign in directly to LinkedIn in the opened Chromium window, then return to
the terminal and press Enter. Type `cancel` or press Ctrl+C to stop. The tool
then opens the requested profile and creates `profile.json`; choose that
file in the website's **LinkedIn JSON export** control. Use a new filename
for each run; existing output files are never overwritten.

The browser manages the login session automatically. The tool does not read,
export, or persist cookies, passwords, or browser storage. This temporary
browser session closes after success, cancellation, or failure. Sign in
again on your next run. `--login` ignores `LI_AT` and `JSESSIONID` environment
variables. This is local browser sign-in, not LinkedIn OAuth on the website.
Account verification is handled by you during normal sign-in; extraction
still stops at login/checkpoint/CAPTCHA gates or unexpected profile redirects.

The local sign-in flow has automated fixture coverage; successful live
LinkedIn login still requires a user-run check. Do not send credentials in chat.

### Optional: existing local session cookie

Keep the cookie in a local process environment. Do not put it in chat, Git,
Netlify, browser storage belonging to the portal, or an output JSON file.
On PowerShell 7, this avoids typing a literal cookie into shell history:

```powershell
$env:LI_AT = Read-Host 'LinkedIn session cookie (local only)' -MaskInput
try {
  New-Item -ItemType Directory -Force artifacts/linkedin-local | Out-Null
  .\.venv-linkedin\Scripts\python.exe tools/linkedin_profile_extractor.py `
    'https://www.linkedin.com/in/YOUR-TEST-HANDLE/' `
    --headful --out artifacts/linkedin-local/profile.json
} finally {
  Remove-Item Env:LI_AT -ErrorAction SilentlyContinue
  Remove-Item Env:JSESSIONID -ErrorAction SilentlyContinue
}
```

The tool makes one navigation and no automatic retries. It stops at login or
verification gates; it never solves or bypasses them. Only visible sections
are extracted. Collapsed details may remain incomplete and sections require
manual review. It cannot guarantee contact details or completeness.

On failure it returns a nonzero exit code. Successful JSON includes
`warnings`, `requires_review=true`, and a completeness limitation. It never
saves cookies or a reusable browser profile. It keeps line breaks in
`raw_text`, which can alternatively be pasted into the LinkedIn import form
along with the returned profile URL. Prefer the JSON file import to preserve
captured fields and section boundaries. Check all identity/field values before
creating a candidate.

Files under `artifacts/` and the local virtual environment are Git-ignored.
Output files are created exclusively (never overwrite an existing file).
POSIX output permissions are owner-only; Windows permissions follow the
chosen directory's ACL, so choose a private local folder.

LinkedIn does not support this session-cookie integration and prohibits
automated scraping under its platform rules. Account restrictions and markup
changes remain possible. See the official guidance:
https://www.linkedin.com/help/linkedin/answer/a1341543

No standalone live cookie or local sign-in test has been performed. The
website file import is deployed separately and has been tested with a
fictional candidate; it does not receive the LinkedIn login session.
