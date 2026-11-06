# Template Center Implementation Plan

> Execute in this session using focused parallel tasks and independent review.

**Goal:** Add a monochrome template center and four built-in Markdown templates, with persistent Q&A classification.

**Architecture:** Keep the three columns and show the independent template page in the existing main panel. Use one shared template registry and the existing createNote API with an optional templateId. Write initial Markdown directly to an exclusively created file; keep classification in existing config metadata, separate from the file extension and正文. Reuse CodeMirror, autosave, search, favorites and recent-note indexing.

**Tech Stack:** React, TypeScript, CodeMirror, lucide-react, Electron/Express FileStore, Vitest, Playwright. No additional dependencies.

## Decisions

- Prefer existing config metadata over frontmatter (avoids adding hidden text to notes) or proprietary files (incompatible with ordinary Markdown).
- Keep note.type as md/txt/markdown. Optional note.noteType uses NoteKind = markdown/qa/study/code; config.noteTypes maps relative paths to kinds.
- Registry src/lib/noteTemplates.ts provides templateId, name, description, icon, fileExtension, defaultTitle, initialContent, noteType. IDs: qa, study, code, blank.
- Template navigation lives after favorites. Middle column stays the full note list when browsing templates. Opening a note or successfully creating returns to the editor; errors keep the template page visible.
- Classification follows app-managed rename/delete/migration, clears on switching roots. Never infer Q&A from content.

## Task 1: Safe file creation and metadata

Files: src/types.ts, src/lib/noteTemplates.ts, server/store.ts, tests/templates.test.ts.

1. Add failing real-file tests covering template contents, collisions, restart, no false Q&A detection, invalid ids, metadata lifecycle and rollback.
2. Add shared registry/types; extend createNote(type, folder?, templateId?).
3. Resolve server-side template content, use exclusive create and write initial content once, persist classification and clean up only the newly created file on failure.
4. Update configuration loading, reads/cache, rename/delete remapping and root changes.
5. Run focused Vitest tests then existing file-store tests.

## Task 2: UI and unified workspace flow

Files: src/App.tsx, src/lib/useWorkspace.ts, src/components/TemplateCenter.tsx, src/components/templates.css, src/styles.css.

1. Add a failing browser test for navigation and four template creation flows.
2. Create the registry-driven page with plain separated rows, existing secondary buttons and monochrome icons.
3. Add templates view, preserve all columns, route successful note opening/creation back to editor, clear search as appropriate.
4. Pass optional templateId through existing transition/save/create flow. Keep type when saving Q&A copies.
5. Render Q&A/MD/TXT type labels at 12px with no background; template nav uses 14px text/16px icon.

## Task 3: Runtime and regression verification

Files: tests/templates.spec.ts, docs/template-center-verification.md, README.md.

1. Run browser with isolated XNOTE_HOME, create all templates and inspect actual disk files.
2. Edit rich Markdown in Q&A, preview headings/table/code/image, rename, reload/reopen, verify favorites/search/recent and regular MD/TXT.
3. Verify collision and failure UI plus rapid-click safety; capture wide/narrow template-page screenshots.
4. Run npm test, npm run typecheck, npm run build, full npm run test:e2e and native Electron smoke coverage.
5. Independent code review, fix actionable issues, record exact results and limitations.
