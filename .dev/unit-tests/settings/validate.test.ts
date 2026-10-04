import { describe, expect, it } from 'vitest';
import {
	checkBranch,
	checkContentDir,
	checkRepo,
	checkSiteName,
	checkSiteUrl,
	findRepoBranchClash,
	parseFolders,
	parseList,
} from '../../../src/settings/validate';

describe('checkRepo', () => {
	it.each([
		['owner/repo', 'owner/repo'],
		['  owner/my.repo_1 ', 'owner/my.repo_1'],
		['owner/repo.git', 'owner/repo'],
		['Some-Org/site-v5', 'Some-Org/site-v5'],
	])('合法：%s', (raw, value) => {
		expect(checkRepo(raw)).toEqual({ value });
	});

	it.each(['', 'repo', 'owner/', '/repo', 'a/b/c', 'https://github.com/owner/repo', 'own er/repo'])(
		'非法：%s',
		(raw) => {
			expect(checkRepo(raw)).toEqual({ error: 'error.repo' });
		},
	);
});

describe('checkBranch', () => {
	it.each(['main', 'v5', 'feature/x', 'release-1.0'])('合法：%s', (raw) => {
		expect(checkBranch(raw)).toEqual({ value: raw });
	});
	it('空值', () => {
		expect(checkBranch('  ')).toEqual({ error: 'error.required' });
	});
	it.each(['a b', 'a..b', 'a:b', 'a~b', 'a^b', 'a?b', 'a*b', 'a[b', '/a', 'a/'])('非法：%s', (raw) => {
		expect(checkBranch(raw)).toEqual({ error: 'error.branch' });
	});
});

describe('checkContentDir', () => {
	it.each([
		['content', 'content'],
		['/content/', 'content'],
		['site\\content', 'site/content'],
		['', ''],
		['  ', ''],
	])('%s → %s', (raw, value) => {
		expect(checkContentDir(raw)).toEqual({ value });
	});
	it.each(['../content', 'a/./b', '..'])('非法：%s', (raw) => {
		expect(checkContentDir(raw)).toEqual({ error: 'error.contentDir' });
	});
});

describe('checkSiteUrl', () => {
	it.each([
		['https://example.pages.dev', 'https://example.pages.dev'],
		['https://example.pages.dev/', 'https://example.pages.dev'],
		['https://example.github.io/site/', 'https://example.github.io/site'],
		['http://localhost:8080', 'http://localhost:8080'],
	])('%s → %s', (raw, value) => {
		expect(checkSiteUrl(raw)).toEqual({ value });
	});
	it.each(['', 'example.pages.dev', 'ftp://example.com', 'not a url'])('非法：%s', (raw) => {
		expect(checkSiteUrl(raw)).toEqual({ error: 'error.url' });
	});
});

describe('checkSiteName', () => {
	it('合法并去空白', () => {
		expect(checkSiteName(' 站点 A ', ['站点 B'])).toEqual({ value: '站点 A' });
	});
	it('空值', () => {
		expect(checkSiteName('', [])).toEqual({ error: 'error.required' });
	});
	it('重名（忽略大小写与空白）', () => {
		expect(checkSiteName('Blog', [' blog '])).toEqual({ error: 'error.nameDuplicate' });
	});
});

describe('findRepoBranchClash', () => {
	const s = (id: string, repo: string, branch: string) => ({ id, name: id, repo, branch });
	const sites = [s('a', 'Owner/Repo', 'main'), s('b', 'owner/repo', 'site2'), s('c', 'owner/other', 'main')];
	it('同仓库（忽略大小写）同分支 → 冲突', () => {
		expect(findRepoBranchClash(s('x', 'owner/repo', 'main'), sites)?.id).toBe('a');
	});
	it('同仓库不同分支、不同仓库同分支 → 不冲突', () => {
		expect(findRepoBranchClash(s('x', 'owner/repo', 'dev'), sites)).toBeUndefined();
		expect(findRepoBranchClash(s('x', 'owner/third', 'main'), sites)).toBeUndefined();
	});
	it('不与自身比较；仓库或分支为空时不判断', () => {
		expect(findRepoBranchClash(s('a', 'Owner/Repo', 'main'), sites)).toBeUndefined();
		expect(findRepoBranchClash(s('x', '', 'main'), sites)).toBeUndefined();
	});
});

describe('parseList / parseFolders', () => {
	it('逗号与换行分隔、去空、去重', () => {
		expect(parseList('title, tags,\n date,, title ')).toEqual(['title', 'tags', 'date']);
	});
	it('文件夹去首尾斜杠并统一分隔符', () => {
		expect(parseFolders('/Private/\nA\\B\n\n/')).toEqual(['Private', 'A/B']);
	});
});
