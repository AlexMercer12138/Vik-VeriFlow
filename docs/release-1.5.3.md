# 1.5.3 本地发布产物

本版本包含 ST 编辑与导出性能优化、AD/ST 校验及属性栏一致性、自定义 HDL 模板、五列格式化与语义分组空行。

使用 Node.js 24.14.1，先执行 `npm ci`，再从仓库根目录运行：

```bash
npm run release -- --all 1.5.3
```

VSIX 位于 `veriflow-vscode/veriflow-1.5.3.vsix`；8 个公开 npm 包的 tarball 位于 `dist/npm/`。这些产物仅在本地准备，不随 Git 提交，不创建 GitHub Release。

## 本地验证记录

- 锁定依赖安装、共享包类型检查和完整共享测试通过；包含 121 个 HDL runtime 测试、404 个 schematic core 测试。
- CLI 176 项、桌面波形器 29 项、扩展 60 个测试文件（含 VSIX 检查）通过。
- 发布脚本测试和 npm tarball 安装冒烟测试、生成资源一致性检查通过。
- 完整流水线在扩展构建复制运行时目录时遇到一次 Windows `EPERM` 重命名错误；重试扩展检查通过，随后按原顺序完成剩余检查并用 `npm run release -- --package` 继续打包。
- 格式化 fixture 的结尾空行改由测试显式拼接，保持预期输出不变并消除 Git 空白检查告警。
- 详细日志保存在 `.artifacts/release-1.5.3*.log`，不纳入 Git。

## 所有者手动发布

如需发布 npm，在仓库根目录的 Bash 中执行下列单条命令，任何包失败都会停止后续发布：

```bash
(
  release_version='1.5.3'
  for release_package in flow-core hdl-core schematic-core hdl-runtime waveform-runtime simulator-iverilog-wasm waveform-desktop cli; do
    npm publish "dist/npm/veriflow-${release_package}-${release_version}.tgz" --access public || exit $?
  done
)
```

如需发布 Marketplace，上传已经构建的 VSIX：

```bash
npm exec -- vsce publish --packagePath veriflow-vscode/veriflow-1.5.3.vsix
```

本次请求仅授权 Git 主线推送和本地产物准备，不执行上述两个发布命令。发布后可用 `npm view @veriflow/cli version` 与 Marketplace 页面分别核对版本。
