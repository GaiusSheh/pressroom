# Pressroom

多站点、逐篇、零 frontmatter 的 Obsidian 发布插件：右键把单篇笔记发布到一个或多个 Quartz 5 站点（GitHub 仓库），带管理面板。

> 开发中，尚未发布。

## 开发

npm 命令请在 PowerShell 中运行（Git Bash 下 npm 安装脚本会失败）。

```powershell
npm install
npm run dev     # 监听构建
npm run build   # 类型检查 + 生产构建
npm test        # 单元测试
npm run lint
```

- 源码：`src/`；核心逻辑在 `src/core/`，不依赖 `obsidian` 包。
- 单元测试：`.dev/unit-tests/`（vitest）。
- 开发用测试 vault：`.dev/unit-tests/test-vault/`。在根目录 `.env.local` 写入 `PRESSROOM_VAULT=<vault 绝对路径>`，构建后产物会自动复制到该 vault 的插件目录。

## 许可证

MIT
