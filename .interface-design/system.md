# mquiz interface system

This file is the visual source of truth for every new or modified interface in this repository.

## Direction

**Focused assessment workspace** — calm and exact like a well-prepared exam desk. Student views are spacious and reduce decision noise. Administrative views are denser, but use the same visual language and interaction rules.

Domain cues: exam paper, answer sheet, blue pen, countdown, marking, question bank, class group, rank and review.

The product signature is the **answer strip**: a compact sequence of question marks that communicates current, answered and remaining states. Reuse its square-mark language for progress, selected navigation and compact status displays.

## Foundations

- Typeface: `Be Vietnam Pro`; it supports Vietnamese well and feels precise without becoming clinical.
- Type scale: 12 / 14 / 16 / 20 / 28 / 40px. Use weight and color before inventing intermediate sizes.
- Dynamic numbers: always use tabular figures.
- Spacing base: 4px. Prefer 4, 8, 12, 16, 20, 24, 32 and 40px.
- Density: student controls use 44–48px hit areas and 20–24px panels; admin controls use at least 40px and 16–20px panels.
- Radius: 6px small controls, 10px cards, 14px dialogs. Nested radius must remain concentric.
- Depth: tonal surfaces and low-opacity hairline borders. Shadows are reserved for floating overlays and dialogs.
- Motion: 100–220ms, custom ease-out, and only `transform`/`opacity` for movement. Respect `prefers-reduced-motion`.

## Palette

All UI colors must come from `frontend/assets/design-system.css`.

- `--exam-paper`: application canvas, warm exam-paper tone.
- `--exam-sheet`: primary content surface.
- `--exam-inset`: input and recessed-control surface.
- `--exam-ink`: primary text.
- `--exam-ink-secondary`, `--exam-ink-tertiary`, `--exam-ink-disabled`: four-level text hierarchy.
- `--pen-blue`, `--pen-blue-strong`, `--pen-blue-wash`: the only product accent.
- `--mark-correct`, `--mark-wrong`, `--mark-warning`: semantic states only, never decoration.

Dark mode uses the same semantic names with lightness inverted. Do not introduce a second accent hue.

### Student comfort palette

- Student assessment screens scope their tokens to a pastel brown-gray palette: pale warm-gray canvas, near-white panels, slightly darker taupe fields, and muted clay-brown for the single primary action and selected state.
- Preserve the existing semantic green, red and amber states for correct, incorrect and warning feedback. Do not use brown alone to communicate an error or required state.
- This palette is intentionally scoped to `.shell`; administration retains its own shared-token presentation.

## Component contracts

### Button

- Default: 44px high, 6px radius, 14px/700.
- Primary is reserved for the single most important action in a region.
- Destructive red is only for irreversible actions; starting an exam is primary blue, not destructive red.
- Every variant requires default, hover, active, focus-visible and disabled states.

### Field

- 44px minimum height, inset background, quiet border, persistent visible label.
- Required state is conveyed in text/semantics, not color alone.
- Validation is inline and specific. Never use `window.alert()`.

### Panel

- Use a panel only when grouping changes comprehension.
- Prefer tonal separation and spacing; avoid border + white fill + large shadow together.
- Student panel padding: 20–24px. Admin panel padding: 16–20px.

### Navigation

- Navigation lives on the same canvas family as content.
- Current location must expose `aria-current="page"` and a visible state that does not rely on color alone.
- Mobile navigation must remain usable without horizontal page overflow.
- Role-restricted navigation is omitted from the DOM for unauthorized roles, and its view renderer must independently reject direct state or handler access.

### Data and asynchronous states

- Numbers use tabular figures.
- Every data region needs loading, empty and error states.
- Loading uses skeleton shapes matching the destination layout when practical.
- Empty states explain what is empty and the next useful action.
- Public Supabase queries must not filter on columns unavailable to the `anon` role. Soft-delete visibility is enforced by RLS; a failed cloud load must render its real error state and must never fall back to unrelated welcome content.

### Overlays

- Prefer native `<dialog>` when available.
- Custom overlays owe Escape handling, focus trap, initial focus, focus return and scroll containment.
- Dialogs use the floating surface token and are the only surfaces with a pronounced shadow.
- The Space management dialog uses `min(94vw, 1480px)` by `min(92dvh, 960px)` so dense wizard content remains workable on laptop screens.
- The Space management dialog has one continuous content scroller (`.space-settings-main`); its shell and navigation stay fixed inside the dialog and must not create percentage-height overflow or a covering blank surface.
- Management errors appear as dismissible overlay toasts, clear on navigation or dialog close, and auto-dismiss after 10 seconds.

### Management wizard

- Use a wizard when an admin task has a clear object-selection step followed by several consequential actions.
- Keep one decision per step: select the object, select the action, then complete the action.
- When choosing an object has no independent confirmation value, make the object row navigate directly to the next step; do not add a checkbox and redundant Continue button.
- Show a compact three-step progress strip using the answer-strip square-mark language.
- Keep confirmations inline in the wizard; do not stack dialogs or use browser alerts.
- A destructive action that removes both a container and its contents requires two confirmations, with exact-name entry on the final confirmation.
- A destructive action that clears contents but keeps the container requires one confirmation and must state what remains.
- Time-sensitive business locks must be enforced by the database and reflected in the UI. Disable the action, explain the active condition and provide a direct route to the configuration that controls it.
- After a mutation, return to the closest useful step and show an inline success status without closing the parent settings dialog.
- Destructive labels may say "Xóa" for user familiarity, but confirmations must disclose when the operation is a soft delete and explain why retained data remains available to historical Đề thi.
- Question CSV upload has no artificial 20-question cap. Always show the parsed valid-question count before import and keep the insert atomic.

### Real-exam management

- Real-exam names are always displayed with their permanent five-digit code in the form `Tên đợt thi · #12345`.
- Student routes are independent: `/slug` always offers Thi thử/Luyện tập, while `/exam/12345` is exclusively the matching Thi thật experience. Running real exams never replace or disable the Space practice route.
- Persisted attempts use `mode = 'mock'` for Thi thử and `mode = 'real'` for Thi thật. Luyện tập remains immediate-feedback only and is not persisted.
- Use server-side pagination with exactly 15 real exams per management-list page. Preserve search and status filters while paging.
- A real-exam list row navigates directly to its action view; do not add selection controls or a redundant Continue button.
- In user-facing copy, call a historical question-code snapshot **Đề thi**. The underlying immutable ID snapshot remains an implementation detail.
- Scheduled exams may expose metadata and timing, but question content is not presented until the exam is active.
- Editing an exam may replace its timing, sources and generation rules regardless of the current clock; it creates a numbered Đề thi revision while preserving the permanent exam code and aggregated results.
- Expose one Start/Stop switch in the detail header at all times. Stop is a reversible pause; Start is blocked only when the configured end time has passed.
- Before, during a pause, and after an exam, student notices lead with the Space name, then `#ID - Name`, followed by a plain-language availability message and the configured time window where relevant.
- Ended exams may be scheduled again with a new revision while retaining their permanent code. Copying creates an independent exam and a new code.
- Hiding an exam requires two inline confirmations; the final confirmation requires its exact five-digit code.
- Sharing uses a dedicated wizard view with a large read-only link, QR code, copy status and open-link action. Do not depend solely on the Clipboard API.

## Accessibility and responsive acceptance

- Keyboard-visible focus is mandatory.
- Interactive hit area is at least 40px; primary student controls target 44px.
- Use semantic regions, headings, labels, `aria-live` for asynchronous feedback and `aria-current` for navigation.
- Provide a skip link on every application shell.
- Test at 360px, 768px, 1280px and short laptop height (approximately 700px).
- Use `dvh` for viewport-height layouts.
- Headings use balanced wrapping; prose uses pretty wrapping and stays near 65 characters where possible.

## Required workflow for future UI changes

1. Read this file and `frontend/assets/design-system.css` before editing.
2. State the view's user, focal action and required states in the implementation notes or pull request.
3. Reuse semantic tokens and existing component classes before adding a variant.
4. Add loading, empty, error, focus, disabled and responsive behavior with the feature—not later.
5. Run `npm run design:check`, JavaScript syntax checks and visual checks at desktop/mobile widths.
6. Update this document only when a reusable decision genuinely changes.
