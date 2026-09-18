# 1.5.2 修复与发布候选

本次修复 Simulation Task 快速仿真波形打开与直接导出，并完成开发计划中的 CLI 规范、命令面板整理及可选画布图标主题。大组件方案见 [Simulation Task 组件化设计草案](simulation-components-design.md)。

## 验证状态

环境：Windows，Node.js 24.14.1；已执行 `npm ci`。

- 共享库构建、类型检查、测试通过。
- CLI 测试通过；Node npm 安装包冒烟与发布契约检查通过。
- VS Code 扩展全部 59 个测试文件通过，包含 VSIX 内容检查。后续独立审查补充的任务文件名碰撞与任意扩展名数据输入回归也通过。
- 使用真实内置 Icarus WASM 执行 Simulation Task，确认 VCD 生成、自动打开请求、临时编译目录清理后波形仍存在。
- 生成资源一致性检查通过，本次未改变 schematic Webview 产物。
- **完整发布检查尚未通过**：`npm run release -- --all 1.5.2` 停在两个 desktop AD Inspector 测试。聚焦重跑仍失败；对应测试及 schematic 源码/产物与基线相同。本次产物仅为候选，不表示已满足发布门槛。

失败项：

1. `Arch Design interface pins drive Inspector actions and survive graph refreshes`：选中接口标签的 `getBBox()` 未满足裁剪宽度断言。
2. `Arch Design interface Inspector edits defaults, overrides, and top-level snapshots`：900×640 隐藏测试窗口中 `status-strip` 拦截接口 pin 点击，超时。

本地日志位于 `.artifacts/release-1.5.2.log`、`.artifacts/desktop-inspector-1.5.2.log`、`.artifacts/vscode-1.5.2.log`、`.artifacts/package-checks-1.5.2.log`。本机验证未覆盖 Linux，也未在已安装 VS Code 的真实扩展宿主中手动点击复验。

## 候选产物与手动发布

使用 `npm run release -- --package` 单独准备候选。产物为 `dist/npm/veriflow-{flow-core,hdl-core,schematic-core,hdl-runtime,waveform-runtime,simulator-iverilog-wasm,waveform-desktop,cli}-1.5.2.tgz` 以及 `veriflow-vscode/veriflow-1.5.2.vsix`。

先处理上述测试阻塞，再从仓库根目录重新执行 `npm run release -- --all 1.5.2`。检查全部通过后，由所有者在 Bash 中按依赖顺序发布：

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
