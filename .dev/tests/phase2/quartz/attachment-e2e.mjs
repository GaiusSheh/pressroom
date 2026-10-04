// Phase 2 前置验证：附件（图片、PDF）链接在 Quartz 5 三种 markdownLinkResolution 下的实际效果
// 用法（PowerShell，在 Pressroom 根目录）：node .dev/tests/phase2/quartz/attachment-e2e.mjs C:\tmp\pressroom-quartz-test
// 对每种写法输出：是否生成 img / a、指向的文件是否存在于 public/
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

const bundle = path.join(os.tmpdir(), `pressroom-quartz-${Date.now()}.mjs`);
await esbuild.build({ entryPoints: ['src/core/generator/quartz.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' });
const { formatLink, slugOf } = await import(pathToFileURL(bundle).href);

// 1×1 透明 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const attachments = {
	'assets/图 1.png': PNG,
	'assets/My Image.png': PNG,
	'assets/文档 A.pdf': Buffer.from('%PDF-1.4\n%fake\n'),
};
const sources = ['root-source.md', 'posts/source.md', '笔记/深/层/source.md'];

/** 每条用例：[编号说明, 生成 Markdown 的函数(from, strategy), 期望的元素 img|a, 目标附件] */
const cases = [
	['图片：formatLink(slug) 前加 !', (from, s) => '!' + formatLink({ from, to: 'assets/图 1.png', text: '图', strategy: s }), 'img', 'assets/图 1.png'],
	['图片：大写名 formatLink 前加 !', (from, s) => '!' + formatLink({ from, to: 'assets/My Image.png', text: 'x', strategy: s }), 'img', 'assets/My Image.png'],
	['PDF：formatLink(slug)', (from, s) => formatLink({ from, to: 'assets/文档 A.pdf', text: '文档', strategy: s }), 'a', 'assets/文档 A.pdf'],
	['对照：图片原文件名（尖括号）', () => '![图](<assets/图 1.png>)', 'img', 'assets/图 1.png'],
	['对照：图片维基嵌入原名', () => '![[assets/图 1.png]]', 'img', 'assets/图 1.png'],
	['对照：PDF 维基链接原名', () => '[[assets/文档 A.pdf]]', 'a', 'assets/文档 A.pdf'],
];

function writeContent(strategy) {
	fs.rmSync(content, { recursive: true, force: true });
	const write = (rel, body) => {
		const p = path.join(content, rel);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, body);
	};
	for (const [rel, bytes] of Object.entries(attachments)) write(rel, bytes);
	for (const from of sources) {
		const lines = cases.map(([, gen], i) => `- L${String(i).padStart(2, '0')} ${gen(from, strategy)}`);
		write(from, `---\ntitle: source\n---\n\n${lines.join('\n')}\n`);
	}
}

function setStrategy(strategy) {
	const cfg = path.join(site, 'quartz.config.yaml');
	const text = fs.readFileSync(cfg, 'utf-8');
	if (!/markdownLinkResolution: \w+/.test(text)) throw new Error('quartz.config.yaml 中未找到 markdownLinkResolution');
	fs.writeFileSync(cfg, text.replace(/markdownLinkResolution: \w+/, `markdownLinkResolution: ${strategy}`), 'utf-8');
}

function check() {
	const rows = [];
	for (const from of sources) {
		const fromSlug = slugOf(from);
		const html = fs.readFileSync(path.join(pub, `${fromSlug}.html`), 'utf-8');
		for (const m of html.matchAll(/<li>\s*L(\d\d)\s*(.*?)<\/li>/gs)) {
			const [label, , kind, target] = cases[Number(m[1])];
			const re = kind === 'img' ? /<img[^>]*src="([^"]*)"/ : /<a[^>]*href="([^"]*)"/;
			const url = m[2].match(re)?.[1];
			let ok = false;
			let detail = `没有生成 <${kind}>`;
			if (url) {
				const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromSlug), decodeURIComponent(url.split('#')[0])));
				ok = fs.existsSync(path.join(pub, resolved));
				detail = `${url} → ${resolved}${ok ? '' : '（文件不存在）'}`;
			}
			rows.push({ from, label, ok, detail, expectedSlug: slugOf(target) });
		}
	}
	return rows;
}

const summary = {};
try {
	for (const strategy of ['shortest', 'absolute', 'relative']) {
		setStrategy(strategy);
		writeContent(strategy);
		execSync('npx quartz build -d content -o public', { cwd: site, stdio: 'pipe' });
		const emitted = fs.readdirSync(path.join(pub, 'assets'));
		console.log(`\n== ${strategy}（public/assets：${emitted.join('、')}）`);
		for (const r of check()) {
			console.log(`${r.ok ? '✓' : '✗'} [${r.from}] ${r.label}：${r.detail}`);
			summary[r.label] ??= {};
			summary[r.label][strategy] = (summary[r.label][strategy] ?? true) && r.ok;
		}
	}
} finally {
	setStrategy('shortest');
	fs.rmSync(bundle, { force: true });
}
console.log('\n== 汇总（三个深度全部正确才算 ✓）');
for (const [label, byStrategy] of Object.entries(summary)) {
	console.log(`${label}：${Object.entries(byStrategy).map(([s, ok]) => `${s} ${ok ? '✓' : '✗'}`).join('，')}`);
}
