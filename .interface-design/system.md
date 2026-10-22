# mquiz interface system

This file is the visual source of truth for every new or modified interface in this repository, aligned with `design_system.md` (**High Contrast & Professional**).

## Direction

**Focused assessment workspace** — high-contrast, clean, and structured like a modern corporate & academic testing platform. Dark Navy (`#1E293B`) navigation frames crisp white (`#FFFFFF`) data cards on a calm slate canvas (`#F8FAFC`), with Vivid Cyan (`#0EA5E9`) for active and focus states.

Domain cues: answer strip, countdown timer, top-accent metric cards, question bank, class group, rank and review.

The product signature includes the **answer strip** and **top-bar metric cards** that communicate status, progress, and hierarchy at a glance.

## Foundations

- Typeface: `Inter`, `Roboto`, or standard system sans-serif.
- Type scale:
  - H1 (Page Title): 24px–28px, Bold/ExtraBold, Dark Navy (`#1E293B`).
  - H2 (Card/Section Title): 16px–20px, Semi-Bold/Bold, `#1E293B`.
  - Body Text: 14px, Regular/Medium, `#334155`.
  - Small/Caption: 12px, Regular/Medium, Muted (`#64748B`).
- Dynamic numbers: always use `font-variant-numeric: tabular-nums`.
- Spacing base: 4px. Prefer 8, 12, 16, 20, 24, 32px. Standard grid gap is `16px` or `24px`.
- Density: student controls use 44px hit areas and 20–24px panels; admin controls use at least 40px and 16–20px panels.
- Radius: 6px buttons/inputs, 8px cards/panels, 12px modals/dialogs.
- Depth: `1px solid #E2E8F0` borders with subtle shadow (`0 1px 2px rgba(15, 23, 42, 0.05)`). Prominent shadows are reserved for floating modals (`--shadow-float`).
- Motion: 100–220ms, custom ease-out (`--ease-out`), and only `transform`/`opacity` for movement. Respect `prefers-reduced-motion`.

## Palette

All UI colors must come from `frontend/assets/design-system.css`:

- `--navy-primary` (`#1E293B`): Sidebar background, Primary Button background, H1 heading.
- `--navy-hover` (`#0F172A`): Primary Button hover, Sidebar user profile surface.
- `--cyan-accent` (`#0EA5E9`): Active menu item, input focus border, radio/checkbox active, links.
- `--bg-app` (`#F8FAFC`): Main content canvas.
- `--bg-surface` (`#FFFFFF`): Cards, panels, tables, modals, form inputs.
- `--border-light` (`#E2E8F0`): Card, panel, and table borders.
- `--border-input` (`#CBD5E1`): Input, select, textarea, and outline button borders.
- `--semantic-warning` (`#EA580C`) / `--semantic-warning-bg` (`#FFF7ED`): Warning highlights and alerts.
- `--semantic-success` (`#16A34A`) / `--semantic-success-bg` (`#F0FDF4`): Published badges and correct states.
- `--semantic-danger` (`#DC2626`) / `--semantic-danger-strong` (`#991B1B`): Destructive actions, errors, and incorrect states.
- `--text-heading` (`#1E293B`), `--text-body` (`#334155`), `--text-muted` (`#64748B`).

## Component contracts

### Left Panel (Sidebar)

- Fixed width `240px–260px` on desktop, Dark Navy (`#1E293B`) background, white (`#FFFFFF`) and light slate (`#CBD5E1`) text.
- Brand mark uses a rounded blue square (`#1D63B8`) with bold white `m` next to `quiz`.
- Menu items use comfortable padding (`12px 16px`), `8px` radius; active state uses Vivid Cyan (`#0EA5E9`) with white text; hover uses `#334155`.
- User/Student profile card at the bottom uses `#0F172A` background with subtle border `rgba(255, 255, 255, 0.16)` and `10px` radius.

### Metric Cards

- White or semantic-tinted surface with `8px–10px` radius, `1px solid` border, and a distinct `6px` top accent bar (`--metric-1-bar` amber, `--metric-2-bar` cyan, `--metric-3-bar` slate, `--metric-4-bar` orange warning).

### Button

- Primary: Dark Navy (`#1E293B`), white text, hover `#0F172A`, `6px` radius.
- Secondary: `#F1F5F9` background, `#334155` text, `1px solid #CBD5E1`.
- Outline/Icon: `#FFFFFF` or `#F8FAFC` background, `1px solid #CBD5E1` border, `#1E293B` icon/text.
- Destructive (Danger): `#991B1B` / `#DC2626` solid red with white icon/text for delete actions, or red outline for secondary danger actions.

### Field

- 42–44px minimum height, `#FFFFFF` background, `1px solid #CBD5E1` border, `6px` radius, persistent visible label.
- Focus state uses `#0EA5E9` border and `0 0 0 2px rgba(14, 165, 233, 0.22)` ring.
- Radio and checkbox controls use `#0EA5E9` when checked.

### Overlays (Popup & Toast)

- Native `<dialog>` or modal backdrop with `rgba(15, 23, 42, 0.5)`.
- Modal box: `#FFFFFF` background, `12px` radius, `24px` padding, close `×` button at top-right.
- Space management dialog uses `min(94vw, 1480px)` by `min(92dvh, 960px)` with one continuous content scroller (`.space-settings-main`).

## Accessibility and responsive acceptance

- Keyboard-visible focus is mandatory.
- Interactive hit area is at least 40px; primary student controls target 44px.
- Use semantic regions, headings, labels, `aria-live` for asynchronous feedback and `aria-current` for navigation.
- Provide a skip link on every application shell.
- Test at 360px, 768px, 1280px and short laptop height (approximately 700px).
