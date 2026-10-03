// Phase 0-1：用 Quartz 5 实际使用的 @quartz-community/utils 生成 slug 期望值
// 用法：node slug-cases.mjs C:\tmp\pressroom-quartz-test
// 输出 Markdown 表格，可直接转为 Phase 1 的 vitest 用例
import path from "node:path"
import { pathToFileURL } from "node:url"

const site = process.argv[2]
if (!site) throw new Error("需要传入装好依赖的 Quartz 测试站目录，实际为空")
const mod = path.join(site, "node_modules", "@quartz-community", "utils", "dist", "path.js")
const { slugifyFilePath, simplifySlug, splitAnchor } = await import(pathToFileURL(mod).href)

const cases = [
  ["基础", "note.md"],
  ["大写转小写", "Note.md"],
  ["空格转 -", "my note.md"],
  ["多个空格不合并", "a  b.md"],
  ["制表符等空白", "a\tb.md"],
  ["中文保留", "笔记/数学/示例标题.md"],
  ["中文 + 空格", "笔记/示例 标题.md"],
  ["全角空格（\\s 匹配）", "示例　标题.md"],
  ["全角标点保留", "标题：副标题（一）.md"],
  ["& 转 -and-", "A&B.md"],
  ["% 转 -percent", "100%.md"],
  ["? # 删除", "what?#.md"],
  ['<>:"|* 删除', 'a<b>c:d"e|f*g.md'],
  ["半角括号保留", "f(x).md"],
  ["点号保留", "v1.2 notes.md"],
  ["已有 - 保留", "a-b.md"],
  ["冲突对：空格版", "A B.md"],
  ["冲突对：连字符版", "a-b.md"],
  ["index.md", "folder/index.md"],
  ["_index.md", "folder/_index.md"],
  ["文件夹笔记 folder/folder.md → index", "笔记/笔记.md"],
  ["文件夹笔记大小写不同也折叠", "Notes/notes.md"],
  ["文件夹名也 slug", "My Folder/Sub Dir/x.md"],
  ["开头斜杠去除", "/a/b.md"],
  ["图片保留扩展名", "assets/My Image.png"],
  ["PDF 保留扩展名", "assets/文档 1.pdf"],
  ["无扩展名", "README"],
  ["扩展名大写", "assets/IMG.PNG"],
  ["emoji 保留", "🌱 garden.md"],
  ["日文/韩文保留", "メモ/메모.md"],
]

console.log("| # | 类别 | 输入路径 | slugifyFilePath | simplifySlug |")
console.log("|---|------|---------|-----------------|--------------|")
cases.forEach(([cat, input], i) => {
  const slug = slugifyFilePath(input)
  const shown = JSON.stringify(input).slice(1, -1).replace(/\|/g, "\\|")
  console.log(`| ${i + 1} | ${cat} | \`${shown}\` | \`${slug.replace(/\|/g, "\\|")}\` | \`${simplifySlug(slug)}\` |`)
})

console.log("\n锚点（splitAnchor，github-slugger）：\n")
console.log("| 输入 | 锚点输出 |")
console.log("|------|---------|")
for (const link of ["x#第一节 Section A", "x#^blk1", "x#Hello, World!", "x#A & B", "x#标题：副标题", "x.pdf#page=3"]) {
  console.log(`| \`${link}\` | \`${splitAnchor(link)[1]}\` |`)
}
