// Phase 3-2 前置验证：嵌入展开用的 callout 写法在 Quartz 5 中的渲染效果
// 用法（PowerShell，在 Pressroom 根目录）：node .dev/tests/phase3/quartz/callout-probe.mjs C:\tmp\pressroom-quartz-test
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const site = process.argv[2];
if (!site) throw new Error('需要传入 Quartz 测试站目录');
const content = path.join(site, 'content');
const pub = path.join(site, 'public');
fs.rmSync(content, { recursive: true, force: true });
const write = (rel, body) => {
	const p = path.join(content, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, body);
};
write('assets/图.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
write('目标.md', '---\ntitle: 目标\n---\n目标页\n');
write(
	'probe.md',
	[
		'---\ntitle: probe\n---',
		'',
		'## C1 quote',
		'> [!quote] 示例笔记',
		'> 第一段，含链接 [目标](<目标>)。',
		'>',
		'> ![图](<assets/图.png>)',
		'',
		'## C2 note',
		'> [!note] 示例笔记 > 第一节',
		'> 内容',
		'',
		'## C3 自定义 embed',
		'> [!embed] 示例笔记',
		'> 内容',
		'',
		'## C4 标题为链接',
		'> [!quote] [示例笔记](<目标>)',
		'> 内容',
		'',
		'## C5 嵌套',
		'> [!quote] 外层',
		'> 外层内容',
		'>',
		'> > [!quote] 内层',
		'> > 内层内容 [目标](<目标>)',
		'',
		'## C6 列表项中',
		'- 列表项',
		'  > [!quote] 列表中的嵌入',
		'  > 内容',
		'',
		'## C7 callout 内含标题与列表',
		'> [!quote] 含结构',
		'> ## 小节',
		'> - 一',
		'> - 二',
		'',
	].join('\n'),
);
execSync('npx quartz build -d content -o public', { cwd: site, stdio: 'pipe' });
const html = fs.readFileSync(path.join(pub, 'probe.html'), 'utf-8');
const article = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? '';
const sections = article.split(/<h2[^>]*>/).slice(1);
for (const s of sections) {
	const title = s.slice(0, s.indexOf('</h2>')).replace(/<[^>]+>/g, '').trim();
	const callouts = [...s.matchAll(/class="callout ([^"]*)"[^>]*data-callout="([^"]*)"/g)].map((m) => `${m[2]}(${m[1]})`);
	const titleText = [...s.matchAll(/class="callout-title-inner"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
	const links = [...s.matchAll(/<a[^>]*href="([^"]*)"/g)].map((m) => m[1]);
	const imgs = [...s.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]);
	console.log(`== ${title}\n   callout: ${callouts.join(' | ') || '（无）'}\n   标题: ${titleText.join(' | ')}\n   链接: ${links.join(' ')}  图片: ${imgs.join(' ')}`);
}
