# 已知坑

## Git Bash 中 npm 安装脚本失败

- **现象**：在 Git Bash 里运行 `npm ci`，带 install 脚本的依赖（esbuild、@parcel/watcher）报 `ERR_INVALID_ARG_TYPE: The "file" argument must be of type string. Received undefined`。
- **根因**：Git Bash 环境缺少 `ComSpec`，npm 起不了 shell。
- **解法**：npm / npx 一律在 PowerShell 中运行。

## 控制台输出中文

- PowerShell 下 Node 脚本输出中文时，先 `Out-File -Encoding utf8` 写文件再用 `Get-Content -Encoding UTF8` 读，避免控制台编码造成误判。
