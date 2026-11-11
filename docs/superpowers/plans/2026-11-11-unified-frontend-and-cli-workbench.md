# Unified Frontend and CLI Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Project `AGENTS.md` prohibits subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three inconsistent workbench frontends with one TypeScript-based UI system, preserve existing NodeCli launch paths, and add CLI launch commands for `.ad` and `.st` through the Electron desktop package.

**Architecture:** Add a small shared Webview UI package for theme tokens, common controls, icons, and a typed host transport. Keep X6, Canvas, and the constraints DOM renderer, with VS Code and Electron adapters using the same application assets. Put reusable Node-compatible editor and task execution services in `hdl-runtime`; connect them to VS Code and Electron hosts.

**Tech Stack:** TypeScript, native DOM/CSS, esbuild, X6, Canvas, VS Code Webview API, Electron preload/IPC, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-unified-frontend-design.md`

## Global Constraints

- Require Node.js `>=24.14.1`.
- Keep physical model Schema V1 and all existing `.ad`, `.st`, `.pins.json`, board JSON, and waveform layout formats unchanged.
- Do not add React, Vue, or another frontend framework.
- Do not import `vscode`, Electron main-process APIs, or Node filesystem APIs into renderer code or shared domain services.
- Preserve VS Code commands, CLI non-UI command behavior, the existing `wave`, `board ui`, and `pins ui` Electron entry paths, and the waveform Qt transport adapter.
- Do not produce release packages or publish the CLI or VS Code extension; packaging tests may create temporary artifacts for verification.
- Use explicit file paths in Git staging commands; the worktree already contains unrelated untracked `.workbuddy/` and `frontend-demo/` directories.

---

## File Structure

- `packages/webview-ui/`: common theme tokens, base UI CSS, Lucide icon helper, and typed renderer host transport.
- `packages/schematic-webview/`: shared `.ad` / `.st` renderer and constraints workbench renderer.
- `packages/waveform-webview/`: waveform TypeScript UI, core codecs, and renderer transport.
- `packages/hdl-runtime/src/workbench/`: host-independent editor protocol, versioned document services, and Simulation Task runner.
- `packages/waveform-desktop/`: sandboxed Electron windows, preload bridges, and canonical web assets for CLI launch.
- `packages/cli/`: `arch ui` and `task ui` commands and Electron launch adapters.
- `scripts/` and `veriflow-vscode/src/test/`: web asset generation, VSIX asset checks, and clean-build coverage.

---

### Task 1: Add Shared Webview UI Foundation

**Files:**
- Create: `packages/webview-ui/package.json`
- Create: `packages/webview-ui/tsconfig.json`
- Create: `packages/webview-ui/src/host.ts`
- Create: `packages/webview-ui/src/icons.ts`
- Create: `packages/webview-ui/src/tokens.css`
- Create: `packages/webview-ui/src/base.css`
- Create: `packages/webview-ui/test/host.test.ts`
- Create: `packages/webview-ui/test/run-tests.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces `WebviewTransport<Outgoing, Incoming, State>` with `postMessage`, `onMessage`, `getState`, and `setState`.
- Produces `createWebviewTransport(window)` selecting VS Code `acquireVsCodeApi()` plus the window `message` event, or Electron `window.__veriflowHost`; the preview/test fallback dispatches the existing `veriflow:webview-message` event.
- Produces `renderIcon(name)` from the existing Lucide package. Decorative SVGs are `aria-hidden`; icon buttons keep their caller-provided title and accessible name.

- [x] **Step 1: Add a failing transport test**

```ts
test('forwards commands and host events and preserves webview state', () => {
    const sent: unknown[] = [];
    const received: unknown[] = [];
    let receive: ((message: unknown) => void) | undefined;
    const api = {
        postMessage: (message: unknown) => { sent.push(message); },
        onMessage: (listener: (message: unknown) => void) => {
            receive = listener;
            return () => { receive = undefined; };
        },
        getState: () => ({ selected: 'uart_tx' }),
        setState: (_state: unknown) => undefined,
    };
    const host = createWebviewTransport({ __veriflowHost: api } as unknown as Window);
    host.onMessage(message => received.push(message));
    host.postMessage({ type: 'ready' });
    receive?.({ type: 'initialize' });
    assert.deepEqual(sent, [{ type: 'ready' }]);
    assert.deepEqual(received, [{ type: 'initialize' }]);
    assert.deepEqual(host.getState(), { selected: 'uart_tx' });
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `npm test --workspace @veriflow/webview-ui`
Expected: FAIL because `createWebviewTransport` and the fake-window fixture do not exist.

- [x] **Step 3: Implement the host transport and common icon helper**

Add the generic transport interface and adapters in `src/host.ts`; define the Electron global as a narrow renderer API with no Node access. Add `renderIcon` in `src/icons.ts`, pin `lucide` to the existing `1.28.0`, and copy the demo's semantic `--vf-*` tokens/base control rules into production CSS without theme presets or demo scripts.

- [x] **Step 4: Run package typecheck and tests**

Run: `npm run typecheck --workspace @veriflow/webview-ui` and `npm test --workspace @veriflow/webview-ui`
Expected: PASS for VS Code, Electron, and preview adapters, including state persistence only where the host supports it.

- [x] **Step 5: Commit the shared UI foundation**

```bash
git add package.json package-lock.json packages/webview-ui/package.json packages/webview-ui/tsconfig.json packages/webview-ui/src/host.ts packages/webview-ui/src/icons.ts packages/webview-ui/src/tokens.css packages/webview-ui/src/base.css packages/webview-ui/test/host.test.ts packages/webview-ui/test/run-tests.cjs
git commit -m "feat: add shared webview UI foundation"
```

### Task 2: Establish Canonical Web Assets for Both Hosts

**Files:**
- Modify: `scripts/build-web.mjs`
- Modify: `scripts/build-vscode.mjs`
- Modify: `packages/waveform-desktop/scripts/build-assets.mjs`
- Modify: `packages/waveform-desktop/package.json`
- Modify: `packages/waveform-desktop/src/preload.ts`
- Modify: `packages/waveform-webview/src/index.js`
- Modify: `veriflow-vscode/src/waveformEditorProvider.ts`
- Modify: `package.json`
- Modify: `veriflow-vscode/src/test/webDistAssets.test.ts`
- Modify: `veriflow-vscode/src/test/schematicAssets.test.ts`
- Modify: `veriflow-vscode/src/test/rootBuild.test.ts`
- Modify: `veriflow-vscode/src/test/vsixPackaging.test.ts`
- Modify: `packages/waveform-desktop/test/desktopHost.test.ts`

**Interfaces:**
- `web-dist/{schematic,waveform,constraints}` is the canonical output consumed by VS Code and Electron. Host adapters may rewrite CSP and resource URLs, but renderer HTML, CSS, and JavaScript come from the same source outputs.
- Each app output contains one HTML file, composed `index.css`, and `index.js`; waveform also contains `viewer-core.js` and `viewer-transport.js` until Task 5 bundles those modules into its TypeScript entry.
- Waveform HTML, CSS, and JavaScript are read from the canonical asset output by both hosts; the renderer's existing `ready` and host response protocol remains intact.
- Electron preload exposes the shared `__veriflowHost` API for each app while keeping `__waveformMemoryTransport` and `__boardEditorHost` aliases for existing renderers during migration.
- Electron copies the canonical application directories without rewriting renderer files.

- [x] **Step 1: Add asset and waveform initialization contract assertions**

Update `webDistAssets.test.ts` to check all three app outputs, shared tokens, app CSS, HTML, and non-empty renderer scripts. Assert that the waveform bundle no longer contains the `${stateJson}` marker. Extend `desktopHost.test.ts` to verify Electron loads the canonical waveform asset and still receives initial metadata after `ready`.

- [x] **Step 2: Run focused tests to observe the current asset duplication**

Run: `npm test --workspace veriflow-vscode` and `npm test --workspace @veriflow/waveform-desktop -- --test-name-pattern="waveform renderer"`.
Expected: FAIL because the current asset pipeline does not compose shared CSS or produce a single canonical output path for Electron.

- [x] **Step 3: Emit canonical app directories from `build-web.mjs`**

For each app, compose `tokens.css`, `base.css`, and its app stylesheet into `index.css`. Support both a TypeScript `entryPoint` and the current JavaScript script list so the later migration tasks can switch apps incrementally. Keep stable HTML and script filenames. Make `build-vscode.mjs` copy the generated directories and make desktop `build-assets.mjs` copy those same directories instead of reading renderer sources directly.

- [x] **Step 4: Normalize Electron transport and remove source rewrites**

Expose `__veriflowHost` from Electron preload with `postMessage`, `onMessage`, `getState`, and `setState`, while preserving the existing waveform and board bridge aliases during migration. Remove the unused `${stateJson}` marker and the VS Code provider's source replacement. Keep its existing `ready` handling and the Qt transport adapter unchanged. Ensure root `build:desktop`, desktop `pretest`, and desktop `prepack` build canonical web assets before copying them.

- [x] **Step 5: Run asset, host, and packaging checks**

Run: `npm run build:web`, `npm test --workspace veriflow-vscode`, `npm test --workspace @veriflow/waveform-desktop -- --test-name-pattern="waveform renderer"`, and `npm run test:vsix --workspace veriflow-vscode`.
Expected: PASS; both hosts consume the same canonical renderer HTML, CSS, and JavaScript, with host-specific CSP and resource URL handling confined to the adapters.

- [x] **Step 6: Commit canonical asset infrastructure**

```bash
git add scripts/build-web.mjs scripts/build-vscode.mjs packages/waveform-desktop/scripts/build-assets.mjs packages/waveform-desktop/package.json packages/waveform-desktop/src/preload.ts packages/waveform-webview/src/index.js packages/waveform-desktop/test/desktopHost.test.ts veriflow-vscode/src/waveformEditorProvider.ts veriflow-vscode/src/test/webDistAssets.test.ts veriflow-vscode/src/test/schematicAssets.test.ts veriflow-vscode/src/test/rootBuild.test.ts veriflow-vscode/src/test/vsixPackaging.test.ts package.json
git commit -m "build: share canonical webview assets"
```

### Task 3: Adopt Shared Shell in the Schematic Editor

**Files:**
- Modify: `packages/schematic-webview/src/index.html`
- Modify: `packages/schematic-webview/src/index.css`
- Modify: `packages/schematic-webview/src/index.ts`
- Modify: `packages/schematic-webview/test/schematicWebview.test.ts`
- Modify: `packages/schematic-webview/test/unifiedWorkbench.browser.cjs`
- Modify: `packages/schematic-webview/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes the `WebviewTransport<WebviewCommand, HostEvent, PersistedWebviewState>` from Task 1.
- Produces the same `WebviewCommand` / `HostEvent` behavior for both `.ad` and `.st`; no host protocol changes.

- [x] **Step 1: Add failing browser assertions for shared shell behavior**

Assert that both Arch Design and Simulation Task modes render one shared toolbar, use the common control classes, and still expose their mode-specific actions. Assert that the toolbar command buttons retain their current `aria-label`, `title`, and keyboard shortcut attributes.

- [x] **Step 2: Run the schematic browser test and confirm it fails**

Run: `npm run test:browser --workspace @veriflow/schematic-webview`
Expected: FAIL on the new shared-shell assertions.

- [x] **Step 3: Apply shared tokens and transport**

Add `@veriflow/webview-ui` as a workspace dependency. Map existing `--schematic-*` drawing colors to `--vf-*` semantic tokens in `index.css`. Replace the local VS Code-only API wrapper in `index.ts` with the shared transport. Keep X6 graph creation, `.ad` and `.st` state handling, diagnostics, inspector, export, run, and waveform commands intact.

- [x] **Step 4: Run schematic tests**

Run: `npm test --workspace @veriflow/schematic-webview` and `npm run test:browser --workspace @veriflow/schematic-webview`
Expected: PASS, including existing graph, edit, and task protocol tests.

- [x] **Step 5: Commit the schematic migration**

```bash
git add packages/schematic-webview/src/index.html packages/schematic-webview/src/index.css packages/schematic-webview/src/index.ts packages/schematic-webview/test/schematicWebview.test.ts packages/schematic-webview/test/unifiedWorkbench.browser.cjs packages/schematic-webview/package.json package-lock.json
git commit -m "refactor: apply shared UI to schematic workbench"
```

### Task 4: Convert Waveform Core and Transport to TypeScript

**Files:**
- Move: `packages/waveform-webview/src/viewer-core.js` to `packages/waveform-webview/src/viewer-core.ts`
- Move: `packages/waveform-webview/src/viewer-transport.js` to `packages/waveform-webview/src/viewer-transport.ts`
- Create: `packages/waveform-webview/test/run-tests.cjs`
- Modify: `packages/waveform-webview/tsconfig.json`
- Modify: `packages/waveform-webview/package.json`
- Modify: `scripts/build-web.mjs`
- Modify: `package-lock.json`
- Modify: `veriflow-vscode/src/test/core.test.ts`
- Create: `packages/waveform-webview/test/viewerCore.test.ts`

**Interfaces:**
- Preserve global `VeriflowWaveCore` exports and `window.waveformTransport` for the existing JavaScript renderer until Task 5 converts it.
- Preserve memory, VS Code, Qt, request cancellation, state persistence, and listener disposal behavior.

- [ ] **Step 1: Add a focused TypeScript codec regression test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

const waveCore = require('../src/viewer-core.js') as {
    decodeWindowPayload(payload: unknown): unknown;
};

test('decodes packed four-state waveform values', () => {
    const decoded = waveCore.decodeWindowPayload({
        kind: 'raw',
        width: 4,
        times: [0, 12],
        values: Buffer.from([0x00, 0x4b]).toString('base64'),
        valueStride: 1,
    });
    assert.deepEqual(decoded, {
        kind: 'raw',
        width: 4,
        changes: [
            { time: 0, value: '0000' },
            { time: 12, value: '10xz' },
        ],
    });
});
```

- [ ] **Step 2: Add a Node test runner and establish the baseline**

Add a `test` script to the waveform package. In `test/run-tests.cjs`, bundle `viewerCore.test.ts` with esbuild for Node into a temporary test file, then execute it with `node --test` and remove the temporary file. Initially point the test at the existing `src/viewer-core.js` implementation so this regression test passes before conversion. Run: `npm test --workspace @veriflow/waveform-webview` and `npm run test:task6 --workspace veriflow-vscode`.
Expected: PASS against the current JavaScript implementation before the file moves.

- [ ] **Step 3: Convert the two modules and type their boundaries**

Add `@veriflow/webview-ui` as a workspace dependency. Keep the UMD/CommonJS test exports and browser globals. Add explicit types for decoded payloads, transport messages, listener callbacks, and cleanup functions. Keep `qt.webChannelTransport` supported through a waveform-specific adapter over the shared host transport.

- [ ] **Step 4: Bundle the TypeScript core in Node tests and run typecheck**

Update `test/run-tests.cjs` to bundle `viewer-core.ts` and `viewer-transport.ts` with esbuild for Node. Update `build-web.mjs` to emit browser-global `viewer-core.js` and `viewer-transport.js` from the TypeScript sources. Change `core.test.ts` to evaluate those generated bundles in a `vm` context and assert their globals. Include `src/**/*.ts` in the waveform tsconfig. Run: `npm run build:web`, `npm run typecheck --workspace @veriflow/waveform-webview`, `npm test --workspace @veriflow/waveform-webview`, and `npm run test:task6 --workspace veriflow-vscode`.
Expected: PASS with existing VCD codec, indexed query, and cancellation tests unchanged.

- [ ] **Step 5: Commit waveform core conversion**

```bash
git add packages/waveform-webview/src/viewer-core.js packages/waveform-webview/src/viewer-transport.js packages/waveform-webview/src/viewer-core.ts packages/waveform-webview/src/viewer-transport.ts packages/waveform-webview/test/viewerCore.test.ts packages/waveform-webview/test/run-tests.cjs packages/waveform-webview/package.json packages/waveform-webview/tsconfig.json scripts/build-web.mjs package-lock.json veriflow-vscode/src/test/core.test.ts
git commit -m "refactor: convert waveform core transport to TypeScript"
```

### Task 5: Convert and Restyle the Waveform Renderer

**Files:**
- Move: `packages/waveform-webview/src/index.js` to `packages/waveform-webview/src/index.ts`
- Modify: `packages/waveform-webview/src/index.html`
- Modify: `packages/waveform-webview/src/index.css`
- Modify: `packages/waveform-webview/tsconfig.json`
- Modify: `packages/waveform-webview/package.json`
- Modify: `scripts/build-web.mjs`
- Modify: `package-lock.json`
- Modify: `veriflow-vscode/src/waveformEditorProvider.ts`
- Modify: `veriflow-vscode/src/test/webDistAssets.test.ts`
- Modify: `veriflow-vscode/src/test/schematicAssets.test.ts`
- Modify: `veriflow-vscode/src/test/vsixPackaging.test.ts`
- Modify: `packages/waveform-desktop/test/desktopHost.test.ts`

**Interfaces:**
- The renderer consumes `WebviewTransport<WaveformRendererMessage, WaveformHostMessage, WaveformLayoutState>`.
- Keeps the existing Canvas render loop, wave data structures, persisted layout, and debug test API.

- [ ] **Step 1: Add failing high-level fill and toolbar tests**

Use `tests/fixtures/waveform_debug.vcd` in the Electron browser test. Assert toolbar controls have the shared dimensions/classes, and sample a Canvas pixel inside a stable high interval to ensure it differs from the row background while the low interval does not use that fill.

- [ ] **Step 2: Run the focused Electron test and confirm it fails on the shared shell**

Run: `npm test --workspace @veriflow/waveform-desktop -- --test-name-pattern="waveform renderer"`
Expected: FAIL on the new toolbar assertion before the migration.

- [ ] **Step 3: Convert the renderer to TypeScript and shared transport**

Add `@veriflow/webview-ui` as a workspace dependency. Add explicit types for DOM elements, waveform rows, pointer/keyboard handlers, Canvas drawing helpers, and host messages. Replace hard-coded chrome colors with shared CSS variables. Keep `drawHighFill` calls for raw and summarized digital values and derive its alpha fill from the shared waveform token. Bundle the TypeScript entry with the two TypeScript core modules into one `index.js`; update both host adapters to load that entry without separate core/transport scripts.

- [ ] **Step 4: Verify waveform interactions and pixel fill**

Run: `npm run typecheck --workspace @veriflow/waveform-webview` and `npm test --workspace @veriflow/waveform-desktop`
Expected: PASS for opening a VCD, signal selection, cursor measurement, layout persistence, and high-level fill pixel checks.

- [ ] **Step 5: Commit the waveform renderer migration**

```bash
git add packages/waveform-webview/src/index.js packages/waveform-webview/src/index.html packages/waveform-webview/src/index.css packages/waveform-webview/src/index.ts packages/waveform-webview/package.json packages/waveform-webview/tsconfig.json packages/waveform-desktop/test/desktopHost.test.ts scripts/build-web.mjs package-lock.json veriflow-vscode/src/waveformEditorProvider.ts veriflow-vscode/src/test/webDistAssets.test.ts veriflow-vscode/src/test/schematicAssets.test.ts veriflow-vscode/src/test/vsixPackaging.test.ts
git commit -m "refactor: unify waveform workbench UI"
```

### Task 6: Convert and Simplify the Constraints Workbench

**Files:**
- Move: `packages/schematic-webview/src/constraints/index.js` to `packages/schematic-webview/src/constraints/index.ts`
- Modify: `packages/schematic-webview/src/constraints/index.html`
- Modify: `packages/schematic-webview/src/constraints/index.css`
- Modify: `packages/schematic-webview/package.json`
- Modify: `scripts/build-web.mjs`
- Modify: `package-lock.json`
- Modify: `packages/waveform-desktop/test/boardEditorHost.test.ts`

**Interfaces:**
- Consumes the existing `ConstraintWorkbench` message shapes and shared renderer host transport.
- Preserves host actions `ready`, `board-change`, `bind`, `pin`, `board-save`, `bindings-save`, `bindings-load`, `export`, `board-open`, `source-open`, `undo`, and `redo`.
- Placeholder insertion commands insert exactly `{signal name}` or `{pin name}` at the current textarea selection.

- [ ] **Step 1: Add failing Electron assertions for the requested constraints layout**

Extend the existing board editor Electron test to assert that both pages have one top toolbar row, no `.main-head`/brand/context bars, no binding progress element or per-row status cell, and that the two icon tools insert their exact token at the caret. Assert the editor grows with its parent rather than retaining the current fixed small height.

- [ ] **Step 2: Run the focused constraints test and confirm it fails**

Run: `npm test --workspace @veriflow/waveform-desktop -- --test-name-pattern="shared workbench"`
Expected: FAIL on the layout and caret-insertion assertions.

- [ ] **Step 3: Convert renderer source and implement the two-page toolbar**

Add `@veriflow/webview-ui` as a workspace dependency. Use shared `vf-*` styles and icon rendering. Keep current board/source selectors and actions in the first toolbar row. Remove the redundant headings, descriptions, progress, and assignment status markup and update `applyPage()` to switch the active toolbar controls without changing the host page state.

- [ ] **Step 4: Expand template editing and add cursor-aware icon tools**

Place the two icon buttons inside the constraint-template textarea frame. Give each a tooltip and `aria-label`; implement insertion by replacing the current selection and restoring the caret after the inserted token. Make the textarea consume available editor height; keep live preview in a separate resizable/collapsible region.

- [ ] **Step 5: Verify real workbench messages and desktop bindings**

Run: `npm run typecheck --workspace @veriflow/schematic-webview`, `npm run test:browser --workspace @veriflow/schematic-webview`, and `npm test --workspace @veriflow/waveform-desktop -- --test-name-pattern="shared workbench"`.
Expected: PASS for board CRUD, binding drag/drop, bus-bit editing, undo/redo, template save, export, and page switching.

- [ ] **Step 6: Commit the constraints migration**

```bash
git add packages/schematic-webview/src/constraints/index.js packages/schematic-webview/src/constraints/index.html packages/schematic-webview/src/constraints/index.css packages/schematic-webview/src/constraints/index.ts packages/schematic-webview/package.json packages/waveform-desktop/test/boardEditorHost.test.ts scripts/build-web.mjs package-lock.json
git commit -m "refactor: simplify constraints workbench UI"
```

### Task 7: Add Host-Neutral Workbench Services

**Files:**
- Create: `packages/hdl-runtime/src/workbench/protocol.ts`
- Create: `packages/hdl-runtime/src/workbench/documentHost.ts`
- Create: `packages/hdl-runtime/src/workbench/archDesignSession.ts`
- Create: `packages/hdl-runtime/src/workbench/simulationTaskSession.ts`
- Create: `packages/hdl-runtime/src/workbench/simulationTaskRunner.ts`
- Create: `packages/hdl-runtime/test/workbench.test.ts`
- Modify: `packages/hdl-runtime/src/index.ts`
- Modify: `packages/hdl-runtime/package.json`
- Modify: `packages/schematic-webview/src/shared/protocol.ts`
- Modify: `veriflow-vscode/src/archDesign/archDesignEditorProvider.ts`
- Modify: `veriflow-vscode/src/simulationTask/taskEditorProvider.ts`
- Modify: `veriflow-vscode/src/simulationTask/taskController.ts`

**Interfaces:**
- `WorkbenchDocumentHost.readText(path)` returns `Promise<{ text: string; version: string }>`.
- `WorkbenchDocumentHost.replaceText(path, expectedVersion, nextText)` rejects stale edits and returns `Promise<{ text: string; version: string }>`; `NodeFileDocumentHost` implements it for CLI/Electron, and the VS Code adapter uses `TextDocument.version`.
- `ArchDesignSession.open(path)` and `SimulationTaskSession.open(path)` initialize host-independent state; each exposes `handle(command: WebviewCommand): Promise<void>` and `onEvent(listener: (event: HostEvent) => void): () => void` for publishing existing host events. `SimulationTaskSession.run(signal?)` starts a run with an optional abort signal.
- `runSimulationTask(prepared, backend, options)` accepts `PreparedSimulationTask`, `SimulatorBackend`, and `{ signal?, artifactDirectory? }`, then returns `Promise<SimulationExecution>` without importing VS Code or Electron.

- [ ] **Step 1: Add stale-write and task-cancellation service tests**

In `workbench.test.ts`, create a temporary `.ad` file, read its snapshot through `NodeFileDocumentHost`, change the file externally, and assert that `replaceText` with the earlier version rejects without overwriting the external content. For task cancellation, inject a backend spy into `SimulationTaskSession`, start `run`, abort its `AbortController`, and assert that the same signal reaches `compileAndRun` and the session publishes the stopped state.

- [ ] **Step 2: Run focused hdl-runtime tests and confirm failures**

Run: `npm test --workspace @veriflow/hdl-runtime`
Expected: FAIL because the workbench protocol and services do not exist.

- [ ] **Step 3: Move protocol definitions and implement versioned host services**

Move `WebviewCommand`, `HostEvent`, and `parseWebviewCommand` into `hdl-runtime/src/workbench/protocol.ts`; keep `schematic-webview/src/shared/protocol.ts` as a compatibility re-export. Add `./workbench/*` to `hdl-runtime` exports and `typesVersions`. Implement `NodeFileDocumentHost` with content-hash versions and compare-before-replace behavior. Implement the sessions with existing `schematic-core`, `simulationTask`, and `simulationTaskWorkspace` functions. Accept definition resolution, backend selection, wave opening, and notification as injected host callbacks. Extract `runSimulationTask` from CLI `runTask` while keeping CLI output and exit-code handling in the CLI command.

- [ ] **Step 4: Adapt the VS Code providers to the shared service**

Keep `vscode.TextDocument`, diagnostics collections, command execution, workspace watchers, and UI panels inside `veriflow-vscode`. Delegate revision-checked edits, projection updates, task run state, and cancellation to the shared service. Keep `parseWebviewCommand` behavior compatible.

- [ ] **Step 5: Run shared and VS Code editor tests**

Run: `npm test --workspace @veriflow/hdl-runtime`, `npm run test:schematic-integration --workspace veriflow-vscode`, and `npm test --workspace veriflow-vscode`.
Expected: PASS for stale document protection, graph refresh, layout saves, task validation, cancel, and opening a generated waveform.

- [ ] **Step 6: Commit host-neutral workbench services**

```bash
git add packages/hdl-runtime/src/workbench/protocol.ts packages/hdl-runtime/src/workbench/documentHost.ts packages/hdl-runtime/src/workbench/archDesignSession.ts packages/hdl-runtime/src/workbench/simulationTaskSession.ts packages/hdl-runtime/src/workbench/simulationTaskRunner.ts packages/hdl-runtime/src/index.ts packages/hdl-runtime/package.json packages/hdl-runtime/test/workbench.test.ts packages/schematic-webview/src/shared/protocol.ts veriflow-vscode/src/archDesign/archDesignEditorProvider.ts veriflow-vscode/src/simulationTask/taskEditorProvider.ts veriflow-vscode/src/simulationTask/taskController.ts
git commit -m "refactor: share host-neutral workbench services"
```

### Task 8: Add the Electron Arch Design Window and `arch ui`

**Files:**
- Create: `packages/waveform-desktop/src/schematicEditor.ts`
- Modify: `packages/waveform-desktop/src/main.ts`
- Modify: `packages/waveform-desktop/src/launcher.ts`
- Modify: `packages/waveform-desktop/src/preload.ts`
- Modify: `packages/waveform-desktop/src/ipc.ts`
- Create: `packages/cli/src/commands/editor.ts`
- Modify: `packages/waveform-desktop/test/desktopHost.test.ts`
- Modify: `packages/waveform-desktop/test/launcher.test.ts`
- Create: `packages/cli/src/runtime/nodeWorkbenchEditorLauncher.ts`
- Modify: `packages/cli/src/commands/ad.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/test/unifiedCommands.test.ts`

**Interfaces:**
- `WorkbenchEditorLauncher.openArch(path: string, options: { project?: string; lib?: string[] }): Promise<void>` starts the shared Electron schematic window with `kind: 'arch-design'`.
- `openArch(designPath, options)` accepts `options: { project?: string; lib?: string[] }`; `openTask(taskPath, options)` added in Task 9 accepts `{ project?: string }`.
- The same window route is reserved for `kind: 'simulation-task'` in Task 9, so `.ad` and `.st` continue to use the same renderer and shell.
- `veriflow arch ui <design.ad>` accepts `--project`, `--lib`, and opens the shared schematic renderer.
- The Electron renderer receives only the shared typed transport from preload; main-process commands use `ArchDesignSession` and Node filesystem services.

- [ ] **Step 1: Add failing CLI registration and launcher tests**

Assert `runCli(['arch', 'ui', 'top.ad'], env)` calls `openArch` with the resolved path and returns zero. Assert `arch ui --help` lists the `.ad` positional argument and `--project` / `--lib` options.

- [ ] **Step 2: Run the focused CLI tests and confirm they fail**

Run: `npm test --workspace @veriflow/cli -- --test-name-pattern="arch ui"`
Expected: FAIL because `arch ui` and `WorkbenchEditorLauncher` are not registered.

- [ ] **Step 3: Implement the Electron route and Node document adapter**

Add the `--schematic-editor <path> --kind arch-design` arguments, create a sandboxed window, load `assets/schematic/index.html`, and bridge protocol messages through preload/IPC. Implement the `WorkbenchEditorLauncher` interface and `NodeFileDocumentHost` adapter; use `ArchDesignSession` for edits, validation, export, and build.

- [ ] **Step 4: Register `veriflow arch ui`**

Add `workbenchEditorLauncher` to `CliEnvironment`, implement `NodeWorkbenchEditorLauncher.openArch`, register the `arch ui` leaf command, and add `ui` to `arch` parent help/actions. Keep existing `arch new/apply/validate/export/build` behavior unchanged.

- [ ] **Step 5: Run CLI and desktop tests**

Run: `npm test --workspace @veriflow/cli -- --test-name-pattern="arch ui"` and `npm test --workspace @veriflow/waveform-desktop -- --test-name-pattern="Arch Design window"`.
Expected: PASS for command argument forwarding, Electron load, source refresh, edit/save, and export/build actions.

- [ ] **Step 6: Commit Arch Design CLI hosting**

```bash
git add packages/waveform-desktop/src/schematicEditor.ts packages/waveform-desktop/src/main.ts packages/waveform-desktop/src/launcher.ts packages/waveform-desktop/src/preload.ts packages/waveform-desktop/src/ipc.ts packages/waveform-desktop/test/desktopHost.test.ts packages/waveform-desktop/test/launcher.test.ts packages/cli/src/commands/editor.ts packages/cli/src/runtime/nodeWorkbenchEditorLauncher.ts packages/cli/src/commands/ad.ts packages/cli/src/main.ts packages/cli/test/unifiedCommands.test.ts
git commit -m "feat: launch Arch Design editor from CLI"
```

### Task 9: Add the Electron Simulation Task Window and `task ui`

**Files:**
- Modify: `packages/waveform-desktop/src/main.ts`
- Modify: `packages/waveform-desktop/src/schematicEditor.ts`
- Modify: `packages/waveform-desktop/src/launcher.ts`
- Modify: `packages/waveform-desktop/src/preload.ts`
- Modify: `packages/waveform-desktop/src/ipc.ts`
- Modify: `packages/waveform-desktop/test/desktopHost.test.ts`
- Modify: `packages/waveform-desktop/test/launcher.test.ts`
- Modify: `packages/cli/src/runtime/nodeWorkbenchEditorLauncher.ts`
- Modify: `packages/cli/src/commands/editor.ts`
- Modify: `packages/cli/src/commands/task.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/test/unifiedCommands.test.ts`
- Modify: `packages/cli/test/taskCommand.test.ts`

**Interfaces:**
- `WorkbenchEditorLauncher.openTask(taskPath, options)` starts the same Electron schematic window with `kind: 'simulation-task'`.
- `openTask(taskPath: string, options: { project?: string }): Promise<void>` is added to the shared launcher interface and Node adapter.
- `veriflow task ui <task.st>` accepts `--project` and opens the shared `.st` editor.
- `SimulationTaskSession` uses injected definition lookup, task run/generate/cancel, and waveform launch callbacks; `runSimulationTask` uses the same preparation, backend, cancellation, and artifact rules as `veriflow task run`.

- [ ] **Step 1: Add failing task UI command tests**

Assert `runCli(['task', 'ui', 'simulation.st', '--project', 'project.json'], env)` calls `openTask` with absolute task/project paths. Assert missing task paths and unsupported extensions return a CLI error without opening Electron.

- [ ] **Step 2: Run the focused CLI tests and confirm they fail**

Run: `npm test --workspace @veriflow/cli -- --test-name-pattern="task ui"`
Expected: FAIL because the task UI handler and launcher method do not exist.

- [ ] **Step 3: Implement the Electron task host**

Extend the shared `--schematic-editor` route to accept `kind: 'simulation-task'`; do not create a second renderer window. Use `SimulationTaskSession` for document changes, call `runSimulationTask` with the configured simulator backend, publish running/completed/failed states, and abort the active `AbortController` on cancel or window close. Open generated VCD output using the existing `launchWaveformWindow` route.

- [ ] **Step 4: Register `veriflow task ui` and share execution logic**

Add `openTask` to `NodeWorkbenchEditorLauncher`, add `taskUi` to the CLI command table and task parent actions, and refactor `runTask` to use the shared `runSimulationTask` implementation so CLI and Electron use the same staging, artifact ownership, cleanup, and cancellation behavior.

- [ ] **Step 5: Verify task lifecycle and CLI compatibility**

Run: `npm test --workspace @veriflow/hdl-runtime`, `npm test --workspace @veriflow/cli -- --test-name-pattern="task ui|task run"`, and `npm test --workspace @veriflow/waveform-desktop -- --test-name-pattern="Simulation Task window"`.
Expected: PASS for generate, run, cancel, failure state, and opening a produced waveform; existing `task run` command output and exit codes remain unchanged.

- [ ] **Step 6: Commit Simulation Task CLI hosting**

```bash
git add packages/waveform-desktop/src/main.ts packages/waveform-desktop/src/schematicEditor.ts packages/waveform-desktop/src/launcher.ts packages/waveform-desktop/src/preload.ts packages/waveform-desktop/src/ipc.ts packages/waveform-desktop/test/desktopHost.test.ts packages/waveform-desktop/test/launcher.test.ts packages/cli/src/runtime/nodeWorkbenchEditorLauncher.ts packages/cli/src/commands/editor.ts packages/cli/src/commands/task.ts packages/cli/src/main.ts packages/cli/test/unifiedCommands.test.ts packages/cli/test/taskCommand.test.ts
git commit -m "feat: launch Simulation Task editor from CLI"
```

### Task 10: Run Cross-Host Acceptance and Packaging Checks

**Files:**
- Modify: `packages/waveform-desktop/test/desktopHost.test.ts`
- Modify: `packages/waveform-desktop/test/boardEditorHost.test.ts`
- Modify: `veriflow-vscode/src/test/schematicIntegration.test.ts`
- Modify: `veriflow-vscode/src/test/vsixPackaging.test.ts`
- Modify: `docs/architecture.md`

**Interfaces:**
- VS Code and Electron load the same canonical `web-dist` bundles.
- CLI usage documents `veriflow arch ui <design.ad>` and `veriflow task ui <task.st>` alongside existing `wave`, `board ui`, and `pins ui` commands.

- [ ] **Step 1: Add final cross-host acceptance checks**

Exercise `.ad` edit/save/build, `.st` edit/generate/run/cancel/open-wave, waveform selection/cursor/fill, and constraints board/template/binding/export flows in the existing Playwright Electron tests. Keep VS Code protocol integration tests asserting the same host messages.

- [ ] **Step 2: Run targeted tests before the full suite**

Run: `npm test --workspace @veriflow/schematic-webview`, `npm test --workspace @veriflow/waveform-desktop`, `npm test --workspace @veriflow/cli`, `npm run test:schematic-integration --workspace veriflow-vscode`, and `npm run test:vsix --workspace veriflow-vscode`.
Expected: PASS for all webview, host, CLI, and package asset checks.

- [ ] **Step 3: Update user-facing CLI and workbench documentation**

Add the two CLI UI command forms to `docs/architecture.md`; existing pin-binding documentation already states that CLI and VS Code share the constraints frontend.

- [ ] **Step 4: Run clean product builds and all workspace tests**

Run: `npm run build`, `npm run build:cli`, and `npm test`.
Expected: PASS. Inspect both `.ad` and `.st` Electron windows and all three VS Code webviews with the supported dark/light/high-contrast theme variables; confirm no generated asset or schema version changes outside the planned bundles.

- [ ] **Step 5: Commit final docs and acceptance checks**

```bash
git add packages/waveform-desktop/test/desktopHost.test.ts packages/waveform-desktop/test/boardEditorHost.test.ts veriflow-vscode/src/test/schematicIntegration.test.ts veriflow-vscode/src/test/vsixPackaging.test.ts docs/architecture.md
git commit -m "test: verify shared workbenches across hosts"
```

---

## Plan Self-Review

- The design's shared TypeScript UI, X6 schematic shell, Canvas waveform fill, constraints cleanup, and VS Code/Electron asset sharing each have implementation and verification tasks.
- Existing `wave`, `board ui`, and `pins ui` launch paths stay covered; `arch ui` and `task ui` have CLI registration, host-window, and workflow checks.
- Shared document revisions and Simulation Task execution/cancellation live in `hdl-runtime`; VS Code and Electron integrations use the same protocol and service contracts.
- Each renderer conversion has a build path before its host test, and the final acceptance task covers both hosts and the required package asset checks.
- Existing data formats, commands, waveform Qt transport, board/pin launchers, and product release behavior are called out as constraints.
- Each commit stages only files named in its task.
- No Schema or existing package version changes are planned; no release artifact is produced or published.
