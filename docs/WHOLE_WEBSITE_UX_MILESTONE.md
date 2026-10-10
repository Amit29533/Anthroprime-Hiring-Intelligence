# Whole website UX milestone

The shared interface now covers the recruiter workspace and the careers, candidate and client portals. No database migration or additional service is needed.

## Navigation and everyday work

- Five core destinations remain visible: Overview, Candidates, Demands, Clients and Pipeline.
- Daily work groups Interviews and Activities; Talent development groups Pools, Assessments and Referrals; Insights groups Analytics and Reports. The active destination's group opens automatically.
- Page headings use short names that match their destinations.
- Optional controls use named sections and SVG icons, with text retained for clarity.

## Progressive disclosure

- Both candidate repository modes keep search prominent. Extended filters, saved views, column choices, intelligence tools and exports open on demand.
- Both Candidate 360 modes show primary sections and a More sections control. The selected section stays visible and receives keyboard focus.
- Candidate and demand forms keep essential fields visible, grouping optional preferences, metadata, skill thresholds and pipeline configuration.
- Client collaboration and documents, interview history and calendar import/export tools, report filters and advanced analytics, referral insights and task creation open when requested.
- Workspace settings uses eight categories. Provider, processing, audit and operations consoles mount after selection. Policy controls are split into smaller sections.
- Public careers separates role applications from referrals and tracking. Candidate self-service separates applications from availability editing and privacy controls. Client feedback opens per approved candidate version.

## Shared visual system

`consistency.css` applies the existing theme tokens to all four entry points. Buttons, forms, tables, panels, focus indicators, mobile layouts and spacing use the same rules. Table scrolling stays inside its container. Save/cancel controls remain reachable in long dialogs. Motion respects both the system preference and the existing pause control.

`MoreOptions` supports Escape, outside-click dismissal and focus restoration. It uses disclosure semantics because its content can include selects and file inputs. `FormSection` retains mounted fields and reveals collapsed ancestors during native validation. `DisclosureSection` mounts expensive modules on first use and retains visited drafts until the workspace or role changes.

## Verification

Regression coverage includes navigation, role restrictions, candidate edits and exports, imports, demands, matching and pipeline actions, clients and documents, interviews and calendars, reports, referrals, candidate self-service, client feedback retries, workspace switching and delayed responses. Added tests cover optional-action dismissal, retained form drafts, required-field validation and profile-section discovery.

Browser checks cover every main workspace destination, candidate forms and profiles, careers tracking and candidate self-service, with mobile and dark-mode checks. Live provider writes and account/security configuration are outside this visual milestone.

Release verification on 10 October 2026: 406 UI tests passed across the full UI regression suite and the isolated bulk-workflow rerun. One full-run worker ran out of memory while an obsolete debug process was still consuming memory; its nine bulk tests passed after that process was stopped. The final paged overview change also passed its four focused cloud/paging tests. ESLint, the production build and the 100 KiB entry-bundle budget passed. All eleven secondary workspace destinations passed desktop and 390 px dark-mode layout checks without page-level horizontal overflow; overview, settings, forms and public portal flows were checked separately.

## Spacing, density and colour follow-up — 10 October 2026

- Header search and candidate filtering now keep separate values. Clicking the search container or icon focuses the input; its focus ring covers the whole control. Clearing a local search keeps focus and does not submit a surrounding form.
- Shared panel padding, disclosure gaps, pagination, action rows, form controls and page headings use a consistent scale. Report cards wrap long names and keep actions in their own row. Demand titles use plain text buttons and skills no longer stretch into tall blocks.
- Worklist totals and approved client demand progress use accessible tables. Analytics funnel and source summaries use compact labelled metrics; long explanations open on demand. Analytics cards retain padding and fit evenly across the available width.
- Skill badges pair readable labels with familiar SVG technology cues throughout repository modes, profiles, demands, skills, analytics and public portals. These are visual cues, not official brand logos.
- Dark mode uses navy surfaces with distinct violet, blue, teal, amber, orange and rose accents. Light-mode cyan/orange badge colours and public careers action labels received contrast corrections.

Verification: the full UI run passed 407 tests; the new independent-search regression and affected search/workflow suites passed in a subsequent 73-test run. Together these cover 408 unique UI tests. The latest portal, client collaboration, careers and worklist changes passed another focused 19-test run. Final ESLint, production build and entry-bundle budget passed. Browser checks covered all twelve workspace destinations at 1280 px and 390 px in both light and dark themes without page-level overflow, candidate forms, search focus/value isolation, all eight settings categories, careers and candidate self-service. The local client portal entry requires cloud configuration; its authenticated views are covered by automated fixtures. Live provider writes were not exercised.
