# Repository Instructions

## Routine Release Policy

- Routine releases publish two user-facing products: `@veriflow/cli` on npm and `Verilog Design Flow` on the VS Code Marketplace.
- Do not create a GitHub Release for routine patch or minor releases.
- Never run authenticated `npm publish` or `vsce publish` commands on the repository owner's behalf. Prepare and verify the artifacts, then report the exact commands for the owner to run.
- Use Node.js `24.14.1` or newer and install the locked workspace dependencies with `npm ci` before releasing.

## Prepare A Release

1. Add the target version heading and user-facing changes to `veriflow-vscode/CHANGELOG.md`.
2. Run the complete local release pipeline from the repository root:

   ```bash
   npm run release -- --all <version>
   ```

   This updates every workspace manifest, internal workspace dependency, `package-lock.json`, and CLI version contract; runs the release checks; then builds the npm tarballs and VSIX.

3. Confirm the expected artifacts exist:

   ```text
   dist/npm/veriflow-cli-<version>.tgz
   dist/npm/veriflow-flow-core-<version>.tgz
   dist/npm/veriflow-hdl-core-<version>.tgz
   dist/npm/veriflow-hdl-runtime-<version>.tgz
   dist/npm/veriflow-schematic-core-<version>.tgz
   dist/npm/veriflow-simulator-iverilog-wasm-<version>.tgz
   dist/npm/veriflow-waveform-desktop-<version>.tgz
   dist/npm/veriflow-waveform-runtime-<version>.tgz
   veriflow-vscode/veriflow-<version>.vsix
   ```

## Manual Publication

The CLI has exact-version dependencies on the other public `@veriflow` packages. Provide the owner with this single Bash command, replacing `<version>` with the prepared release version. Run it from the repository root. The loop publishes sequentially in dependency-safe order, with the CLI last; any failure stops the loop and returns the failing exit code without closing the owner's shell.

```bash
(
  release_version='<version>'
  for release_package in flow-core hdl-core schematic-core hdl-runtime waveform-runtime simulator-iverilog-wasm waveform-desktop cli; do
    npm publish "dist/npm/veriflow-${release_package}-${release_version}.tgz" --access public || exit $?
  done
)
```

Publish the already-built VSIX instead of repackaging during the authenticated step:

```bash
npm exec -- vsce publish --packagePath veriflow-vscode/veriflow-<version>.vsix
```

After the owner publishes, verify the registry versions with `npm view @veriflow/cli version` and the Marketplace version separately.

## Optional GitHub Release

`.github/workflows/release.yml` is manual-only and does not run on tags. Its `publish_github_release` input defaults to `false`, so a normal dispatch only builds release candidates. For an intentional major GitHub Release, first push the matching `v<version>` tag, dispatch **Release candidates** on that tag, and explicitly enable `publish_github_release`. The optional GitHub Release contains only the CLI and VSIX as user-facing packages, plus the Icarus corresponding-source archive and checksum required by the distribution process.
