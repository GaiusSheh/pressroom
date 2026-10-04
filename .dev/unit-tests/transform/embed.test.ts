import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { isExcluded } from '../../../src/core/note';
import { loadEmbeds } from '../../../src/core/transform/embed';
import { type TransformContext, collectAttachments, transformNote } from '../../../src/core/transform/transform';
import { fakeVault } from './fake-vault';

async function run(
	notes: Record<string, string>,
	host: string,
	over: Partial<TransformContext> = {},
	binaries: Record<string, Uint8Array> = {},
) {
	const { vault, note } = fakeVault(notes, binaries);
	const excluded = (p: string) => isExcluded(p, ['Private']);
	const n = note(host);
	const embeds = await loadEmbeds(n, { vault, excluded });
	const ctx: TransformContext = {
		sitePath: 'posts/host.md',
		strategy: 'shortest',
		whitelist: [],
		stringifyYaml: (d) => stringify(d),
		resolve: (t, from) => vault.resolve(t, from),
		excluded,
		publishedPath: () => undefined,
		attachmentPath: (p) => `assets/${p.split('/').pop()}`,
		embeds,
		...over,
	};
	return { out: transformNote(n, ctx), attachments: collectAttachments(n, { ...ctx }), embeds };
}

const B = '---\ntitle: 示例\nsecret: 1\n---\n正文一\n\n正文二\n';

describe('嵌入展开', () => {
	it('整篇：去掉 frontmatter，包在 callout 中，标题为 frontmatter title', async () => {
		const { out } = await run({ 'host.md': '前\n\n![[b]]\n\n后', 'b.md': B }, 'host.md');
		expect(out).toBe('前\n\n> [!quote] 示例\n> 正文一\n>\n> 正文二\n\n后');
	});

	it('无 title 时用文件名', async () => {
		const { out } = await run({ 'host.md': '![[笔记 一]]', '笔记 一.md': '内容\n' }, 'host.md');
		expect(out).toBe('> [!quote] 笔记 一\n> 内容');
	});

	it('#标题：从该标题到下一个同级或更高级标题之前，标题附上小节名', async () => {
		const b = '# 总\n## 第一节\n内容一\n### 子节\n更细\n## 第二节\n内容二\n';
		const { out } = await run({ 'host.md': '![[b#第一节]]', 'b.md': b }, 'host.md');
		expect(out).toBe('> [!quote] b > 第一节\n> ## 第一节\n> 内容一\n> ### 子节\n> 更细');
	});

	it('#^块：只展开该段，去掉块标记', async () => {
		const b = '段一\n\n段二 ^b1\n\n段三\n';
		const { out } = await run({ 'host.md': '![[b#^b1]]', 'b.md': b }, 'host.md');
		expect(out).toBe('> [!quote] b\n> 段二');
	});

	it('整篇展开时去掉其中所有块标记；宿主自身的块标记保留', async () => {
		const { out } = await run({ 'host.md': '宿主段 ^h1\n\n![[b]]', 'b.md': '一 ^a1\n\n二 ^a2\n' }, 'host.md');
		expect(out).toBe('宿主段 ^h1\n\n> [!quote] b\n> 一\n>\n> 二');
	});

	it('#标题 的 callout 标题用笔记的 title 而非文件名', async () => {
		const { out } = await run({ 'host.md': '![[b#第一节]]', 'b.md': '---\ntitle: 片段 A\n---\n## 第一节\nx\n' }, 'host.md');
		expect(out.split('\n')[0]).toBe('> [!quote] 片段 A > 第一节');
	});

	it('自定义显示文字作为 callout 标题', async () => {
		const { out } = await run({ 'host.md': '![[b|摘录]]', 'b.md': B }, 'host.md');
		expect(out.split('\n')[0]).toBe('> [!quote] 摘录');
	});

	it('被嵌入笔记在本站已发布：标题链接到它（含小节锚点）', async () => {
		const { out } = await run({ 'host.md': '![[b#第一节]]', 'b.md': '## 第一节\nx\n' }, 'host.md', {
			publishedPath: (p) => (p === 'b.md' ? '站内/乙.md' : undefined),
		});
		expect(out.split('\n')[0]).toBe('> [!quote] [b > 第一节](<站内/乙#第一节>)');
	});

	it('嵌套嵌入 → 嵌套 callout', async () => {
		const { out } = await run({ 'host.md': '![[a]]', 'a.md': 'A 内容\n\n![[c]]\n', 'c.md': 'C 内容\n' }, 'host.md');
		expect(out).toBe('> [!quote] a\n> A 内容\n>\n> > [!quote] c\n> > C 内容');
	});

	it('循环 A↔B：再次出现时显示为纯文本', async () => {
		const { out } = await run({ 'host.md': '![[a]]', 'a.md': 'A\n\n![[b]]\n', 'b.md': 'B\n\n![[a]]\n' }, 'host.md');
		expect(out).toBe('> [!quote] a\n> A\n>\n> > [!quote] b\n> > B\n> >\n> > a');
	});

	it('嵌入自身：显示为纯文本', async () => {
		const { out } = await run({ 'host.md': '本篇 ![[host]]' }, 'host.md');
		expect(out).toBe('本篇 host');
	});

	it('深度上限 10 层：第 11 层显示为纯文本', async () => {
		const notes: Record<string, string> = { 'host.md': '![[n1]]' };
		for (let i = 1; i <= 12; i++) notes[`n${i}.md`] = `L${i}\n\n![[n${i + 1}]]\n`;
		notes['n13.md'] = 'L13\n';
		const { out } = await run(notes, 'host.md');
		const depth = (line: string) => (/^(> )*/.exec(line)?.[0].length ?? 0) / 2;
		const titled = out.split('\n').filter((l) => l.includes('[!quote]'));
		expect(titled).toHaveLength(10);
		expect(Math.max(...titled.map(depth))).toBe(10);
		expect(out).toContain('n11'); // 第 11 层只剩纯文本名称
		expect(out).not.toContain('L11');
	});

	it('排除文件夹中的笔记不展开、不读取，显示链接原文（与指向排除文件夹的普通链接一致）', async () => {
		const { out, embeds } = await run({ 'host.md': '![[Private/秘]]', 'Private/秘.md': '机密\n' }, 'host.md');
		expect(out).toBe('Private/秘');
		expect(embeds.size).toBe(0);
	});

	it('子路径不存在或笔记不存在 → 纯文本', async () => {
		const { out } = await run({ 'host.md': '![[b#不存在]] ![[无此笔记]]', 'b.md': '## 有\n' }, 'host.md');
		expect(out).toBe('b 无此笔记');
	});

	it('被嵌入内容中的链接、本篇自身链接、图片照常转换；附件被收集', async () => {
		const b = '见 [[已发布]] 与 [[#小节]]\n\n![[图.png]]\n\n## 小节\n';
		const { out, attachments } = await run(
			{ 'host.md': '![[b]]', 'b.md': b, '已发布.md': '' },
			'host.md',
			{ publishedPath: (p) => (p === '已发布.md' ? '甲.md' : undefined) },
			{ '图.png': new Uint8Array([1]) },
		);
		// b 本身未发布：指向 b 的小节链接为纯文本；已发布笔记的链接从宿主页面位置生成
		expect(out).toBe('> [!quote] b\n> 见 [已发布](<甲>) 与 #小节\n>\n> ![图](<assets/图.png>)\n>\n> ## 小节');
		expect(attachments).toEqual(['图.png']);
	});

	it('列表项中的嵌入：续行与列表内容对齐', async () => {
		const { out } = await run({ 'host.md': '- 项\n- ![[b]]\n- 后', 'b.md': '一\n二\n' }, 'host.md');
		expect(out).toBe('- 项\n- > [!quote] b\n  > 一\n  > 二\n- 后');
	});

	it('引用块中的嵌入：续行重复引用前缀', async () => {
		const { out } = await run({ 'host.md': '> ![[b]]', 'b.md': '一\n二\n' }, 'host.md');
		expect(out).toBe('> > [!quote] b\n> > 一\n> > 二');
	});

	it('嵌在一行文字中间：callout 另起一行', async () => {
		const { out } = await run({ 'host.md': '前文 ![[b]] 后文', 'b.md': '内\n' }, 'host.md');
		expect(out).toBe('前文 \n> [!quote] b\n> 内\n 后文');
	});

	it('输出稳定', async () => {
		const notes = { 'host.md': '![[a]]\n![[b#^x]]', 'a.md': 'A ![[b]]\n', 'b.md': 'p ^x\n' };
		expect((await run(notes, 'host.md')).out).toBe((await run(notes, 'host.md')).out);
	});
});
