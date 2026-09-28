/**
 * Warm dark/light palette for the Harness Web UI, modelled on Claude's desktop
 * theme.
 *
 * How it works: the Client theme service (`@deepseek-ai/dsh-client-ui-theme`)
 * provides `ctx.theme.overrideTokens(source, tokens)`. The call stacks a token
 * override layer on top of whichever built-in palette is active, and the
 * ui-layout presenter writes every token of the composed snapshot onto
 * `document.body.style`. The layer is therefore live for both palettes and is
 * removed again when this plugin unloads.
 *
 * Coverage: every surface token the product actually paints with, except the
 * deliberate skips listed at the bottom. A body-level override only reaches
 * consumers that read a token through inheritance, so this layer cannot touch a
 * token a component redeclares on its own element, and it must not invent values
 * for tokens the product references but never defines.
 *
 * Where the values come from: the dark surfaces and inks below are measured off
 * a Claude desktop screenshot (dominant-color census plus run-length scanlines,
 * see the README table). Claude's warmth sits in the ink, not in the surfaces:
 * its greys are neutral (r-b = 0) while its text is warm (#f0efec primary,
 * #c3c2b7 secondary). The light scheme is the same family inverted onto an ivory
 * canvas; it is adapted from the dark measurements, not measured itself.
 *
 * No font-family override: a glyph comparison against the same screenshot shows
 * Claude rendering in Segoe UI letterforms on Windows, which is already the
 * first available entry of the stock DSH stack. See the README before forcing a
 * family here — pinning Windows fonts would degrade macOS clients.
 *
 * Every token needs one value per color scheme: a single value would stay
 * illegible in the other scheme, and the theme service rejects a bare string for
 * that reason. Relations to keep when editing: `--dsw-alias-bg-layer-3` and
 * `--dsw-alias-bg-overlay` double as ink on inverted fills; the side column
 * states stay one step away from the side column fill in the direction the
 * scheme already uses; alpha tints keep their stock alpha and only change hue.
 */

const SOURCE = '@local/dsh-bg-theme'

const PALETTE = {
  // Canvas and raised surfaces. Dark ladder measured: #151515 canvas, #212121
  // card, #2d2d2d chips, #383838 tiles. Light follows Claude's ivory family.
  '--dsw-alias-bg-base': { light: '#f0eee6', dark: '#151515' },
  '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#212121' },
  '--dsw-alias-bg-layer-2': { light: '#faf9f5', dark: '#2d2d2d' },
  // Also used as ink on inverted fills: stays white / dark in both schemes.
  '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#383838' },
  '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#2d2d2d' },
  '--dsw-alias-bg-document-preview': { light: '#ffffff', dark: '#1b1b1a' },

  // Side column (measured #111111 in dark, i.e. a step below the canvas) and the
  // three states drawn inside it: light goes a step darker than the column, dark
  // a step lighter.
  '--dsw-specific-sidebar-fill': { light: '#e9e6dc', dark: '#111111' },
  '--dsw-specific-sidebar-nav-item-hover': { light: '#e4e1d6', dark: '#1c1c1c' },
  '--dsw-specific-sidebar-nav-item-active': { light: '#ded9cc', dark: '#242424' },
  '--dsw-specific-sidebar-nav-item-active-accent': { light: '#e6dccf', dark: '#2e2d2b' },

  // Cards, selectors, tooltips and multi-select fills inside those surfaces.
  '--dsw-alias-bg-module-platform': { light: '#f5f3ed', dark: '#212121' },
  '--dsw-alias-bg-multi-select': { light: '#f5f3ed', dark: '#2d2d2d' },
  '--dsw-specific-selector': { light: '#f5f3ed', dark: '#2d2d2d' },
  '--dsw-specific-tip': { light: '#f5f3ed', dark: '#343434' },

  // Composer input (measured #20201f) and user message bubbles.
  '--dsw-specific-input-major': { light: '#ffffff', dark: '#20201f' },
  '--dsw-specific-bubble': { light: '#eeeae0', dark: '#232322' },
  '--dsw-specific-bubble-highlight': { light: '#ded8c9', dark: '#33332f' },

  // Ink. Dark primary and secondary are measured; the rest keep the same ladder.
  '--dsw-alias-label-primary': { light: '#1f1e1b', dark: '#f0efec' },
  '--dsw-alias-label-secondary': { light: '#6b6a63', dark: '#c3c2b7' },
  '--dsw-alias-label-tertiary': { light: '#8a887f', dark: '#a8a69b' },
  '--dsw-alias-label-caption': { light: '#b0aea4', dark: '#7d7b73' },
  '--dsw-alias-label-primary-dimmed': { light: '#2a2925', dark: '#e6e3db' },
  '--dsw-alias-label-dimmed': { light: '#e4e1d8', dark: '#3d3c38' },
  '--dsw-alias-label-document-preview': { light: '#6b6a63', dark: '#c3c2b7' },
  // Ink drawn on primary fills, so it moves with them. `brand-primary-invert`
  // carries the same pair as `brand-primary` in the stock sheet, so it keeps
  // that equality here instead of inverting anything.
  '--dsw-alias-label-primary-foreground': { light: '#ffffff', dark: '#1f1e1b' },
  '--dsw-alias-brand-primary': { light: '#1f1e1b', dark: '#f0efec' },
  '--dsw-alias-brand-primary-invert': { light: '#1f1e1b', dark: '#f0efec' },

  // Hover/press tints. These are alpha colours over whatever surface is below,
  // so the alpha stays stock and only the hue warms; `interactive-bg-hover` is
  // the most painted background in the product (~146 rules).
  '--dsw-alias-interactive-bg-hover': { light: '#2b271f0f', dark: '#f5f0e614' },
  '--dsw-alias-interactive-bg-active': { light: '#2b271f1a', dark: '#f5f0e624' },
  '--dsw-alias-interactive-bg-hover-accent': { light: '#2b271f24', dark: '#f5f0e63d' },
  '--dsw-alias-interactive-bg-hover-solid': { light: '#eae7dd', dark: '#383838' },

  // Control fills. The raised one is the side column's new-session button, whose
  // stock #43454a is what read as "not unified"; Claude's own button measures
  // #343434.
  '--dsw-alias-button-elevated-fill': { light: '#ffffff', dark: '#343434' },
  '--dsw-alias-button-floating-fill': { light: '#ffffff', dark: '#2d2d2d' },
  '--dsw-alias-button-floating-hover': { light: '#eae7dd', dark: '#383838' },
  '--dsw-alias-button-ghost-active-fill': { light: '#e4e1d8', dark: '#383838' },
  '--dsw-alias-button-ghost-active-hover': { light: '#ded9cc', dark: '#45443f' },
  '--dsw-alias-button-ghost-active-border': { light: '#8a887f', dark: '#8a877c' },
  '--dsw-alias-button-primary-dimmed': { light: '#e4e1d8', dark: '#383838' },
  '--dsw-alias-button-primary-fill': { light: '#1f1e1b', dark: '#f0efec' },
  '--dsw-alias-button-primary-hover': { light: '#3a3934', dark: '#e6e3db' },
  '--dsw-alias-button-contrast-fill': { light: '#6b6a63', dark: '#f0efec' },
  // Tool-bar fills are translucent over the canvas in both schemes.
  '--dsw-alias-button-tool-bar-fill': { light: '#4a4a4780', dark: '#4a4a4780' },
  '--dsw-alias-button-tool-bar-hover': { light: '#4a4a4799', dark: '#4a4a4799' },
  '--dsw-alias-button-tool-bar-fill-invisible': { light: '#1f1e1b5c', dark: '#1f1e1b5c' },

  // Floating and inline surfaces: a dark tooltip/toast in both schemes, plus the
  // markdown inline-code and tag fills that sit on the canvas.
  '--dsw-alias-tooltip-bg': { light: '#2f2e2a', dark: '#45443f' },
  '--dsw-alias-toast-bg': { light: '#383733', dark: '#45443f' },
  '--dsw-alias-markdown-inline-code': { light: '#f5f3ed', dark: '#262523' },
  '--dsw-alias-markdown-tag': { light: '#eae7dd', dark: '#2d2d2d' },

  // Translucent menu/popover material. The alpha stays stock (58% light, 45%
  // dark) so the backdrop blur and the see-through quality are unchanged; only
  // the hue warms. `--dsw-specific-menu` derives from this token on
  // Windows/Linux, so popovers follow it. macOS is the exception: an
  // `html[data-platform=darwin] body` rule replaces `--dsw-specific-menu` with
  // an opaque literal, so macOS menus stay cool — and overriding that token
  // there would change the platform's opacity, so this layer leaves it alone.
  '--dsw-menu-surface-fill': { light: '#f5f3ed94', dark: '#45443f73' },

  // Code blocks sit on the canvas and must follow it.
  '--dsw-alias-markdown-code-block': { light: '#f7f5ef', dark: '#1c1c1b' },
  '--dsw-alias-markdown-code-block-banner': { light: '#eae7dd', dark: '#242423' },

  // Scrollbars.
  '--dsw-alias-scrollbar-bg-l1': { light: '#d6d1c4', dark: '#2a2a2a' },
  '--dsw-alias-scrollbar-bg-l2': { light: '#ccc6b7', dark: '#333333' },
  '--dsw-alias-scrollbar-hover-l1': { light: '#c2bbaa', dark: '#3f3f3d' },
  '--dsw-alias-scrollbar-hover-l2': { light: '#b6ae9c', dark: '#4a4a47' },

  // Deliberately NOT overridden:
  // - semantic colours: state-*, button-info-*, interactive-bg-hover-danger,
  //   code-diff-*, file-diff-*, brand-primary-new-color (they carry meaning, not
  //   surface identity);
  // - `--dsw-specific-menu`: derived from the menu fill on Windows/Linux and
  //   replaced by an opaque macOS literal; see the menu note above;
  // - masks and skeletons: dsw-alias-bg-mask-* / bg-skeleton (scrims and
  //   placeholders, already scheme-neutral alpha);
  // - onboarding card fills: they only appear on the welcome surface;
  // - dsw-hovercard-bg: hardcoded inside a component rule (#2C2C2E), out of
  //   reach of a body-level layer;
  // - tokens the product references but never defines (dsw-alias-bg-layer-4,
  //   fill-l1/l2/tertiary/tsp-secondary, bg-l1/l2): inventing values would
  //   change elements that are transparent today.
}

/**
 * Validate the literal palette and copy it into the `{ light, dark }` shape the
 * theme service accepts. Fails loudly instead of silently dropping a scheme:
 * an override layer missing half a pair would paint one palette wrongly.
 */
function tokenPairs() {
  const pairs = {}
  for (const [name, modes] of Object.entries(PALETTE)) {
    if (typeof modes?.light !== 'string' || typeof modes.dark !== 'string') {
      throw new TypeError(`${SOURCE}: "${name}" needs a string value for both light and dark`)
    }
    pairs[name] = { light: modes.light, dark: modes.dark }
  }
  return pairs
}

window.__ModuleLoader__.load({
  id: SOURCE,
  factory() {
    return {
      // The overlay needs the live theme service; activation waits for it.
      inject: ['theme'],
      apply(ctx) {
        // overrideTokens returns the disposer for exactly this layer.
        ctx.effect(
          () => ctx.theme.overrideTokens(SOURCE, tokenPairs()),
          'bg-theme: surface token override layer',
        )
      },
    }
  },
})
