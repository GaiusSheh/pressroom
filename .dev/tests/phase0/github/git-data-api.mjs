// Phase 0-5：在一次性测试仓库验证 GitHub Git Data API
// 用法：node git-data-api.mjs [--fine]
//   默认使用 gh auth token；--fine 使用 .env.local 中的 GH_TOKEN_FINE（验证最小权限）
// 仓库名只从 .env.local 读取，输出中不打印仓库名
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(here, ".env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
)
const useFine = process.argv.includes("--fine")
const token = useFine ? env.GH_TOKEN_FINE : execSync("gh auth token", { encoding: "utf-8" }).trim()
if (!token) throw new Error(`token 为空：期望 ${useFine ? "GH_TOKEN_FINE 已填写" : "gh 已登录"}`)
const repo = env.GH_REPO
const branch = env.GH_BRANCH || "main"
if (!repo) throw new Error("GH_REPO 为空，期望形如 owner/repo")

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`)
}

async function gh(method, url, body, { allowError = false } = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok && !allowError)
    throw new Error(`${method} ${url} 期望 2xx，实际 ${res.status}: ${json.message ?? ""}`)
  return { status: res.status, json }
}

// git blob SHA = sha1("blob <字节长度>\0" + 内容)
const blobSha = (buf) =>
  crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex")

async function createBlob(buf) {
  const { json } = await gh("POST", "/git/blobs", { content: buf.toString("base64"), encoding: "base64" })
  return json.sha
}

async function headCommit() {
  const { json: ref } = await gh("GET", `/git/ref/heads/${branch}`)
  const { json: commit } = await gh("GET", `/git/commits/${ref.object.sha}`)
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha }
}

// 一次提交：tree 条目 sha 为 null 表示删除
async function commitTree(entries, message, parent) {
  const { json: tree } = await gh("POST", "/git/trees", { base_tree: parent.treeSha, tree: entries })
  const { json: commit } = await gh("POST", "/git/commits", { message, tree: tree.sha, parents: [parent.commitSha] })
  return commit.sha
}

const run = Date.now().toString(36)
const dir = `content/phase0-${run}`

// 测试内容：中文 LF、CRLF、二进制
const files = {
  [`${dir}/中文 笔记.md`]: Buffer.from("---\ntitle: 中文\n---\n\n正文，含全角标点。\n", "utf-8"),
  [`${dir}/crlf.md`]: Buffer.from("line1\r\nline2\r\n", "utf-8"),
  [`assets/phase0-${run}.bin`]: crypto.randomBytes(2048),
  [`.pressroom/phase0-${run}.json`]: Buffer.from(JSON.stringify({ version: 1, notes: [] }, null, 2), "utf-8"),
}

console.log(`token 来源：${useFine ? "fine-grained (GH_TOKEN_FINE)" : "gh auth token"}`)

// 1. 建 blob，比对本地 SHA
const shas = {}
for (const [p, buf] of Object.entries(files)) {
  const remote = await createBlob(buf)
  shas[p] = remote
  check(`blob SHA 一致：${path.posix.basename(p)}`, remote === blobSha(buf), remote.slice(0, 10))
}

// 2. 提交 1：新增 4 个文件
const base = await headCommit()
const c1 = await commitTree(
  Object.keys(files).map((p) => ({ path: p, mode: "100644", type: "blob", sha: shas[p] })),
  `phase0 ${run}: add`,
  base,
)
await gh("PATCH", `/git/refs/heads/${branch}`, { sha: c1, force: false })
check("提交 1（新增 4 个文件）并更新 ref", true, c1.slice(0, 10))

// 3. 提交 2：一次内完成 修改 + 删除 + 新增 + 挪动（复用原 blob）
const after1 = await headCommit()
const modified = Buffer.from("---\ntitle: 中文\n---\n\n修改后的正文。\n", "utf-8")
const modSha = await createBlob(modified)
const added = Buffer.from("新文件\n", "utf-8")
const addSha = await createBlob(added)
const movedFrom = `${dir}/crlf.md`
const movedTo = `${dir}/sub/挪动后.md`
const c2 = await commitTree(
  [
    { path: `${dir}/中文 笔记.md`, mode: "100644", type: "blob", sha: modSha },
    { path: movedFrom, mode: "100644", type: "blob", sha: null },
    { path: movedTo, mode: "100644", type: "blob", sha: shas[movedFrom] },
    { path: `${dir}/新增.md`, mode: "100644", type: "blob", sha: addSha },
  ],
  `phase0 ${run}: modify + delete + add + move`,
  after1,
)
await gh("PATCH", `/git/refs/heads/${branch}`, { sha: c2, force: false })
const { json: cmp } = await gh("GET", `/compare/${c1}...${c2}`)
const statuses = Object.fromEntries(cmp.files.map((f) => [f.filename, f.status]))
check("提交 2 只产生 1 个 commit", cmp.total_commits === 1, `total_commits=${cmp.total_commits}`)
check("提交 2 含修改", statuses[`${dir}/中文 笔记.md`] === "modified")
check("提交 2 含新增", statuses[`${dir}/新增.md`] === "added")
check(
  "提交 2 挪动被识别为 renamed（复用 blob）",
  statuses[movedTo] === "renamed",
  `status=${statuses[movedTo]}`,
)

// 4. 读 tree（recursive）比对 blob SHA —— 「有修改」判定方案
const { json: tree } = await gh("GET", `/git/trees/${c2}?recursive=1`)
const remoteMap = Object.fromEntries(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]))
check("tree 中修改后文件 SHA = 本地计算", remoteMap[`${dir}/中文 笔记.md`] === blobSha(modified))
check("tree 中挪动后文件 SHA = 原 blob", remoteMap[movedTo] === blobSha(files[movedFrom]))
check("tree 中已删除文件不存在", !(movedFrom in remoteMap))
check("recursive tree 未被截断", tree.truncated === false, `entries=${tree.tree.length}`)

// 5. 读回中文内容，确认编码往返
const { json: blob } = await gh("GET", `/git/blobs/${remoteMap[`${dir}/中文 笔记.md`]}`)
check("中文内容往返一致", Buffer.from(blob.content, "base64").equals(modified))

// 6. 非 fast-forward：基于过期的 c1 再建提交并尝试更新 ref
const stale = await commitTree(
  [{ path: `${dir}/冲突.md`, mode: "100644", type: "blob", sha: addSha }],
  `phase0 ${run}: stale`,
  after1,
)
const nff = await gh("PATCH", `/git/refs/heads/${branch}`, { sha: stale, force: false }, { allowError: true })
check(
  "过期父提交更新 ref 被拒绝",
  nff.status === 422,
  `status=${nff.status} message=${nff.json.message}`,
)

// 7. 清理：一次提交删除本次产生的全部文件
const after2 = await headCommit()
const toDelete = Object.keys(remoteMap).filter((p) => p.startsWith(dir) || p.includes(`phase0-${run}`))
const c3 = await commitTree(
  toDelete.map((p) => ({ path: p, mode: "100644", type: "blob", sha: null })),
  `phase0 ${run}: cleanup`,
  after2,
)
await gh("PATCH", `/git/refs/heads/${branch}`, { sha: c3, force: false })
check("清理提交完成", true, `删除 ${toDelete.length} 个文件`)

const failed = results.filter((r) => !r.ok)
console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`)
if (failed.length) process.exit(1)
