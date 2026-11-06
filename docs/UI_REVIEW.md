# Telearr Web UI — UX / Accessibility / Front-end Review (v2.1 overhaul)

A record of the first web UI, since replaced by the React app in `frontend/`. The files
it reviews no longer exist.

Reviewer: senior UX + front-end architect
Scope: `app/static/js/{main,core,views,icons}.js`, `app/static/app.css`,
`app/templates/{index,login}.html`. Buildless ES-module SPA.

The overhaul is in good shape: a clean hyperscript foundation, an XSS-safe DOM
builder, a coherent token-based design system, and a sensible module split. The
findings below are almost all incremental hardening — nothing is architecturally
broken. Severity is **High** (blocks a keyboard/AT user or loses data silently),
**Med** (degrades the experience for a real cohort), **Low** (polish).

## Findings

| # | Area | Severity | Issue | Recommendation |
|---|------|----------|-------|----------------|
| A1 | A11y · keyboard | **High** | Channel modal has **no focus trap and no Esc-to-close**. Tab escapes to the page behind the overlay; keyboard/AT users can get stuck. Only outside-click and the close button dismiss it. (`views.js` `openChannelModal`) | Add a `keydown` listener on the overlay/document that closes on `Escape` and removed in `close()`; trap Tab within `.modal-card` (focus first field on open — already done — and wrap focus at the ends). |
| A2 | A11y · focus | **High** | **No visible focus ring anywhere.** `app.css` styles `:hover` but never `:focus`/`:focus-visible`, and custom `.btn`/`.nav-item`/`.toggle`/`.tab` restyle native controls. Keyboard users cannot see where they are. | Add one global rule: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: inherit; }`. |
| A3 | A11y · keyboard | **High** | The completed-group header is a `<div onClick>` (`views.js` `completedGrouped`), so expand/collapse is **not keyboard-operable** and exposes no role/state to AT. | Make `.grp-head` a `<button>` (or add `role="button" tabindex="0"` + Enter/Space handler + `aria-expanded`). |
| A4 | A11y · labels | **High** | Icon-only buttons lack an accessible name. The **modal close button** (`views.js`) has no `title` and no `aria-label` at all → announced as "button". Others (theme toggle, row Delete/Edit/Remove, density) rely on `title`, which is a weak/flaky AT name. SVGs are correctly `aria-hidden`. | Add `"aria-label"` to every icon-only button; start with the modal close (`aria-label:"Close dialog"`) and `#theme-toggle` (`aria-label:"Toggle theme"`). |
| A5 | A11y · motion | **Med** | **No `prefers-reduced-motion` support.** Toast `@keyframes slidein`, `.bar > i` width transition (updates every 2.5s), `.toggle` and `.btn` transitions all animate unconditionally. | Add `@media (prefers-reduced-motion: reduce){ *,*::before,*::after{ animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important; } }`. |
| A6 | A11y · forms | **Med** | Settings rows render `<label>text</label>` and the `<input>` as **siblings with no `for`/`id` association** (`views.js` `viewSettings` `row()`); the inputs *do* have ids, so they are trivially linkable. Login inputs (`login.html`) and the downloads search have **placeholder-only** labelling. | Give the settings `<label>` a `for` matching the input id (or wrap the input). Add `aria-label` to login username/password inputs and to `#dl-search`. |
| A7 | A11y · selection | **Med** | The "select all" header checkbox and per-row checkboxes have **no `aria-label`** and the header never shows an **indeterminate** state for partial selection (`views.js` `rowsTable`). | `aria-label:"Select all"` on the header box, `aria-label:"Select row"` per row; set `el.indeterminate = someButNotAll` after render. |
| A8 | A11y · live region | **Med** | The Activity log `<pre id="logs">` is a plain, non-focusable element: no `role="log"`, no `aria-live`, and (since it scrolls) no `tabindex="0"` so keyboard users can't scroll it. Toasts likewise are not announced. | Add `role="log" aria-live="polite" tabindex="0" aria-label="Activity log"` to `#logs`; make the toast host an `aria-live="polite"` region. |
| A9 | A11y · state | **Low** | Toggles/tabs/nav communicate state only visually. The channel enable `.toggle` has no `aria-pressed`; active nav items have no `aria-current="page"`; the connectivity `#tg-dot`/`#tg-status` convey status by colour alone. | Add `aria-pressed` to the toggle, `aria-current="page"` to the active nav button, and keep the text label already present on the status pill (good) — the bare dot needs an `aria-label`. |
| A10 | A11y · contrast | **Low** | `--muted` body text is fine (≈5.2:1 light on surface, ≈6.4:1 dark). The weak spots are the **11px `.pill` text** and the **`color-mix`-derived pill/meter borders**, plus `--muted` on `--surface-2` (≈4.7:1) at 11–12px. | Nudge pill text to `--text` weight or darken `--muted` one step; verify pill borders meet 3:1 non-text contrast. |
| U1 | UX · destructive | **Med** | **Inconsistent confirmation.** Channel remove, group "Clear", and "Clear N failed" use `confirm()`, but the **single-row trash** and the **bulk "Delete"** button delete immediately with no confirm and no undo (`views.js` `rowsTable` / bulk bar). | Confirm (or offer an undo toast for) single-row and bulk delete too, so destructive actions are uniform. |
| U2 | UX · loading | **Med** | Loading is text-only ("Loading…" in Settings/Activity; `—` placeholders on the dashboard). No skeletons; the 2.5s poll can also repaint tables under the user. | Add lightweight skeleton blocks for the first paint of Settings/Activity/tables; consider not repainting a table while a row control has focus (see F1). |
| U3 | UX · theme toggle | **Med** | The topbar toggle cycles **auto→light→dark** but the icon for *auto* is `wifi` (misleading), there's no textual hint of the current mode, and 3-state cycling isn't discoverable. The Settings "Appearance" segmented control is the clear version. | Use a "monitor/auto" glyph for auto, set the `title`/`aria-label` to the *current* mode ("Theme: Auto"), or mirror the 3-button segmented control in the topbar. |
| U4 | UX · toasts | **Med** | Toasts auto-dismiss at 3200ms with **no manual dismiss, no hover-to-pause, not focusable**, and (per A8) not announced. An error toast can vanish before it's read. | Add a close affordance, pause the timer on hover/focus, and route through an `aria-live` region. |
| U5 | UX · mobile safe-area | **Med** | The bottom nav pads with `env(safe-area-inset-bottom)`, but the viewport meta lacks **`viewport-fit=cover`** (`index.html`, `login.html`), so on notched iOS the inset resolves to 0 and the padding is inert. | Set `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. |
| U6 | UX · empty/typography | **Low** | Empty states are one-liners (fine) but tone varies ("Nothing here." vs "Nothing downloaded yet."). Font sizes are hard-coded in many half-pixel values (11.5/12.5/13.5px) rather than a type scale. | Consolidate copy voice; consider 2–3 type tokens (`--fs-sm/-xs`) for consistency. |
| U7 | UX · tables | **Low** | Tables scroll correctly (`.data-card{overflow-x:auto}`, `min-width:560px`) — good — but there's no scroll affordance and on the narrowest breakpoint the action buttons + checkbox column can still crowd. | Optional: fade/shadow edge hint on horizontal scroll; hide low-priority columns under 480px. |
| F1 | Arch · focus/polling | **Med** | `render()` preserves focus only for elements **with an `id`** (`main.js`). Checkboxes, day buttons, and modal-less controls have none, so the 2.5s poll re-render on dashboard/downloads **drops focus to `<body>`** mid-interaction (selection state survives via `ui.sel`, focus does not). | Skip the polled re-render when `#view-root` contains the active element, or give interactive controls stable ids. Selection preservation is already handled well. |
| F2 | Arch · state | **Low** | `DATA`/`active` (main) and the exported mutable `ui` object (views) are effectively module-global singletons. Fine at this size, but `ui` is imported *and mutated* by `main.js` (`ui.sel`, `ui.dense`), coupling the two modules through shared mutable state. | Acceptable; if it grows, fold `ui` into the `createStore` you already ship in `core.js` (currently unused) and subscribe views to it. |
| F3 | Arch · XSS | **Low** (note) | Confirmed safe today: `h()` builds text nodes, and every `html:`/`innerHTML` use passes only `icon(name)` output drawn from the constant `PATHS` map — **no user input reaches `innerHTML`**. The `html:` key is a latent footgun for future contributors. | Keep the "trusted SVG only" comment; consider renaming the key `trustedHtml` or funnelling icons through a dedicated `svg()` helper so raw `html:` never takes a variable. |
| F4 | Arch · lifecycle | **Low** | The boot `setInterval` (2.5s) is never cleared — harmless at app lifetime. Listeners attached via `h(...,{onClick})` are GC'd with their nodes on `mount()`/`replaceChildren()`, so no leak. Activity view doesn't auto-refresh (poll re-renders only dashboard/downloads). | No action needed; optionally pause polling on `document.hidden` to save battery/requests, and refresh the log while Activity is visible. |

## Architecture summary

The front end is a **buildless, dependency-free ES-module SPA** with a genuinely
clean separation of concerns. `core.js` is the foundation — a ~25-line hyperscript
builder `h()` that is XSS-safe by construction (children become text nodes;
`innerHTML` is reachable only through an explicit `html:` key reserved for trusted
SVG), plus `mount/clear/qs`, a `fetch` wrapper that centralises 401→login and
toast-on-error, JSON helpers, formatters, and an (as-yet-unused) `createStore`.
`icons.js` is a pure data module: a map of Feather/Lucide-style path bodies wrapped
by `icon()` into `aria-hidden` inline SVGs that inherit `currentColor`. `views.js`
holds one pure builder per route plus the channel modal, and owns transient view
state in an exported `ui` object. `main.js` is the shell/router/controller: it
builds the sidebar + topbar + bottom-nav once, drives hash-based routing, owns the
data cache (`DATA`) and the 2.5s polling loop, and manages the tri-state theme.
Rendering follows a small, consistent **ctx contract** — every view receives
`{ data, refresh, rerender, getTheme, setTheme }`, where `refresh()` re-fetches then
repaints and `rerender()` repaints from cache — and `render()` diff-lessly rebuilds
`#view-root` while best-effort preserving focus by element id. The trade-offs are
deliberate and sound for the app's size: no bundler/transpiler (native ESM over
HTTP), full re-render instead of a virtual DOM, and module-global mutable state
instead of a store. The main things to tighten are **not** structural — they are the
keyboard/focus story (visible focus ring, modal trap+Esc, keyboard-operable group
headers), accessible names on icon-only controls, and making the polled re-render
non-disruptive to an in-progress interaction (F1).
