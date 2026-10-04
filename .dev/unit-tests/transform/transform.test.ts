import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { isExcluded } from '../../../src/core/note';
import { type TransformContext, collectAttachments, transformNote } from '../../../src/core/transform/transform';
import { makeNote } from './make-note';

// vault 中的文件：链接文字（去扩展名的文件名或路径）→ vault 路径
const vaultFiles = [
	'笔记/数学/示例笔记.md',
	'笔记/已发布.md',
	'笔记/未发布.md',
	'Private/私密.md',
	'附件/图 1.png',
	'附件/资料.pdf',
	'Private/秘图.png',
];
function resolve(target: string): string | undefined {
	return vaultFiles.find((f) => f === target || f === `${target}.md` || f.replace(/\.md$/, '').endsWith(`/${target}`) || f.endsWith(`/${target}`));
}

const ctx = (over: Partial<TransformContext> = {}): TransformContext => ({
	sitePath: 'posts/当前.md',
	strategy: 'shortest',
	whitelist: ['title', 'tags', 'date', 'description'],
	stringifyYaml: (d) => stringify(d),
	resolve: (t) => resolve(t),
	excluded: (p) => isExcluded(p, ['Private']),
	publishedPath: (p) => ({ '笔记/已发布.md': '站内/已发布 文章.md', '笔记/数学/示例笔记.md': '数学/示例标题.md' })[p],
	attachmentPath: (p) => ({ '附件/图 1.png': 'assets/图 1.png', '附件/资料.pdf': 'assets/资料-2.pdf' })[p],
	...over,
});

const run = (body: string, over: Partial<TransformContext> = {}) => transformNote(makeNote('笔记/当前.md', body), ctx(over));

describe('frontmatter 白名单', () => {
	it('只保留白名单属性，保持原顺序', () => {
		const out = run('---\ntitle: 标题\nprivate-field: 秘密\ntags:\n  - a\n---\n正文\n');
		expect(out).toBe('---\ntitle: 标题\ntags:\n  - a\n---\n正文\n');
	});
	it('全部被去除时删掉整个 frontmatter', () => {
		expect(run('---\nsecret: 1\n---\n正文\n')).toBe('正文\n');
	});
	it('没有 frontmatter 时原样', () => {
		expect(run('正文\n')).toBe('正文\n');
	});
	it('白名单为空时去掉所有属性', () => {
		expect(run('---\ntitle: 标题\n---\n正文\n', { whitelist: [] })).toBe('正文\n');
	});
});

describe('笔记链接', () => {
	it('已在本站发布 → 站内 slug 路径', () => {
		expect(run('见 [[已发布]]。')).toBe('见 [已发布](<站内/已发布-文章>)。');
	});
	it('别名与锚点', () => {
		expect(run('[[示例笔记#第一节|看这里]]')).toBe('[看这里](<数学/示例标题#第一节>)');
	});
	it('relative 策略输出相对路径', () => {
		expect(run('[[已发布]]', { strategy: 'relative' })).toBe('[已发布](<../站内/已发布-文章>)');
	});
	it('未发布 → 纯文本（显示文字）', () => {
		expect(run('[[未发布]] 与 [[未发布|别名]]')).toBe('未发布 与 别名');
	});
	it('排除文件夹 → 纯文本，即使已发布', () => {
		expect(run('[[Private/私密]]', { publishedPath: () => 'x.md' })).toBe('Private/私密');
	});
	it('无法解析 → 纯文本', () => {
		expect(run('[[不存在的笔记]]')).toBe('不存在的笔记');
	});
	it('空显示文字的链接退回链接目标', () => {
		expect(run('[](未发布.md)')).toBe('未发布');
		expect(run('[](已发布.md)')).toBe('[已发布](<站内/已发布-文章>)');
	});
	it('指向本篇的标题链接用本篇站内路径', () => {
		expect(run('[[#第二节]]')).toBe('[#第二节](<posts/当前#第二节>)');
	});
	it('Markdown 链接语法同样改写', () => {
		expect(run('[说明](已发布.md)')).toBe('[说明](<站内/已发布-文章>)');
	});
	it('嵌入笔记临时变为纯文本（笔记名）', () => {
		expect(run('![[示例笔记]]')).toBe('示例笔记');
		expect(run('![[示例笔记|摘录]]')).toBe('摘录');
	});
});

describe('附件', () => {
	it('嵌入图片 → 图片语法，alt 为文件名（不含扩展名）', () => {
		expect(run('![[图 1.png]]')).toBe('![图 1](<assets/图-1.png>)');
	});
	it('图片尺寸写法不当作 alt', () => {
		expect(run('![[图 1.png|300]]')).toBe('![图 1](<assets/图-1.png>)');
		expect(run('![[图 1.png|300x200]]')).toBe('![图 1](<assets/图-1.png>)');
	});
	it('图片自定义说明作 alt', () => {
		expect(run('![[图 1.png|示意图]]')).toBe('![示意图](<assets/图-1.png>)');
	});
	it('Markdown 图片语法', () => {
		expect(run('![](附件/图 1.png)')).toBe('![图 1](<assets/图-1.png>)');
	});
	it('嵌入 PDF 与普通附件链接 → 普通链接', () => {
		expect(run('![[资料.pdf]]')).toBe('[资料.pdf](<assets/资料-2.pdf>)');
		expect(run('[[资料.pdf]]')).toBe('[资料.pdf](<assets/资料-2.pdf>)');
	});
	it('非嵌入的图片链接 → 普通链接', () => {
		expect(run('[[图 1.png]]')).toBe('[图 1.png](<assets/图-1.png>)');
	});
	it('排除文件夹中的附件 → 纯文本，不收集', () => {
		const note = makeNote('笔记/当前.md', '![[秘图.png]] ![[图 1.png]] [[资料.pdf]] ![[图 1.png]]');
		expect(collectAttachments(note, ctx())).toEqual(['附件/图 1.png', '附件/资料.pdf']);
		expect(transformNote(note, ctx())).toMatch(/^秘图\.png /);
	});
	it('未分配站内路径的附件视为调用方错误', () => {
		expect(() => run('![[图 1.png]]', { attachmentPath: () => undefined })).toThrow(/未分配站内路径/);
	});
});

describe('位置替换', () => {
	it('只按 refs 替换：代码块内的 [[...]] 若不在 refs 中则保持原样', () => {
		const text = '```\n[[已发布]]\n```\n[[已发布]]\n';
		const note = makeNote('笔记/当前.md', text);
		note.refs = note.refs.filter((r) => r.start > text.indexOf('```\n[[') + 10); // 模拟 Obsidian 不收录代码块内链接
		expect(transformNote(note, ctx())).toBe('```\n[[已发布]]\n```\n[已发布](<站内/已发布-文章>)\n');
	});
	it('多处引用与前后文字保持', () => {
		expect(run('A [[已发布]] B [[未发布]] C')).toBe('A [已发布](<站内/已发布-文章>) B 未发布 C');
	});
	it('同一输入多次转换结果相同', () => {
		const body = '---\ntitle: t\nx: 1\n---\n[[已发布]] ![[图 1.png]]\n';
		expect(run(body)).toBe(run(body));
	});
	it('引用位置重叠时报错', () => {
		const note = makeNote('笔记/当前.md', '[[已发布]]');
		note.refs.push({ ...note.refs[0]! });
		expect(() => transformNote(note, ctx())).toThrow(/重叠/);
	});
});

describe('isExcluded', () => {
	it.each([
		['Private/a.md', true],
		['Private/sub/a.md', true],
		['Private', true],
		['Private2/a.md', false],
		['a/Private/b.md', false],
	])('%s → %s', (p, expected) => {
		expect(isExcluded(p, ['Private'])).toBe(expected);
	});
});
