# AnthroPrime visual refresh

The recruiter workspace, sign-in screen, public careers page and candidate portal share `src/modern.css`. The existing AnthroPrime artwork is preserved. No candidate information, database schema, authorization rules or hosted settings were changed.

## Design

- Shared teal/navy palette, light and dark surfaces, typography, spacing, radii, shadows and focus indicators.
- Illustrated talent connections on the overview, sign-in and public page headers. These are decorative illustrations, not candidate records or performance metrics.
- Consistent tables, filters, tabs, forms, cards, modals, drawers and empty states.
- Subtle page entrances, floating illustrations, button press feedback and card/row hover states.
- A motion control beside the theme control, persisted between visits and synchronized between open pages. Operating-system reduced-motion preferences disable animation and transitions through CSS.
- Responsive navigation and global search, with horizontal scrolling confined to wide data tables and tabs.
- Locally rendered vector and CSS artwork; no image CDN, external font requests or new runtime dependencies.

## Verification

Existing UI regression selection: 48 tests passed. Three motion accessibility/persistence tests passed. Careers and portal tests were rerun after the branding change (9 passed).

All workspace sections were opened in the browser, with no document overflow or browser errors. Candidate tables, a candidate form, light/dark themes, 390px navigation, mobile search, sign-in and careers layouts were reviewed visually. Motion pause was checked against the rendered document.

Production build and bundle budget passed (main JavaScript approximately 63 KiB, budget 100 KiB). Lint passed. Formatting checks pass for changed files; the repository-wide formatting command still reports unrelated existing formatting issues.

This refresh is local until committed and deployed. The ignored `artifacts/ui-signin-preview.html` is a development-only visual preview and is not included in the production build.
