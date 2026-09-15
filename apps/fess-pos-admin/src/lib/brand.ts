// FESS brand values for code that needs raw colours or sizes (phone preview, SVG maps). Read from the single source,
// schema/design/tokens.json (extracted from the FESS app). CSS uses the mirrored variables in app/globals.css instead.
import tokens from '../../../../schema/design/tokens.json';

const c = tokens.color;
const k = tokens.component;

const isNode = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null;

/**
 * A component token's value. Component tokens name base tokens by path ("color.text.body", "radius.card"); anything
 * else is a literal. An unknown path is a broken tokens.json, so it fails loudly rather than drawing a wrong colour.
 */
function resolve(v: string | number): string | number {
  if (typeof v === 'number' || !/^(color|radius|shadow)\./.test(v)) return v;
  let node: unknown = tokens;
  for (const part of v.split('.')) node = isNode(node) ? node[part] : undefined;
  const value = isNode(node) ? node.value : undefined;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Unknown design token “${v}” in schema/design/tokens.json`);
  return value;
}
const color = (v: string): string => String(resolve(v));
const size = (v: string | number): number => Number(resolve(v));

const phoneType = tokens.type.phone;

export const FESS = {
  primary: c.brand.primary.value,
  primaryDark: c.brand.primaryDark.value,
  primaryLight: c.brand.primaryLight.value,
  gold: c.brand.gold.value,
  goldText: c.brand.goldText.value,
  /** Gold text on a gold tint (status chips, D-97). */
  goldTextStrong: c.brand.goldTextStrong.value,
  text: c.text.primary.value,
  textBody: c.text.body.value,
  textMuted: c.text.muted.value,
  textOnPrimary: c.text.onPrimary.value,
  bgPage: c.background.page.value,
  bgHome: c.background.home.value,
  bgSubtle: c.background.subtle.value,
  divider: c.line.divider.value,
  border: c.line.border.value,
  success: c.status.success.value,
  successText: c.status.successText.value,
  warning: c.status.warning.value,
  warningText: c.status.warningText.value,
  error: c.status.error.value,
  errorText: c.status.errorText.value,
  info: c.status.info.value,
  infoText: c.status.infoText.value,
  navInactive: c.nav.inactive.value,
  fontFamily: `var(--font-montserrat), ${tokens.font.fallback.join(', ')}`,
  radius: {
    control: tokens.radius.control.value,
    input: tokens.radius.input.value,
    card: tokens.radius.card.value,
    pill: tokens.radius.pill.value,
  },
  /** Kept for consumers that haven't moved to the flat look yet (D-97): the phone preview draws no shadows. */
  shadowCard: tokens.shadow.card.value,
  /** Phone type scale (type.phone): size and weight per role. */
  type: {
    headline: { size: phoneType.headline.size, weight: phoneType.headline.weight },
    titleLarge: { size: phoneType.titleLarge.size, weight: phoneType.titleLarge.weight },
    title: { size: phoneType.title.size, weight: phoneType.title.weight },
    body: { size: phoneType.body.size, weight: phoneType.body.weight },
    bodyRegular: { size: phoneType.bodyRegular.size, weight: phoneType.bodyRegular.weight },
    caption: { size: phoneType.caption.size, weight: phoneType.caption.weight },
    button: { size: phoneType.button.size, weight: phoneType.button.weight },
  },
  page: { background: color(k.page.background), paddingX: k.page.paddingX },
  header: {
    height: k.header.height,
    paddingX: k.header.paddingX,
    backSize: k.header.back.size,
    background: color(k.header.background),
    title: { size: k.header.title.size, weight: k.header.title.weight, color: color(k.header.title.color), align: k.header.title.align },
    back: {
      size: k.header.back.size,
      iconSize: k.header.back.iconSize,
      color: color(k.header.back.color),
      style: k.header.back.style,
      borderWidth: k.header.back.borderWidth,
    },
  },
  buttonHeight: k.button.height,
  button: {
    height: k.button.height,
    radius: size(k.button.radius),
    iconSize: k.button.iconSize,
    textSize: k.button.text.size,
    textWeight: k.button.text.weight,
    primary: { text: color(k.button.primary.text) },
    outline: {
      background: color(k.button.outline.background),
      border: color(k.button.outline.border),
      borderWidth: k.button.outline.borderWidth,
      text: color(k.button.outline.text),
    },
    danger: { background: color(k.button.danger.background), text: color(k.button.danger.text) },
    disabled: { background: color(k.button.disabled.background), text: color(k.button.disabled.text) },
  },
  card: {
    radius: size(k.card.radius),
    innerRadius: k.card.innerRadius,
    background: color(k.card.background),
    border: color(k.card.border),
    borderWidth: k.card.borderWidth,
    elevation: k.card.elevation,
  },
  listRowHeight: k.listRow.height,
  listRow: {
    height: k.listRow.height,
    iconColumn: k.listRow.iconColumn,
    iconSize: k.listRow.iconSize,
    icon: color(k.listRow.icon),
    paddingY: k.listRow.paddingY,
    title: { size: k.listRow.title.size, weight: k.listRow.title.weight, color: color(k.listRow.title.color) },
    description: { size: k.listRow.description.size, weight: k.listRow.description.weight, color: color(k.listRow.description.color) },
    chevron: color(k.listRow.chevron),
    chevronSize: k.listRow.chevronSize,
    divider: color(k.listRow.divider),
  },
  input: {
    radius: size(k.input.radius),
    text: color(k.input.text),
    border: color(k.input.border),
    focus: color(k.input.focus),
    background: color(k.input.background),
    borderWidth: k.input.borderWidth,
    hint: color(k.input.hint),
    icon: color(k.input.icon),
    iconSize: k.input.iconSize,
    paddingX: k.input.paddingX,
    paddingY: k.input.paddingY,
  },
  chip: {
    radius: size(k.chip.radius),
    tintOpacity: k.chip.tintOpacity,
    paddingX: k.chip.paddingX,
    paddingY: k.chip.paddingY,
    textSize: k.chip.text.size,
    textWeight: k.chip.text.weight,
  },
  stat: {
    number: { size: k.stat.number.size, weight: k.stat.number.weight, color: color(k.stat.number.color) },
    label: { size: k.stat.label.size, weight: k.stat.label.weight, color: color(k.stat.label.color) },
  },
  avatar: { background: color(k.avatar.background), foreground: color(k.avatar.foreground) },
  bottomNav: {
    background: color(k.bottomNav.background),
    active: color(k.bottomNav.active),
    inactive: color(k.bottomNav.inactive),
    /** Inactive icons and labels: body grey, readable where FESS's #D8D8D8 isn't. */
    inactiveItem: color(k.bottomNav.inactiveItem),
    border: color(k.bottomNav.border),
    labelSize: k.bottomNav.label.size,
    labelWeight: k.bottomNav.label.weight,
  },
} as const;

/**
 * `colour` as a light tint over the page white, as the module's chips and notices draw it (component.chip.tintOpacity).
 * `colour` may be a CSS variable, e.g. `var(--pp)`.
 */
export function fessTint(colour: string, opacity: number = FESS.chip.tintOpacity): string {
  return `color-mix(in srgb, ${colour} ${Math.round(opacity * 1000) / 10}%, ${FESS.page.background})`;
}
