# xnote Neutral UI Refinement

**Goal:** Keep the three-column Typora-like shell and unify brand, interface typography and UI states into a neutral macOS-style palette.

**Design:** Replace the padded colorful sidebar favicon with the existing Lucide Notebook outline at 22px; pair it with 16px/600 brand text and an 8px gap. This is the deliberate brand-only exception to 12/14/16px functional icons. Set navigation, folders, note titles, search and regular settings controls to 14px, secondary information and toolbar text to 12px. Keep the document font options intact.

**Implementation:** Define canonical role-based gray color, font, icon and interaction tokens in theme.css, retain aliases for existing component contracts, and update the actual selectors that override those tokens. Remove hardcoded chromatic status, danger-button and search-highlight colors and filled favorite icons. Keep Markdown content link and semantic highlighting tokens separate from UI active colors. Preserve existing light/dark support and all event handlers.

**Verification:** Run existing 53 unit/file tests, TypeScript/production build and 16 browser E2E tests with isolated real files. Update the existing icon-size assertion to explicitly exclude the 22px brand mark. Extend native Electron visual verification with checks for brand geometry, 14px navigation/search/settings, UI grayscale on chrome/menus/settings/dialogs, matching selected states, content link preservation, narrow/wide layout and screenshots. Verify business module hashes against the pre-edit snapshot. No new dependencies or storage changes.
