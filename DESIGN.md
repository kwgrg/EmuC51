# C51 Geek Terminal Design System

> Source of truth: Google Stitch project **C51 Geek Terminal** (`projects/9059343258789011941`), design system **Cyber-C51 Emulator System**. Synced on 2026-08-01. Never store Stitch credentials or signed asset URLs in this repository.

## 1. Design direction

The interface is a retro-futuristic 8051 diagnostic terminal for engineers and learners. It combines the rigid structure of a command-line workbench with restrained glass layers and CRT-like luminous accents.

- Mood: deep focus, technical precision, local-machine confidence.
- Geometry: square corners everywhere except circular LEDs and rotary indicators.
- Surfaces: layered transparent black panels; use borders, not soft card shadows, to establish hierarchy.
- Motion: glow only for execution, selection, and live signals. Respect `prefers-reduced-motion`.
- Motifs: 40 px circuit grid, subtle 4 px scanlines, compact status bits, monospaced data alignment.
- Product truth wins over concept copy. The classic 8051 core now includes digital peripherals and instruction-boundary debugging; do not claim WebAssembly, precise bus timing, cloud sync, assembly editing, or source-level debugging.

## 2. Tokens

### Color

| Token | Value | Use |
| --- | --- | --- |
| `terminal-bg` | `#0a0a0a` | App canvas and inset data surfaces |
| `surface` | `#131313` | Default dark surface |
| `surface-lowest` | `#0e0e0e` | Footer, inset terminal areas |
| `surface-low` | `#1c1b1b` | Secondary surface |
| `surface-container` | `#201f1f` | Neutral controls |
| `surface-high` | `#2a2a2a` | Hover/raised neutral |
| `surface-highest` | `#353534` | Strong neutral separator |
| `glass-surface` | `rgba(20, 20, 20, 0.78)` | Terminal windows with `backdrop-filter: blur(12px)` |
| `on-surface` | `#e5e2e1` | Primary text |
| `on-surface-variant` | `#baccb0` | Secondary text |
| `outline` | `#85967c` | Labels and subdued metadata |
| `outline-variant` | `#3c4b35` | Inactive 1 px borders |
| `primary` | `#39ff14` | Run/success/current instruction/live output |
| `primary-dim` | `#2ae500` | Primary hover and glow |
| `primary-soft` | `#79ff5b` | Readable primary data text |
| `secondary` | `#00f1fd` | Addresses, navigation, information |
| `secondary-soft` | `#6ff6ff` | Readable secondary data text |
| `warning` | `#f59e0b` | Limitations and byte highlights |
| `error` | `#ffb4ab` | Human-readable error text |
| `error-red` | `#ef4444` | Hardware-style fault/display accent |
| `circuit-trace` | `#162221` | Background grid at low opacity |

Do not introduce arbitrary accent colors. New semantic states must reuse these roles or be added here first with contrast verification.

### Typography

- Primary/code/headlines: `JetBrains Mono`, then `Cascadia Mono`, `SFMono-Regular`, `Consolas`, monospace.
- Labels/metadata: `Fira Sans`, then `Segoe UI`, sans-serif.
- `headline-lg`: 32/40 px, weight 700, tracking `-0.02em`.
- `headline-md`: 24/32 px, weight 600.
- `code-display`: 18/28 px, weight 500, tracking `0.05em`.
- `body-sm`: 14/20 px, weight 400.
- `label-caps`: 12/16 px, weight 700, tracking `0.1em`, uppercase.
- `address-label`: 11/14 px, weight 400.

The application must remain usable when the named fonts are not installed; external fonts are intentionally not fetched because production CSP is self-only.

### Spacing and layout

- Base unit: 4 px.
- Gutter: 16 px.
- Desktop page margin: 24 px; mobile page margin: 12 px.
- Terminal window body padding: 12 px unless dense data requires 8 px.
- Desktop: 12-column workbench logic; terminal panes align to a strict grid.
- Mobile: one-column content and a persistent bottom navigation. Never compress dense tables until values become ambiguous; allow horizontal scrolling inside the pane.

## 3. Components and states

### Terminal window

- 1 px inactive border using secondary/outline at low opacity.
- 26 px header bar: uppercase title on the left, rectangular status bits on the right.
- Active/live pane: primary border plus a restrained `0 0 8px` primary glow.
- Body uses transparent black so the circuit grid can show through faintly.

### Commands

- Primary: black background, 1 px neon-green border/text; hover fills green and switches text to black.
- Secondary: same behavior with cyber blue.
- Ghost: no fill; prefix command copy with `>` where it reads naturally.
- Disabled controls retain their geometry and use reduced opacity.
- All keyboard-focusable controls require a visible 1 px primary outline.

### Data, lists, and status

- Addresses are cyber blue; executable/current values are neon green; raw bytes may use amber.
- Separate list rows with low-opacity 1 px lines. Zebra striping is forbidden.
- The current instruction is a full-row primary fill with black text.
- Status bits are small square labels. Active bits use primary fill; inactive bits use transparent fill and a muted border.
- LEDs are the only routinely circular component; active LEDs glow in their semantic color.

### Inputs

- Dark inset or transparent background, square corners, bottom border only for data entry.
- Hex/address inputs use monospaced text and an explicit accessible label.
- File input remains local-only and accepts `.bin` up to 64 KiB or `.hex`/`.ihx` text up to 1 MiB decoding to at most 64 KiB CODE.

## 4. Page patterns

### HOME

Use a status chip, truthful product proposition, `INIT_ENV` and local firmware actions, a CSS-rendered 8051 chip motif, and a feature/metrics grid. The page explains the product; it does not expose dense debugger controls.

### BIN_INSPECTOR

Use the workbench composition: firmware pane, disassembled instructions and trace inspector, runtime controls, debugger controls, CPU monitor, output console, port LEDs, and execution settings. Display actual operands and jump targets, highlight the current PC, and provide address breakpoints, memory change watchpoints, step over, and run to address. Register editing is available while stopped. Never imply editable assembly source.

### SYS_MEM

Give the memory dump the largest area. Keep CODE/IRAM/SFR/XRAM tabs, address navigation, byte editing while stopped, IRAM preview, watch values, and the register bank visible in adjacent terminal panes. CODE remains read-only.

### I/O_PORTS

Present digital GPIO input and output: label external input, output latch, and observed pins separately. Provide accessible port bit controls, a UART console with local input and output, timer and interrupt status, and the PCON state. Inputs remain available while executing. Port-derived display and stepper previews are illustrative signals; never imply electrical or mechanical simulation.

### Workspace transfer

Provide local workspace download and a labeled JSON file input. Validate imported files before replacing the current workspace, show readable errors, and retain the active firmware on failure. Keep loading, restoring, and paused states explicit; imports and exports never use network requests.

## 5. Adding a page

1. Add one entry to the shared navigation model and provide desktop plus mobile labels.
2. Build the view from terminal windows and existing tokens; do not fork a new visual language.
3. Define empty, loading/restoring, active, disabled, and fault states before adding decorative detail.
4. Keep emulator claims aligned with `README.md` and the implemented core.
5. Verify at 1280×1024, 820 px, and 390 px widths; dense panes must scroll internally without causing page-level horizontal overflow.
6. Add an end-to-end navigation assertion and preserve the local-only request invariant.
7. Update this document when a new token, component contract, or page pattern is introduced.

## 6. Accessibility and privacy invariants

- Maintain WCAG-readable contrast; primary/secondary glow never substitutes for text or borders.
- Every icon-only signal needs a text alternative or title; color is not the sole carrier of run/fault state.
- Use semantic landmarks and labeled navigation. Keep focus order consistent with visual order.
- Production remains self-contained under the existing CSP: no analytics, remote fonts, remote images, or runtime API calls.
- Firmware names, bytes, hashes, CPU state, memory, and traces stay in the browser and are never included in outbound requests.
