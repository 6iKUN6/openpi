# OpenPI Web React migration MVP

- Status: draft
- Created: 2026-09-03
- Verified through: not yet validated
- Source boundary: OpenPI `72fbba5`, PR #352 head `1b340f2`
- Related issue: none; local validation branch only
- Related PR: [#352](https://github.com/openpi-dev/openpi/pull/352) is the frozen behavior and visual reference, not a dependency merged into this branch

## Purpose

Validate that the OpenPI Web browser projection can move from one imperative `app.js` file to React without changing Pi ownership, the Web protocol, or the visible behavior restored by PR #352. The result must work both through the Vite development server with HMR and as built static assets served by `WebHost`.

This is a framework migration, not a redesign. The browser remains a projection of the Web-owned Pi runtime and must not become a second Session, model, capability, or configuration source of truth.

## Chosen stack

- React 19 and TypeScript
- Vite 8
- Zustand vanilla store with React bindings
- Fetch, authenticated SSE, and `eventsource-parser`
- Existing TypeBox protocol contracts
- Tailwind CSS 4 as the primary CSS system
- Astryx Core and the neutral theme for selected accessible interaction primitives
- Lucide React icons
- `react-markdown`, `remark-gfm`, and `rehype-sanitize`
- i18next and react-i18next
- Vitest, React Testing Library, Playwright, and axe-core

Astryx owns generic Dialog, Menu, Tooltip, and Select behavior where its API preserves the reference interaction. Tailwind owns layout and visual matching. OpenPI-specific transcript evidence, activity projections, and the animated logo remain local React components. Astryx does not own runtime state or persistence.

## Runtime boundary

`PiWebRuntime`, `PiWebAdapter`, the protocol types, command endpoints, authentication token, cursor semantics, and lifecycle remain authoritative and unchanged. The migration adds three browser-side modules:

1. A typed HTTP client sends the existing bounded commands and distinguishes accepted receipts from terminal runtime evidence.
2. An authenticated Fetch-based SSE client parses records, resumes from the last cursor, and requests a snapshot after invalidation or replay gaps.
3. A Zustand vanilla store reduces snapshots and events into browser projection state. React reads selectors and dispatches commands; it does not infer completion from labels or CSS.

Only browser-local UI state may persist in `sessionStorage`: the process token and collapsed workspace groups. Theme, language, Sessions, models, and runtime capabilities are not independently persisted by this UI.

## Component boundaries

- `AppShell`: desktop grid, narrow-screen drawer, and global connection state.
- `SessionRail`: search, collapse, workspace groups, Session selection, and row actions.
- `WorkspacePicker`: initial workspace selection and native directory chooser command.
- `TranscriptViewport`: ordered persisted/live projections, follow-scroll policy, and turn anchors.
- `MessageBlock`: user and assistant text, copy action, latest-user edit-and-resend flow.
- `ThinkingEvidence`: live and settled thinking duration.
- `ToolEvidence`: call/result pairing, summaries, status, output disclosure, and empty output.
- `CapabilityEvidence`: Subagent and Workflow call/result cards.
- `ToolGroup`: collapses runs of four or more ordinary tool rows.
- `TurnRail`: jumps between user turns without owning transcript state.
- `ActivityBar`: bounded Subagent and Workflow status chips from canonical capability projections.
- `Composer`: active-Session checks, model selection, prompt admission, queued/running states, and auto-resizing input.
- `OpenPiLogo`: PR #352's 16-cell assembly, impact, line-clear, settling animation, click replay, and reduced-motion behavior.

Components receive typed projected values and callbacks. Protocol messages are normalized before rendering; components do not parse Session files or call Pi APIs directly.

## Behavior baseline

The complete baseline is PR #352 exact head `1b340f2`:

- engineering-grid backdrop, frosted desktop rail, opaque narrow-screen drawer, paper transcript lane, and favicon;
- workspace import, rename, remove, collapse, search, and per-workspace Session creation;
- Session select, rename, archive, active/readonly behavior, and switching feedback;
- model picker and Pi-native model selection;
- prompt admission tokens, queued/running/retrying states, duplicate terminal receipt handling, and edit-and-resend;
- snapshot plus cursor SSE recovery, stale response protection, reconnect status, and invalidation refresh;
- safe GFM Markdown, external links, image-as-link rendering, code, tables, and task lists;
- thinking timers, ordinary tool summaries and evidence, result pairing, error/running states, and four-step grouping;
- Subagent and Workflow cards, custom results, bounded capability chips, omitted counts, message copy/time actions, turn navigation, and follow-scroll behavior;
- responsive sidebar and composer at 390 by 844, keyboard operation, visible focus, and reduced motion;
- animated landing logo with click replay.

The removed browser-local theme/language settings are deliberately excluded. Language follows browser locale as in the final PR head until canonical package configuration is implemented separately.

## Build and static delivery

Vite uses `web/ui` as its source root and writes deterministic, auditable assets to `web/dist`. CSS splitting is disabled for the MVP so `WebHost` can retain a fixed static allowlist. No source map or arbitrary filesystem path is served.

- `bun run dev:web` starts the source backend plus Vite HMR.
- `bun run build:web` creates production assets.
- `node ./bin/openpi.js web [workspace]` serves those assets without Vite.
- `npm pack` must contain the built browser assets and run without remote CDN dependencies.

## Error and recovery behavior

- Missing or rejected auth yields an explicit disconnected/error surface without leaking the token.
- HTTP command errors preserve the current snapshot and show action-scoped feedback.
- A stale Session activation or prompt receipt cannot overwrite a newer selection or prompt state.
- SSE reconnect uses the last accepted cursor. A replay gap, invalid event, or `state_invalidated` event triggers a bounded snapshot refresh.
- Non-active Sessions remain read-only. UI optimism never proves model completion.
- Markdown input is sanitized, raw HTML is rendered as text, unsafe URL schemes are rejected, and images remain outbound links rather than embedded remote loads.
- Reduced-motion users receive the final logo state and nonanimated navigation.

## Validation

Automated validation must include:

- pure reducer tests for snapshot/event ordering, prompt settlement, activation races, reconnect, and invalidation;
- component tests for Session/workspace actions, composer gates, Markdown safety, tool pairing/grouping, copy/edit, turn navigation, activity chips, and Logo replay;
- existing Host/runtime/protocol tests updated to assert the built static asset contract;
- Playwright desktop and 390 by 844 flows against a real local WebHost, including keyboard navigation and axe checks;
- `bun run check`, `bun run test`, `bun run build:web`, and an `npm pack` content/startup smoke.

Manual acceptance must prove the checkout revision and single OpenPI source before exercising a real provider Session. It then covers landing animation, workspace and Session lifecycle, model selection, normal and queued prompts, streaming, tool evidence, Subagent/Workflow projections, reconnect, refresh recovery, narrow-screen navigation, and production static delivery.

## Success criteria

- Every visible and interactive behavior in the frozen PR #352 baseline is present or has an explicit failing test.
- No command, protocol, runtime ownership, persistence, permission, or lifecycle behavior is widened.
- Development HMR and production static delivery both work from the same React source.
- The production page makes no remote asset request and does not require Vite.
- The result passes repository gates and the real-browser acceptance matrix.

## Non-goals

- Merging or publishing the migration.
- Adding settings, trust approval, file attachments, interrupt control, transcript search, or other open Web issues.
- Changing Pi Session storage, provider selection semantics, capability schemas, or command endpoints.
- Keeping a second legacy UI route.
