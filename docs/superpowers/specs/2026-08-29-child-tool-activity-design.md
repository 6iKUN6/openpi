# Child Tool Activity Design

## Goal

Issue #93 requires Direct Subagent and Workflow child transcript pages to use
the same compact, one-line Pi activity projection for `read`, `grep`, `find`,
`ls`, `bash`, `write`, and `edit`. The default stays compact; the configured
Pi expansion binding reveals Pi's native call and result evidence.

## Scope and Boundaries

This changes only the operator-facing child-session page. It must not change
child tool definitions, tool schemas, execution, permissions, model-visible
messages, transcript artifacts, replay data, or provider requests.

The existing `AgentToolRenderLedger` remains ephemeral. A live Direct or
Workflow child has the original tool definition and result data needed by
Pi's `ToolExecutionComponent`. A persisted Workflow transcript deliberately
has only its bounded text projection, so reopening it without an in-memory
ledger continues to use the existing safe text fallback rather than inventing
or persisting reconstructed native evidence.

## Selected Interaction Model

The child page inherits the parent UI's `getToolsExpanded()` value when the
page opens. The `app.tools.expand` binding toggles a page-local value while
the child page is focused. It does not call `setToolsExpanded()` on the parent
UI, so inspecting a child cannot unexpectedly expand or collapse the parent
conversation after the overlay closes. The page footer displays the configured
binding and the current expand/collapse action.

This uses the same effective compact/full setup semantics as the parent:
existing wrapped tool definitions determine the compact default, and the
standard Pi expansion binding reveals native evidence. No setup setting or
command is added.

## Architecture

`AgentSessionPage` owns only local interaction state. It passes `expanded` to
the shared `AgentTranscriptRenderer`, which forwards it for every tool block
to `AgentToolRenderer`. `AgentToolRenderLedger` applies the value to the
existing Pi `ToolExecutionComponent` before rendering.

Both entry points supply the initial state through the shared page:

- Direct Subagent takeover reads the parent UI state when it opens the
  takeover overlay.
- Workflow dashboard captures that state when the dashboard overlay opens and
  passes it to its transcript page.

The Direct and Workflow document adapters remain projections into the same
renderer. There is no duplicate formatter or child-specific tool definition.

## Verification

Focused tests will prove that a wrapped Bash child call is one compact row by
default, reveals its command and output through the native renderer when the
configured expansion binding is used, and returns to the compact row. Tests
will also cover inherited initial expansion, Direct/Workflow parity, pending,
success, error, long output, and narrow width behavior. The full repository
checks are `bun run check` and `bun run test`.
