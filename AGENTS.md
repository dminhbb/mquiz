# Repository interface requirements

For every task that adds or modifies user interface code:

1. Read `.interface-design/system.md` completely before implementation.
2. Reuse the semantic tokens in `frontend/assets/design-system.css`.
3. Keep the existing vanilla HTML/CSS/JavaScript stack unless the user explicitly approves a migration.
4. Do not introduce inline presentation styles or literal colors in templates. Dynamic CSS custom properties are allowed.
5. Include keyboard focus, loading, empty, error, disabled and responsive states appropriate to the feature.
6. Run `npm run design:check` before completion.

The system applies to both `frontend/` and `cloud-admin/`.

