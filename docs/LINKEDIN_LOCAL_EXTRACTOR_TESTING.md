# Local LinkedIn extractor experiment

The user-supplied Python script has been revised in
`tools/linkedin_profile_extractor.py`. It runs locally and connects to the
website through a reviewed JSON file import. It is not a Netlify browser
worker. No credentials are bundled or sent to the website.

## Website workflow

### Quick Windows command

In Candidates → Import candidates, open **LinkedIn profile**. In **Step 1 · Open
the helper**, enter the candidate's public LinkedIn URL or handle. Keep
**Remember LinkedIn login locally for up to 24 hours** checked, then click
**Copy extraction command**. Open Windows PowerShell,
paste the entire command and press Enter. Python 3.10 or newer must already
be installed; the command handles the remaining first-time setup.

The command downloads the reviewed ZIP from the production portal, verifies
its embedded SHA-256 checksum before unpacking, creates a local virtual
environment, installs Playwright 1.63.0 from PyPI, prefers installed Edge or Chrome,
and starts the interactive `--session` helper. Chromium is downloaded only when
neither supported installed browser is found. Later runs reuse the runtime and
browser. Windows PowerShell 5.1 and PowerShell 7 are supported; setup errors
print the failed stage in plain text. The package is checked and unpacked again before each execution.
It does not require admin access, an extension or execution-policy changes.

Sign in to LinkedIn in the opened dedicated browser and press Enter in
PowerShell. An existing login in another browser is not reused. After a
successful extraction, the new JSON is copied to your clipboard. Return to
the portal, open **Step 2 · Bring back the result**, and click **Paste extracted
profile**. Step 3 opens for review and saving. This
clipboard read happens only on that explicit button click, and does not save
a candidate automatically. Contact details still need manual entry.

The command leaves the result file under `%LOCALAPPDATA%\AnthroPrime\LinkedIn`
with a unique name. If clipboard access fails, choose that file using the
existing **LinkedIn JSON export** control. No cookie or password enters the
clipboard or the portal. Clipboard managers/history may retain the profile
JSON; clear it after importing if needed.

Keep the helper window open. For the next candidate, use **Copy profile URL
for open helper** under **Helper already open? Import another profile**, paste
into its prompt and press Enter. No setup command or
fresh sign-in is needed for each profile. Type `retry` to retry the current
profile, `refresh` to remove its local login and sign in again, `revoke` to
remove its local login and close, or `quit` to close while retaining login for
the remaining reuse window. **Manage login and setup** contains the refresh
and forget controls. The portal's **Copy forget-login command** works
after the helper has closed; it does not visit a profile. Forgetting locally
does not revoke other LinkedIn browser sessions or delete saved profile JSON.

Only a dedicated browser profile under `remembered-session/browser-profile`
is retained; the tool never reads or exports its cookies. The session directory
is private to the current Windows user. Its fixed expiry is 24 hours after
sign-in confirmation, not extended on each import. Before each import and
on restart, expiry (including clock rollback) prevents reuse and removes the
old profile before fresh sign-in. Expired files can remain on disk while the
helper is closed or idle; it does not globally log the LinkedIn account out
at a particular time. LinkedIn may require verification or login sooner.
One helper at a time may use this directory. Uncheck remembered mode to use
the existing single-profile temporary login without retaining it.

Cloud command generation fetches the latest release manifest with `no-store`
and prints the release fingerprint, so an old open portal can use the current
ZIP. Refresh once after upgrading from a portal without this capability.

If a portal deployment changes the ZIP while an old command is open, the
checksum check refuses to execute it. Refresh the portal and copy a fresh
command. A failed extraction never copies a new result. No browser challenge
is solved automatically.

The extractor captures the intro before scrolling and merges visible section
rows during a bounded 12-step rendering pass. It supports semantic section
headings and outer list rows as well as the observed component-key layout.
Scrolling focuses the profile's main content so nested scroll containers load
their sections even when the mouse is over the navigation bar. Connection
degrees are excluded from intro fields, and SDUI skill rows are read separately.
Hidden rows and unrelated sidebar content are excluded. Collapsed entries
still require manual review; the tool does not guarantee a complete profile.
If no professional sections are captured, the terminal prints an explicit
warning. Existing exports are snapshots: refresh the portal, copy a new command
and extract again to use parser fixes. Reimporting an old JSON cannot recover
content that was never captured.

An already running helper keeps its loaded parser. After an extractor release,
type `quit`, refresh the portal and copy a fresh extraction command once.
Restarting reuses the dedicated login if its 24-hour window is still valid.

After Enter, the terminal immediately prints `Sign-in confirmed; loading the
requested profile`, then header, scroll and section progress. Output is
unbuffered. Navigation and header waits have individual timeouts; the rendering
and legacy section reads share a 25-second budget. Failures identify the stage
without exposing browser diagnostics or credentials.

If Enter appears to do nothing, press Esc in PowerShell to leave text-selection
mode, then press Enter there again. If it still stays at the sign-in prompt,
use Ctrl+C to cancel and retry with a fresh command. Do not paste a previously
copied profile result after a failed extraction. Sign-in must be completed in
the temporary browser opened by the command, not a different browser window.

Header loading uses the same semantic profile parser as extraction. Besides
`h1` and the observed verification header, it accepts a level-one ARIA heading
or a single visible intro heading scoped by the Contact info control. Arbitrary
experience or recommendation headings are not used as candidate names. If the
name remains unrecognized, the error recommends pasted profile text rather
than implying that sign-in necessarily failed.

### Manual download fallback

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
There are 23 Python checks plus five DOM fixture checks:

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
