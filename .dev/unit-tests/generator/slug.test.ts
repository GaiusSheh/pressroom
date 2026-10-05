import { describe, expect, it } from 'vitest';
import { aliasSlugOf, displayUrl, slugOf, urlOf } from '../../../src/core/generator/quartz';

// Phase 0 用例表（.dev/docs/others/phase0-findings.md §0-1），由 Quartz 实际函数生成
const cases: [string, string, string][] = [
	['基础', 'note.md', 'note'],
	['大写转小写', 'Note.md', 'note'],
	['空格转 -', 'my note.md', 'my-note'],
	['多个空格不合并', 'a  b.md', 'a--b'],
	['制表符等空白', 'a\tb.md', 'a-b'],
	['中文保留', '笔记/数学/示例标题.md', '笔记/数学/示例标题'],
	['中文 + 空格', '笔记/示例 标题.md', '笔记/示例-标题'],
	['全角空格', '示例　标题.md', '示例-标题'],
	['全角标点保留', '标题：副标题（一）.md', '标题：副标题（一）'],
	['& 转 -and-', 'A&B.md', 'a-and-b'],
	['% 转 -percent', '100%.md', '100-percent'],
	['? # 删除', 'what?#.md', 'what'],
	['<>:"|* 删除', 'a<b>c:d"e|f*g.md', 'abcdefg'],
	['半角括号保留', 'f(x).md', 'f(x)'],
	['点号保留', 'v1.2 notes.md', 'v1.2-notes'],
	['已有 - 保留', 'a-b.md', 'a-b'],
	['冲突对：空格版', 'A B.md', 'a-b'],
	['冲突对：连字符版', 'a-b.md', 'a-b'],
	['index.md', 'folder/index.md', 'folder/index'],
	['_index.md', 'folder/_index.md', 'folder/index'],
	['文件夹笔记', '笔记/笔记.md', '笔记/index'],
	['文件夹笔记（大小写不同）', 'Notes/notes.md', 'notes/index'],
	['文件夹名也 slug', 'My Folder/Sub Dir/x.md', 'my-folder/sub-dir/x'],
	['开头斜杠去除', '/a/b.md', 'a/b'],
	['图片保留扩展名', 'assets/My Image.png', 'assets/my-image.png'],
	['PDF 保留扩展名', 'assets/文档 1.pdf', 'assets/文档-1.pdf'],
	['无扩展名', 'README', 'readme'],
	['扩展名大写不变', 'assets/IMG.PNG', 'assets/img.PNG'],
	['emoji 保留', '🌱 garden.md', '🌱-garden'],
	['日文/韩文保留', 'メモ/메모.md', 'メモ/메모'],
];

describe('slugOf（Phase 0 用例表）', () => {
	it.each(cases)('%s：%s → %s', (_, input, expected) => {
		expect(slugOf(input)).toBe(expected);
	});

	it('对 slug 再 slug 结果不变（formatLink 以 slug 作为链接目标的前提）', () => {
		for (const [, input] of cases) {
			const once = slugOf(input);
			expect(slugOf(once), input).toBe(once);
		}
	});
});

describe('aliasSlugOf（与 note-properties getAliasSlugs 一致）', () => {
	it.each([
		['old/旧 位置', 'old/旧-位置'],
		['old-loc', 'old-loc'],
		['笔记/旧位置.md', '笔记/旧位置'],
		['v1.2', 'v1.2'],
		['Old Name', 'old-name'],
	])('%s → %s', (alias, expected) => {
		expect(aliasSlugOf(alias)).toBe(expected);
	});
});

describe('urlOf', () => {
	const site = 'https://example.pages.dev';
	it.each([
		['笔记/数学/示例 标题.md', 'https://example.pages.dev/%E7%AC%94%E8%AE%B0/%E6%95%B0%E5%AD%A6/%E7%A4%BA%E4%BE%8B-%E6%A0%87%E9%A2%98'],
		['A B.md', 'https://example.pages.dev/a-b'],
		['index.md', 'https://example.pages.dev/'],
		['folder/index.md', 'https://example.pages.dev/folder/'],
		['Notes/notes.md', 'https://example.pages.dev/notes/'],
		['f(x).md', 'https://example.pages.dev/f(x)'],
	])('%s', (path, expected) => {
		expect(urlOf(site, path)).toBe(expected);
	});

	it('站点网址末尾斜杠不重复', () => {
		expect(urlOf(`${site}/`, 'a.md')).toBe(`${site}/a`);
		expect(urlOf('https://example.github.io/site', 'a.md')).toBe('https://example.github.io/site/a');
	});

	it('编码后可还原为 slug', () => {
		expect(decodeURI(urlOf(site, '笔记/示例 标题.md'))).toBe(`${site}/笔记/示例-标题`);
	});
});

describe('displayUrl', () => {
	const site = 'https://example.pages.dev';
	it('中文还原为原字符', () => {
		expect(displayUrl(urlOf(site, '笔记/数学/示例 标题.md'))).toBe(`${site}/笔记/数学/示例-标题`);
	});
	it('ASCII 网址不变；slug 中不含 % 等需要保留编码的字符', () => {
		expect(displayUrl(`${site}/a-b`)).toBe(`${site}/a-b`);
		expect(displayUrl(urlOf(site, '100% A&B #1.md'))).toBe(decodeURI(urlOf(site, '100% A&B #1.md')));
		expect(urlOf(site, '100% A&B #1.md')).not.toContain('%25');
	});
	it('非法编码序列原样返回', () => {
		expect(displayUrl(`${site}/%E7%AC`)).toBe(`${site}/%E7%AC`);
	});
});
