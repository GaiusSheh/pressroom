// 测试仓库复位：main 只保留基线文件（manifest 只保留对应记录）；确保存在干净的 site2 分支（第二个测试站点用）
// 用法（在 Pressroom 根目录）：node .dev/tests/phase3/sandbox-reset.mjs
// 仓库名读 .dev/tests/phase0/github/.env.local 的 GH_REPO（不入库）；token 用 gh auth token
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/** main 分支保留的文件；manifest 中只保留 sitePath 对应这些内容文件的记录 */
const KEEP = ['README.md', 'content/笔记/数学/示例笔记.md', 'content/assets/示例图.png'];
const MANIFEST = '.pressroom/manifest.json';
const CONTENT_DIR = 'content';
const SITE2_BRANCH = 'site2';

const env = fs.readFileSync('.dev/tests/phase0/github/.env.local', 'utf-8');
const repo = /^GH_REPO=(.+)$/m.exec(env)?.[1]?.trim();
if (!repo) throw new Error('.env.local 中没有 GH_REPO');
const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();

async function api(method, path, body, allow = []) {
	const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'Cache-Control': 'no-cache',
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${path} 期望 2xx，实际 ${res.status}：${json.message ?? ''}`);
	return { status: res.status, json };
}
const blobText = async (sha) => Buffer.from((await api('GET', `/git/blobs/${sha}`)).json.content, 'base64').toString('utf-8');

// —— main ——
const head = (await api('GET', '/git/ref/heads/main')).json.object.sha;
const treeSha = (await api('GET', `/git/commits/${head}`)).json.tree.sha;
const files = (await api('GET', `/git/trees/${treeSha}?recursive=1`)).json.tree.filter((e) => e.type === 'blob');
const entries = [];
for (const f of files) {
	if (f.path === MANIFEST || KEEP.includes(f.path)) continue;
	entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
}
const manifestEntry = files.find((f) => f.path === MANIFEST);
if (manifestEntry) {
	const m = JSON.parse(await blobText(manifestEntry.sha));
	const keptSitePaths = new Set(KEEP.filter((p) => p.startsWith(`${CONTENT_DIR}/`)).map((p) => p.slice(CONTENT_DIR.length + 1)));
	const notes = m.notes.filter((n) => keptSitePaths.has(n.sitePath));
	const used = new Set(notes.flatMap((n) => n.attachments));
	// Phase 4 起 main 的目录模式也复位为手动（Site 1 = 手动站点；Site 2 在 site2 分支上测跟随 vault）
	const next = { ...m, mode: 'manual', notes, attachments: m.attachments.filter((a) => used.has(a.sitePath)) };
	const text = `${JSON.stringify(next, null, 2)}\n`;
	if (text !== (await blobText(manifestEntry.sha))) {
		const blob = (await api('POST', '/git/blobs', { content: Buffer.from(text).toString('base64'), encoding: 'base64' })).json.sha;
		entries.push({ path: MANIFEST, mode: '100644', type: 'blob', sha: blob });
	}
}
if (entries.length === 0) {
	console.log('main 已是基线状态，无需复位');
} else {
	const tree = (await api('POST', '/git/trees', { base_tree: treeSha, tree: entries })).json.sha;
	const commit = (await api('POST', '/git/commits', { message: 'test: 复位测试仓库到基线', tree, parents: [head] })).json.sha;
	await api('PATCH', '/git/refs/heads/main', { sha: commit, force: false });
	console.log(`main 复位提交 ${commit.slice(0, 7)}：删除 / 改写 ${entries.length} 项（${entries.map((e) => e.path).join('、')}）`);
}

// —— site2：只含 README 的独立提交（不能从 main 分出，否则会带上 main 的 manifest）——
const site2 = await api('GET', `/git/ref/heads/${SITE2_BRANCH}`, undefined, [404]);
const readme = files.find((f) => f.path === 'README.md');
const site2Tree = (await api('POST', '/git/trees', { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: readme.sha }] })).json.sha;
const site2Commit = (await api('POST', '/git/commits', { message: 'test: site2 基线（第二个测试站点）', tree: site2Tree, parents: [] })).json.sha;
if (site2.status === 404) {
	await api('POST', '/git/refs', { ref: `refs/heads/${SITE2_BRANCH}`, sha: site2Commit });
	console.log(`创建分支 ${SITE2_BRANCH}：${site2Commit.slice(0, 7)}`);
} else {
	await api('PATCH', `/git/refs/heads/${SITE2_BRANCH}`, { sha: site2Commit, force: true });
	console.log(`复位分支 ${SITE2_BRANCH}：${site2Commit.slice(0, 7)}`);
}
