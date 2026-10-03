import { describe, expect, it } from 'vitest';
import { formatLink } from '../../../src/core/generator/quartz';
import type { LinkStrategy } from '../../../src/core/generator/types';

const base = { from: 'posts/source.md', to: '笔记/数学/示例 标题.md', text: '示例' };

describe('formatLink：shortest / absolute 输出完整 slug 路径', () => {
	it.each<LinkStrategy>(['shortest', 'absolute'])('%s', (strategy) => {
		expect(formatLink({ ...base, strategy })).toBe('[示例](<笔记/数学/示例-标题>)');
	});

	it('锚点保留原文（由 Quartz 自行 slug）', () => {
		expect(formatLink({ ...base, anchor: '第一节 Section A', strategy: 'shortest' })).toBe(
			'[示例](<笔记/数学/示例-标题#第一节 Section A>)',
		);
		expect(formatLink({ ...base, anchor: '^blk1', strategy: 'shortest' })).toBe('[示例](<笔记/数学/示例-标题#^blk1>)');
	});

	it('特殊字符文件名：% & # 空格被 slug 规则处理，括号保留在尖括号内', () => {
		expect(formatLink({ ...base, to: '100% A&B #1.md', strategy: 'shortest' })).toBe('[示例](<100-percent-a-and-b-1>)');
		expect(formatLink({ ...base, to: 'f(x).md', strategy: 'absolute' })).toBe('[示例](<f(x)>)');
	});

	it('文件夹笔记指向文件夹 index', () => {
		expect(formatLink({ ...base, to: '笔记/笔记.md', strategy: 'shortest' })).toBe('[示例](<笔记/index>)');
	});
});

describe('formatLink：relative 输出相对路径', () => {
	it.each([
		['posts/source.md', '笔记/数学/示例 标题.md', '../笔记/数学/示例-标题'],
		['笔记/数学/a.md', '笔记/数学/示例 标题.md', './示例-标题'],
		['笔记/数学/a.md', '笔记/b.md', '../b'],
		['a.md', '笔记/b.md', './笔记/b'],
		['笔记/深/层/a.md', 'x.md', '../../../x'],
		['笔记/笔记.md', '笔记/b.md', './b'],
	])('%s → %s', (from, to, path) => {
		expect(formatLink({ from, to, text: 't', strategy: 'relative' })).toBe(`[t](<${path}>)`);
	});
});

describe('formatLink：显示文字转义', () => {
	it('方括号与反斜杠', () => {
		expect(formatLink({ ...base, text: 'a [b] \\c', strategy: 'shortest' })).toBe('[a \\[b\\] \\\\c](<笔记/数学/示例-标题>)');
	});
});
