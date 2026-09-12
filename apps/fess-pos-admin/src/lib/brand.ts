// FESS brand values for code that needs raw colours or sizes (phone preview, SVG maps). Read from the single source,
// schema/design/tokens.json (extracted from the FESS app). CSS uses the mirrored variables in app/globals.css instead.
import tokens from '../../../../schema/design/tokens.json';

const c = tokens.color;

export const FESS = {
  primary: c.brand.primary.value,
  primaryDark: c.brand.primaryDark.value,
  primaryLight: c.brand.primaryLight.value,
  gold: c.brand.gold.value,
  goldText: c.brand.goldText.value,
  text: c.text.primary.value,
  textBody: c.text.body.value,
  textMuted: c.text.muted.value,
  bgPage: c.background.page.value,
  bgHome: c.background.home.value,
  divider: c.line.divider.value,
  border: c.line.border.value,
  success: c.status.success.value,
  warning: c.status.warning.value,
  error: c.status.error.value,
  errorText: c.status.errorText.value,
  info: c.status.info.value,
  navInactive: c.nav.inactive.value,
  fontFamily: `var(--font-montserrat), ${tokens.font.fallback.join(', ')}`,
  radius: {
    control: tokens.radius.control.value,
    input: tokens.radius.input.value,
    card: tokens.radius.card.value,
    pill: tokens.radius.pill.value,
  },
  shadowCard: tokens.shadow.card.value,
  header: { height: tokens.component.header.height, paddingX: tokens.component.header.paddingX, backSize: tokens.component.header.back.size },
  buttonHeight: tokens.component.button.height,
  listRowHeight: tokens.component.listRow.height,
} as const;
