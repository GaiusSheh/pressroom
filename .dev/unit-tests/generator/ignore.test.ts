import { describe, expect, it } from 'vitest';
import { matchIgnorePattern } from '../../../src/core/generator/ignore';

describe('matchIgnorePattern', () => {
	const defaults = ['private', 'templates'];
	it.each([
		['private/a.md', 'private'],
		['private/sub/a.md', 'private'],
		['templates/t.md', 'templates'],
		['notes/private/a.md', undefined], // 只匹配内容目录根下的 private
		['privatenotes/a.md', undefined],
		['a.md', undefined],
	])('默认模式：%s → %s', (path, expected) => {
		expect(matchIgnorePattern(path, defaults)).toBe(expected);
	});

	it.each([
		['**/drafts', 'x/y/drafts/a.md', true],
		['**/drafts', 'drafts/a.md', true],
		['*.excalidraw.md', 'a.excalidraw.md', true],
		['*.excalidraw.md', 'dir/a.excalidraw.md', false],
		['**/*.excalidraw.md', 'dir/a.excalidraw.md', true],
		['草稿/*', '草稿/a.md', true],
		['a?c.md', 'abc.md', true],
		['notes/', 'notes/a.md', true],
	])('glob %s 对 %s → %s', (pattern, path, hit) => {
		expect(matchIgnorePattern(path, [pattern]) !== undefined).toBe(hit);
	});

	it('模式中的正则特殊字符按字面匹配', () => {
		expect(matchIgnorePattern('a+b/c.md', ['a+b'])).toBe('a+b');
		expect(matchIgnorePattern('aab/c.md', ['a+b'])).toBeUndefined();
	});
});
