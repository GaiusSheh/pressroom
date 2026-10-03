// Phase 1-4 补测：formatLink 的实际产物在 Quartz 5 三种 markdownLinkResolution 下是否都指向正确页面与锚点
// 用法（PowerShell，在 Pressroom 根目录）：node .dev/tests/phase1/quartz/format-link-e2e.mjs C:\tmp\pressroom-quartz-test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const site = process.argv[2];
if (!site) throw new Error('需要传入 Quartz 测试站目录，实际为空');
const content = path.join(site, 'content');
const pub = path.join(site, 'public');

// 把 TypeScript 源码打包成 Node 可直接导入的 ESM，调用真实的 formatLink / slugOf
const bundle = path.join(os.tmpdir(), `pressroom-quartz-${Date.now()}.mjs`);
await esbuild.build({
	entryPoints: ['src/core/generator/quartz.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: bundle,
	logLevel: 'silent',
});
const { formatLink, slugOf } = await import(pathToFileURL(bundle).href);

// 目标笔记：中文 + 空格、同名不同目录、特殊字符、括号、文件夹笔记
const targets = {
	'笔记/数学/示例 标题.md': '## 第一节 Section A\n\n正文。 ^blk1\n',
	'笔记/物理/示例 标题.md': '同名不同目录。\n',
	'100% A&B #1.md': '特殊字符。\n',
	'f(x).md': '括号。\n',
	'笔记/笔记.md': '文件夹笔记。\n',
};
// 链接用例：[目标, 锚点]
const linkCases = [
	['笔记/数学/示例 标题.md', undefined],
	['笔记/数学/示例 标题.md', '第一节 Section A'],
	['笔记/数学/示例 标题.md', '^blk1'],
	['笔记/物理/示例 标题.md', undefined],
	['100% A&B #1.md', undefined],
	['f(x).md', undefined],
	['笔记/笔记.md', undefined],
];
// 源笔记放在不同深度，覆盖相对路径计算
const sources = ['root-source.md', 'posts/source.md', '笔记/深/层/source.md'];

function writeContent(strategy) {
	fs.rmSync(content, { recursive: true, force: true });
	const write = (rel, body) => {
		const p = path.join(content, rel);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, body, 'utf-8');
	};
	for (const [rel, body] of Object.entries(targets)) write(rel, `---\ntitle: ${rel}\n---\n\n${body}`);
	for (const from of sources) {
		const lines = linkCases.map(
			([to, anchor], i) => `- L${String(i).padStart(2, '0')} ${formatLink({ from, to, anchor, text: 't', strategy })}`,
		);
		write(from, `---\ntitle: source\n---\n\n${lines.join('\n')}\n`);
	}
}

function setStrategy(strategy) {
	const cfg = path.join(site, 'quartz.config.yaml');
	const text = fs.readFileSync(cfg, 'utf-8');
	if (!/markdownLinkResolution: \w+/.test(text)) throw new Error('quartz.config.yaml 中未找到 markdownLinkResolution');
	fs.writeFileSync(cfg, text.replace(/markdownLinkResolution: \w+/, `markdownLinkResolution: ${strategy}`), 'utf-8');
}

function check(strategy) {
	const failures = [];
	let total = 0;
	for (const from of sources) {
		const fromSlug = slugOf(from);
		const html = fs.readFileSync(path.join(pub, `${fromSlug}.html`), 'utf-8');
		for (const m of html.matchAll(/<li>\s*L(\d\d)\s*(.*?)<\/li>/gs)) {
			total++;
			const [to, anchor] = linkCases[Number(m[1])];
			const href = m[2].match(/<a href="([^"]*)"/)?.[1];
			const label = `${from} → ${to}${anchor ? '#' + anchor : ''}`;
			if (!href) {
				failures.push(`${label}：没有生成链接`);
				continue;
			}
			const [p, hash] = href.split('#');
			const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromSlug), decodeURIComponent(p)));
			const file = resolved.endsWith('/') ? `${resolved}index.html` : `${resolved}.html`;
			// 目标页面文件 = slug + .html（文件夹笔记的 slug 以 /index 结尾，对应 index.html）
			const expectedFile = `${slugOf(to)}.html`;
			if (file !== expectedFile) {
				failures.push(`${label}：href=${href} 指向 ${file}，期望 ${expectedFile}`);
				continue;
			}
			if (!fs.existsSync(path.join(pub, file))) {
				failures.push(`${label}：目标页面 ${file} 不存在`);
				continue;
			}
			if (hash) {
				const id = decodeURIComponent(hash);
				const target = fs.readFileSync(path.join(pub, file), 'utf-8');
				if (!target.includes(`id="${id}"`)) failures.push(`${label}：目标页面中没有 id="${id}"`);
			}
		}
	}
	return { total, failures };
}

let failed = 0;
try {
	for (const strategy of ['shortest', 'absolute', 'relative']) {
		setStrategy(strategy);
		writeContent(strategy);
		execSync('npx quartz build -d content -o public', { cwd: site, stdio: 'pipe' });
		const { total, failures } = check(strategy);
		const expected = sources.length * linkCases.length;
		if (total !== expected) failures.push(`只找到 ${total} 条链接，期望 ${expected} 条`);
		console.log(`${failures.length ? '✗' : '✓'} ${strategy}：${total} 条链接，失败 ${failures.length}`);
		for (const f of failures) console.log(`    ${f}`);
		failed += failures.length;
	}
} finally {
	setStrategy('shortest');
	fs.rmSync(bundle, { force: true });
}
process.exit(failed ? 1 : 0);
