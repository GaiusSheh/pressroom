// Phase 0-2 / 0-3：在本地 Quartz 5 测试站实测链接解析与 aliases 重定向
// 用法（PowerShell）：node link-resolution.mjs C:\tmp\pressroom-quartz-test
// 依次以 shortest / relative / absolute 构建，输出 posts/source 页中每条链接的 href 与是否指向存在的页面
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const site = process.argv[2]
if (!site) throw new Error("需要传入 Quartz 测试站目录，实际为空")
const content = path.join(site, "content")
const pub = path.join(site, "public")

// 测试内容：站内路径刻意与「vault 名」不同、含中文、空格、同名文件、特殊字符
const files = {
  "笔记/数学/示例 标题.md": "---\ntitle: 示例标题（数学）\n---\n\n## 第一节 Section A\n\n正文。 ^blk1\n",
  "笔记/物理/示例 标题.md": "---\ntitle: 示例标题（物理）\n---\n\n同名不同目录。\n",
  "笔记/笔记.md": "---\ntitle: 文件夹笔记\n---\n\n folder note。\n",
  "A&B 100%.md": "---\ntitle: 特殊字符\n---\n\n特殊字符页。\n",
  "perm.md": "---\ntitle: permalink 页\npermalink: custom/永久\n---\n\npermalink 测试。\n",
  "moved.md": '---\ntitle: 已移动\naliases:\n  - "old/旧 位置"\n  - old-loc\n---\n\n挪动后的页面。\n',
  "posts/source.md": [
    "---\ntitle: source\n---\n",
    "- L01 [[笔记/数学/示例 标题]]",
    "- L02 [[笔记/数学/示例 标题#第一节 Section A|锚点]]",
    "- L03 [[笔记/数学/示例 标题#^blk1|块]]",
    "- L04 [t](笔记/数学/示例%20标题.md)",
    "- L05 [t](/笔记/数学/示例%20标题.md)",
    "- L06 [t](../笔记/数学/示例%20标题.md)",
    "- L07 [t](<笔记/数学/示例 标题.md>)",
    "- L08 [[示例 标题]]",
    "- L09 [t](笔记/数学/示例%20标题.md#第一节%20Section%20A)",
    "- L10 [[A&B 100%]]",
    "- L11 [[笔记/笔记]]",
    "- L12 [[old-loc]]",
    "- L13 [t](/笔记/数学/示例-标题)",
    "",
  ].join("\n"),
}

function writeContent() {
  fs.rmSync(content, { recursive: true, force: true })
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(content, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body, "utf-8")
  }
}

function setStrategy(strategy) {
  const cfg = path.join(site, "quartz.config.yaml")
  const text = fs.readFileSync(cfg, "utf-8")
  const next = text.replace(/markdownLinkResolution: \w+/, `markdownLinkResolution: ${strategy}`)
  if (next === text && !text.includes(`markdownLinkResolution: ${strategy}`))
    throw new Error(`未找到 markdownLinkResolution 配置项，期望可替换为 ${strategy}`)
  fs.writeFileSync(cfg, next, "utf-8")
}

function extractLinks() {
  const html = fs.readFileSync(path.join(pub, "posts", "source.html"), "utf-8")
  const out = []
  // 每个 li 以 Lxx 开头，取其中第一个 <a href>
  for (const m of html.matchAll(/<li>\s*(L\d\d)\s*(.*?)<\/li>/gs)) {
    const a = m[2].match(/<a href="([^"]*)"[^>]*class="([^"]*)"/)
    if (!a) {
      out.push({ id: m[1], href: "(纯文本，无链接)", exists: "-" })
      continue
    }
    const href = a[1]
    const [p] = href.split("#")
    const target = path.posix.normalize(path.posix.join("posts", decodeURIComponent(p)))
    const candidates = [target + ".html", path.posix.join(target, "index.html")]
    const exists = candidates.some((c) => fs.existsSync(path.join(pub, c)))
    out.push({ id: m[1], href, resolved: target, exists })
  }
  return out
}

writeContent()
const report = {}
for (const strategy of ["shortest", "relative", "absolute"]) {
  setStrategy(strategy)
  execSync("npx quartz build -d content -o public", { cwd: site, stdio: "pipe" })
  report[strategy] = extractLinks()
}
setStrategy("shortest")

// slug 与 aliases / permalink 的实际产物
const listPub = (dir, base = "") =>
  fs.readdirSync(path.join(pub, base), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listPub(dir, path.posix.join(base, d.name)) : [path.posix.join(base, d.name)],
  )
report.emitted = listPub(pub).filter((f) => f.endsWith(".html") && !f.startsWith("tags/"))
for (const f of ["old/旧-位置.html", "old-loc.html", "custom/永久.html", "perm.html"]) {
  const p = path.join(pub, f)
  report[`file:${f}`] = fs.existsSync(p)
    ? (fs.readFileSync(p, "utf-8").match(/http-equiv="refresh"[^>]*>/)?.[0] ?? "存在（非重定向页）")
    : "不存在"
}
console.log(JSON.stringify(report, null, 2))
