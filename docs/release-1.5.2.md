# 1.5.2 修复记录（正式发布暂缓）

本次修复 Simulation Task 快速仿真波形打开与直接导出，并完成命令面板整理及 `.ad` / `.st` 的统一 JSON 关联；已移除先前多余的自定义图标主题。CLI 入口重设计见 [CLI 设计草案](cli-command-spec.md)，新命令尚未实现。大组件方案见 [Simulation Task 组件化设计草案](simulation-components-design.md)。按所有者要求，正式发布暂缓，待 README 完善；本轮仅准备 GIF 录制用 VSIX，不重新打包 npm 产品。

## 验证状态

环境：Windows，Node.js 24.14.1；已执行 `npm ci`。

- 共享库构建、类型检查、测试通过。
- CLI 测试通过；Node npm 安装包冒烟与发布契约检查通过。
- VS Code 扩展全部 59 个测试文件通过，包含 VSIX 内容检查。后续独立审查补充的任务文件名碰撞与任意扩展名数据输入回归也通过。
- 使用真实内置 Icarus WASM 执行 Simulation Task，确认 VCD 生成、自动打开请求、临时编译目录清理后波形仍存在。
- 前一轮生成资源一致性检查通过；本轮接口字体修复同步更新 schematic Webview 产物。
- 前一轮 `npm run release -- --all 1.5.2` 曾停在两个 desktop AD Inspector 测试。本轮已定位并修复，两项聚焦回归均通过；不重跑正式发布打包流程。
- 本轮 schematic-core 404 项测试、desktop 29 项测试全部通过；schematic-webview 类型检查与测试、生成资源一致性检查通过。
- 本轮扩展 59 个测试文件全部通过（包括隔离 VSIX 打包检查）。Windows 重命名瞬时错误及并行构建引起的隔离检查冲突已通过重建、串行验证排除。
- 后续统一 JSON 关联及移除主题后，重新通过 TypeScript 编译和全部 59 个扩展测试文件，包含隔离 VSIX 打包检查；日志见 `.artifacts/vscode-canvas-association.log`。

原失败项及修复：

1. `Arch Design interface pins drive Inspector actions and survive graph refreshes`：接口标签显示使用 600 字重，测量使用 400，导致裁剪区域不足。测量、截断、渲染现在复用同一字体参数，保留 600 字重与边界断言；新增 aggregate/member 标签的回归。
2. `Arch Design interface Inspector edits defaults, overrides, and top-level snapshots`：900×640 隐藏测试窗口中，固定视口把目标 pin 放到画布底部之外。用例先点击真实的 Fit 按钮，再点击 pin，保留点击命中检查。

本地日志位于 `.artifacts/release-1.5.2.log`、`.artifacts/desktop-inspector-1.5.2.log`、`.artifacts/vscode-1.5.2.log`、`.artifacts/package-checks-1.5.2.log`。本机验证未覆盖 Linux，也未在已安装 VS Code 的真实扩展宿主中手动点击复验。

## 候选产物与手动发布

使用 `npm run release -- --package` 单独准备候选。产物为 `dist/npm/veriflow-{flow-core,hdl-core,schematic-core,hdl-runtime,waveform-runtime,simulator-iverilog-wasm,waveform-desktop,cli}-1.5.2.tgz` 以及 `veriflow-vscode/veriflow-1.5.2.vsix`。

本轮 GIF 录制预览包使用独立文件名 `veriflow-vscode/veriflow-gif-preview.vsix`，清单版本沿用工作区的 1.5.2，不改变版本号。此前的 npm / 版本号命名 VSIX 均为旧候选，不代表本轮修复结果。

以下命令留待 README 完成并确认正式发布时使用：从仓库根目录重新执行 `npm run release -- --all 1.5.2`。检查全部通过后，由所有者在 Bash 中按依赖顺序发布：

```bash
(
  release_version='1.5.2'
  for release_package in flow-core hdl-core schematic-core hdl-runtime waveform-runtime simulator-iverilog-wasm waveform-desktop cli; do
    npm publish "dist/npm/veriflow-${release_package}-${release_version}.tgz" --access public || exit $?
  done
)
```

发布已构建的 VSIX：

```bash
npm exec -- vsce publish --packagePath veriflow-vscode/veriflow-1.5.2.vsix
```

发布后执行 `npm view @veriflow/cli version`，并单独核对 Marketplace 版本。例行补丁不创建 GitHub Release。本次未执行 npm / Marketplace 发布，也未推送 Git 分支。
