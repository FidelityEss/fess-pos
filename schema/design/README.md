# Design tokens — FESS brand

`tokens.json` is the single source of the FESS look for everything POS draws. It was extracted from the FESS mobile
app (ess-flutter, a read-only reference) on 2026-09-12. See `tokens.json` → `source` for the exact files.

| Consumer | How it uses the tokens |
|----------|------------------------|
| POS module (Flutter, `packages/fess_pos`) | Builds its own **scoped** `PosTheme` (ThemeData + text theme) from these values. It never reads the host's theme objects (FESS uses FlutterFlow's `FlutterFlowTheme`, not `ThemeData`), and the host can override only the `theme.*` remote-config keys. |
| Phone preview (`apps/fess-pos-admin/src/components/preview`) | Imports `tokens.json` directly: header, status bar, buttons, cards, list rows, bottom nav, Montserrat. |
| Admin panel (`apps/fess-pos-admin/src/app/globals.css`) | Mirrors the brand colours and radii as CSS variables, and adds its own neutrals and hover shades because a data-dense desktop tool needs more greys than the phone. Its UI font is Inter, not Montserrat (a desktop web font; D-47). |

Rules:
- Values marked `"derived": true` are POS additions for accessibility (WCAG AA text contrast), for example gold or
  red **text** on white. The brand colours themselves are never changed.
- When FESS updates its brand, update this file in a reviewed change, then the admin CSS mirror. The preview and the
  module follow automatically.
- Remote config `theme.primary_color` / `theme.font_family` default to `null`, which means "use these tokens"
  (docs/13 §5, D-45).
- Keys are only ever added, never renamed or removed: the module and the admin read the same file.

**White and flat (D-97, 2026-09-15).** The module's look follows the FESS screens: white pages, no shadows, hairlines
and light borders. The keys added for it (`component.page`, `header.title.align`, `header.back.style` /
`borderWidth`, `button.outline` / `danger` / `disabled` / `iconSize`, `card.elevation` / `border` / `borderWidth`,
`listRow.icon*` / `paddingY` / `chevronSize` / title and description colours, `input.background` / `borderWidth` /
`hint` / `icon*` / `padding*`, `chip`, `stat`, `avatar`, `bottomNav.inactiveItem` / `border` / `label`, and the
derived `goldTextStrong`, `successText`, `warningText`, `infoText`) say how. `shadow.card` stays for any consumer that
still draws shadows; the module doesn't.
