// Phase 2-6：把测试仓库某个提交的 content/ 拉到本地 Quartz 测试站构建，检查插件发布的实际网页效果
// 用法（PowerShell，在 Pressroom 根目录）：node .dev/tests/phase2/quartz/sandbox-build.mjs C:\tmp\pressroom-quartz-test <commit-sha> [不应出现的文字...]
// 仓库名从 .dev/tests/phase0/github/.env.local 的 GH_REPO 读取（不入库），token 用 gh auth token
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const [site, sha, ...forbidden] = process.argv.slice(2);
if (!site || !sha) throw new Error('用法：sandbox-build.mjs <Quartz 测试站目录> <commit-sha> [不应出现的文字...]');
const env = fs.readFileSync('.dev/tests/phase0/github/.env.local', 'utf-8');
const repo = /^GH_REPO=(.+)$/m.exec(env)?.[1]?.trim();
if (!repo) throw new Error('.env.local 中没有 GH_REPO');
const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
const api = async (p) => {
	const res = await fetch(`https://api.github.com/repos/${repo}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
	if (!res.ok) throw new Error(`GET ${p} 期望 2xx，实际 ${res.status}`);
	return res.json();
};

const content = path.join(site, 'content');
const pub = path.join(site, 'public');
fs.rmSync(content, { recursive: true, force: true });

// 下载该提交 content/ 下的全部文件
// /commits/{ref} 接受短 sha（/git/commits 只接受完整 sha）
const commit = await api(`/commits/${sha}`);
const tree = await api(`/git/trees/${commit.commit.tree.sha}?recursive=1`);
const files = tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith('content/'));
for (const f of files) {
	const blob = await api(`/git/blobs/${f.sha}`);
	const target = path.join(content, f.path.slice('content/'.length));
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, Buffer.from(blob.content, 'base64'));
}
console.log(`下载 ${files.length} 个文件：${files.map((f) => f.path).join('、')}`);

const cfg = path.join(site, 'quartz.config.yaml');
const strategy = /markdownLinkResolution: (\w+)/.exec(fs.readFileSync(cfg, 'utf-8'))?.[1];
console.log(`Quartz 链接策略：${strategy}`);
execSync('npx quartz build -d content -o public', { cwd: site, stdio: 'pipe' });

// 用 Quartz 的 slug 规则定位页面：直接从 public 中按 .md 文件对应的 html 查找
const { slugifyFilePath } = await import(new URL(`file:///${path.join(site, 'node_modules/@quartz-community/utils/dist/path.js').replace(/\\/g, '/')}`).href);
let failures = 0;
const fail = (msg) => {
	failures++;
	console.log(`✗ ${msg}`);
};
for (const f of files.filter((x) => x.path.endsWith('.md'))) {
	const rel = f.path.slice('content/'.length);
	const slug = slugifyFilePath(rel);
	const htmlPath = path.join(pub, `${slug}.html`);
	if (!fs.existsSync(htmlPath)) {
		fail(`${rel}：页面 ${slug}.html 不存在`);
		continue;
	}
	const html = fs.readFileSync(htmlPath, 'utf-8');
	// 只检查正文区域内的链接与图片（导航、目录等由 Quartz 生成，不在检查范围）
	const article = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? '';
	const refs = [...article.matchAll(/<(a|img)\b[^>]*?(href|src)="([^"]+)"/g)].map((m) => ({ tag: m[1], url: m[3] }));
	let checked = 0;
	for (const { tag, url } of refs) {
		if (/^(https?:|mailto:|#)/.test(url)) continue;
		const [p, hash] = url.split('#');
		const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(slug), decodeURIComponent(p)));
		const candidates = tag === 'img' ? [resolved] : [`${resolved}.html`, path.posix.join(resolved, 'index.html'), resolved];
		const hit = candidates.find((c) => fs.existsSync(path.join(pub, c)));
		checked++;
		if (!hit) {
			fail(`${rel}：<${tag}> ${url} → ${resolved} 不存在`);
			continue;
		}
		if (hash && hit.endsWith('.html') && !fs.readFileSync(path.join(pub, hit), 'utf-8').includes(`id="${decodeURIComponent(hash)}"`)) {
			fail(`${rel}：${url} 的锚点 #${decodeURIComponent(hash)} 在目标页面中不存在`);
		}
	}
	for (const word of forbidden) {
		if (html.includes(word)) fail(`${rel}：页面中出现了不应发布的文字「${word}」`);
	}
	console.log(`✓ ${rel} → ${slug}.html，正文中 ${checked} 个站内链接 / 图片已检查`);
}
console.log(failures ? `\n失败 ${failures} 项` : '\n全部通过');
process.exit(failures ? 1 : 0);
