import { beforeAll, describe, expect, it } from 'vitest';
import { BackendError } from '../../../src/core/backend/types';
import { ManifestError } from '../../../src/core/manifest/manifest';
import { PublishConflictError } from '../../../src/core/publish';
import { isValidDir, isValidName, joinSitePath } from '../../../src/core/site-path';
import { setLanguage } from '../../../src/i18n';
import { commitMessage } from '../../../src/ui/commit-message';
import { describeError } from '../../../src/ui/errors';

beforeAll(() => setLanguage('zh'));

describe('站内路径', () => {
	it.each([
		['笔记/数学', '示例标题', '笔记/数学/示例标题.md'],
		['/笔记/', ' 示例 ', '笔记/示例.md'],
		['', '根下', '根下.md'],
		['a\\b', 'c', 'a/b/c.md'],
	])('joinSitePath(%j, %j) → %s', (dir, name, expected) => {
		expect(joinSitePath(dir, name)).toBe(expected);
	});
	it.each([['', false], ['  ', false], ['a/b', false], ['a\\b', false], ['示例 标题', true]])('isValidName(%j) → %s', (n, ok) => {
		expect(isValidName(n)).toBe(ok);
	});
	it.each([['', true], ['/', true], ['a/b', true], ['a/../b', false], ['./a', false], ['a//b', false]])('isValidDir(%j) → %s', (d, ok) => {
		expect(isValidDir(d)).toBe(ok);
	});
});

describe('commitMessage', () => {
	it('只涉及一篇：沿用单篇格式', () => {
		expect(commitMessage({ published: ['a.md'], updated: [], unpublished: [], moved: [] })).toBe('Pressroom：发布 a.md');
		expect(commitMessage({ published: [], updated: ['a.md'], unpublished: [], moved: [] })).toBe('Pressroom：更新 a.md');
		expect(commitMessage({ published: [], updated: [], unpublished: ['a.md'], moved: [] })).toBe('Pressroom：撤稿 a.md');
		expect(commitMessage({ published: [], updated: [], unpublished: [], moved: [{ from: 'a.md', to: 'x/a.md' }] })).toBe(
			'Pressroom：挪动 a.md 到 x/a.md',
		);
	});
	it('多篇：分段列出', () => {
		expect(commitMessage({ published: ['a.md'], updated: ['b.md', 'c.md'], unpublished: ['d.md'], moved: [] })).toBe(
			'Pressroom：发布 a.md；更新 b.md、c.md；撤稿 d.md',
		);
		expect(commitMessage({ published: ['a.md'], updated: [], unpublished: [], moved: [{ from: 'b.md', to: 'x/b.md' }] })).toBe(
			'Pressroom：发布 a.md；挪动 b.md → x/b.md',
		);
	});
});

describe('describeError', () => {
	it('网址冲突列出冲突对象', () => {
		const e = new PublishConflictError('a-b.md', [
			{ slug: 'a-b', owner: { kind: 'file', path: 'A B.md' } },
			{ slug: 'a-b', owner: { kind: 'alias', alias: 'A-B', ownerPath: 'x.md' } },
		]);
		expect(describeError(e, 'o/r')).toBe('a-b.md 与 A B.md、A-B 网址冲突。');
	});
	it.each([
		['auth', 'token 无效或已过期。'],
		['notFound', '找不到仓库 o/r，或 token 无权访问它。'],
		['conflict', '发布期间分支持续被其他来源更新，请重试。'],
	] as const)('BackendError %s', (kind, text) => {
		expect(describeError(new BackendError(kind, 'x'), 'o/r')).toBe(text);
	});
	it('manifest 版本过新 / 损坏', () => {
		expect(describeError(new ManifestError('tooNew', 'x'), 'o/r')).toBe('该站点由更新版本的 Pressroom 发布过，请先升级插件。');
		expect(describeError(new ManifestError('invalid', '字段 x'), 'o/r')).toBe('站点的 manifest 已损坏：字段 x');
	});
	it('其他错误带原始信息', () => {
		expect(describeError(new Error('boom'), 'o/r')).toBe('操作失败：boom');
		expect(describeError('raw', 'o/r')).toBe('操作失败：raw');
	});
});
