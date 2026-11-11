# Unified Frontend and CLI Workbench Design

Status: approved design, pending document review.

## Goal

Replace the inconsistent presentation and source-language setup of the three interactive workbench frontends with one shared UI system, while keeping the same workbench available from VS Code and NodeCli.

The three applications are the shared `.ad` / `.st` schematic editor, waveform viewer, and pin constraints / board library workbench.

## Confirmed Scope

- Include the schematic editor used by both Arch Design (`.ad`) and Simulation Task (`.st`).
- Include the waveform viewer.
- Include Pin bindings and Board library in the constraints workbench.
- Keep the command-line core operations and Module Browser out of the visual redesign.
- Make all three webview applications launchable through NodeCli. The waveform and constraints workbenches already have Electron launch paths; add Electron launch paths for `.ad` and `.st` editing.
- Preserve existing editing, validation, export, simulation, and persistence behavior except for the explicitly requested UI removals.
- Do not change model schemas, package versions, or release artifacts for this design task.

## Frontend Architecture

All three applications use TypeScript, native DOM/CSS, and the existing esbuild build pipeline. Add a small host-independent shared UI package for semantic design tokens, base controls, shared icon rendering, and the renderer-side host transport interface. Do not add a component framework.

Each application keeps its domain renderer:

- Schematic remains X6-based and continues to serve both `.ad` and `.st` documents.
- Waveform drawing remains Canvas-based, including the existing translucent fill beneath high-level intervals.
- Constraints remains a DOM-based editor driven by the existing workbench state and messages.

The shared UI package must not import VS Code, Electron main-process, Node filesystem, or project-domain APIs. Application-specific messages remain typed and retain their current semantics; the shared transport only provides a host-neutral way to send renderer commands and receive host events.

The visual tokens follow the frontend demo's compact layout and control rhythm, with colors resolved from VS Code theme variables when present and product defaults in Electron. Demo-only theme presets, sample content, and simulated actions are not included in product bundles.

## Host Architecture

VS Code continues to host the applications using its existing Webview API and editor providers. Electron hosts use a sandboxed renderer with context isolation and a preload bridge; renderer code receives only the typed workbench transport and cannot access Node directly.

Waveform and constraints continue to use their current NodeCli Electron launch paths. Add the following CLI commands for the schematic editor:

```text
veriflow arch ui <design.ad>
veriflow task ui <task.st>
```

The NodeCli host must support the editor workflows already exposed by the VS Code editor: loading the document and relevant definitions, applying and saving edits, validation, Arch Design export/build, Simulation Task generation/run/cancel, opening waveforms, and opening referenced source definitions through a desktop-appropriate host action.

Business coordination needed by both hosts must be expressed through Node-compatible service interfaces and existing shared packages. VS Code-specific document APIs, diagnostics, commands, and dialogs stay inside the VS Code adapter. Electron-specific file dialogs, persistence, and IPC stay inside the desktop adapter. The frontend does not know which host it is running in.

## Visual and Interaction Requirements

### Shared editor language

- Use one compact toolbar height, spacing scale, icon treatment, button/input/table styling, focus state, and semantic color palette across the three applications.
- Use the same icon library and icon-only button treatment where a control is a tool; hover tooltips and accessible names identify the action.
- Adapt the shared theme to VS Code-provided colors in the extension and shared defaults in Electron.
- Keep each application's existing domain-specific interactions and keyboard commands.

### Schematic editor

- Keep `.ad` and `.st` in the same X6 application shell.
- Retain the existing canvas, inspector, diagnostics, module navigation, editing controls, export/build actions, and Simulation Task run/wave actions.
- Style the `.ad` and `.st` modes with the same shared tokens and controls.

### Waveform viewer

- Keep the current signal navigation, zooming, cursors, search, bus display, and layout persistence.
- Preserve the translucent background fill for digital high-level waveform intervals, using the shared waveform color token so the fill remains visible in supported themes.
- Keep Canvas as the rendering surface; this design changes the surrounding controls and styling, not the waveform data model or rendering semantics.

### Pin constraints and board library

- The first row contains the Pin bindings / Board library tabs and the actions relevant to the selected page.
- Remove the separate brand/context bars and the large main-area headings and explanatory subtitles on both pages.
- Remove the binding progress bar and redundant per-row assignment status column/markers. Incomplete values remain visible in their actual binding fields; meaningful validation errors still block invalid exports and remain inspectable.
- Keep board selection, source refresh, interface and port browsing, drag/drop assignment, bus-bit binding, board/card management, template editing, save/load, undo/redo, validation, and export behavior.
- Expand the constraint template text editor to use the available main-area height. Keep the live preview available without constraining the editor to its current small fixed height.
- Put two icon-only insert tools inside the template editor toolbar: insert `{signal name}` and insert `{pin name}`. Provide hover tooltips and accessible names; preserve insertion at the text cursor.
- Do not add visible feature explanations or demo-only status/progress copy.

## Build and Packaging

The canonical TypeScript/CSS sources remain in their workspaces. `scripts/build-web.mjs` produces the three application bundles in `web-dist`; the VS Code asset build copies those outputs into the extension. The Electron desktop build includes the same built applications alongside the existing waveform and constraints assets.

Both hosts must load the same HTML, CSS, and renderer bundles for an application. Host-specific adapters are loaded by the host entry or preload bridge, not by maintaining forked UI copies.

## Migration and Verification

1. Add the shared UI package and typed renderer transport, then update web asset build and packaging contracts.
2. Adopt the shared shell and tokens in the schematic editor and verify both `.ad` and `.st` modes.
3. Convert the waveform renderer entry and UI source to TypeScript while retaining its Canvas algorithm and high-level fill; verify common navigation and cursor interactions.
4. Convert the constraints workbench source to TypeScript and implement the toolbar, status removals, expanded template editor, and placeholder icon tools.
5. Extract Node-compatible `.ad` / `.st` host services, connect the Electron schematic window, and add the `arch ui` and `task ui` CLI launch commands.
6. Run unit, browser, host-bridge, build-asset, and packaging checks in both build paths.

Acceptance requires:

- Each application loads from VS Code and Electron using the same renderer assets.
- `.ad` edits/save/export/build and `.st` edits/generate/run/cancel/open-wave remain functional in both hosts.
- Existing waveform high-level fill remains visible alongside signal transitions and cursor overlays.
- Constraints pages have one top toolbar row, no redundant progress or row status, and the template editor uses the available area with both cursor-position-aware insert tools.
- Existing drag/drop and bus-bit binding, board/card CRUD, template persistence, validation, and export outputs remain correct.
- `npm test`, `npm run build`, and `npm run build:cli` pass, including the relevant Webview browser tests, Electron host tests, VSIX asset tests, and desktop asset tests.

## Constraints and Non-Goals

- No model or schema change is required. Keep the physical model schema version unchanged.
- Do not publish packages or the VS Code extension as part of the redesign unless separately requested.
- Do not replace X6 or Canvas, introduce a frontend framework, change the CLI's non-UI command semantics, or redesign the Module Browser.
- The frontend demo is a visual reference only; all production actions continue to use real workbench and host services.
