// Phase 6-2：测量读取一个站点快照的各次请求耗时（与 GitHubBackend.loadSnapshot 相同的请求序列）
// 用法（在 Pressroom 根目录）：node .dev/tests/phase6/snapshot-timing.mjs [分支=main] [次数=3]
// 仓库名读 .dev/tests/phase0/github/.env.local 的 GH_REPO（不入库），token 用 gh auth token
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const [branch = 'main', times = '3'] = process.argv.slice(2);
const env = fs.readFileSync('.dev/tests/phase0/github/.env.local', 'utf-8');
const repo = /^GH_REPO=(.+)$/m.exec(env)?.[1]?.trim();
if (!repo) throw new Error('.env.local 中没有 GH_REPO');
const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();

async function get(path, fresh) {
	const t0 = performance.now();
	const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(fresh ? { 'Cache-Control': 'no-cache' } : {}) },
	});
	if (!res.ok) throw new Error(`GET ${path} 期望 2xx，实际 ${res.status}`);
	const json = await res.json();
	return { json, ms: Math.round(performance.now() - t0) };
}

for (let i = 0; i < Number(times); i++) {
	const t0 = performance.now();
	const ref = await get(`/git/ref/heads/${branch}`, true);
	const commit = await get(`/git/commits/${ref.json.object.sha}`);
	const tree = await get(`/git/trees/${commit.json.tree.sha}?recursive=1`);
	const wanted = tree.json.tree.filter((e) => e.path === '.pressroom/manifest.json' || e.path === 'quartz.config.yaml');
	const blobs = await Promise.all(wanted.map((e) => get(`/git/blobs/${e.sha}`)));
	const total = Math.round(performance.now() - t0);
	console.log(
		`第 ${i + 1} 次：ref ${ref.ms} ms，commit ${commit.ms} ms，tree ${tree.ms} ms（${tree.json.tree.length} 项），blob ${blobs.map((b) => b.ms).join(' / ') || '无'} ms，合计 ${total} ms`,
	);
}
