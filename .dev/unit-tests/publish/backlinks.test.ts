import { describe, expect, it } from 'vitest';
import { publishedBacklinks, unpublishedLinkTargets } from '../../../src/core/backlinks';
import { type ManifestV1, emptyManifest } from '../../../src/core/manifest/manifest';
import { isExcluded } from '../../../src/core/note';
import { fakeVault } from '../transform/fake-vault';

const manifest = (paths: string[]): ManifestV1 => ({
	...emptyManifest('manual'),
	notes: paths.map((vaultPath) => ({
		vaultPath,
		sitePath: vaultPath,
		blobSha: 'a'.repeat(40),
		publishedAt: '2026-10-04T00:00:00.000Z',
		attachments: [],
		aliases: [],
	})),
});

describe('publishedBacklinks', () => {
	it('只保留已在本站发布的来源，排除目标自身', () => {
		expect(publishedBacklinks('集合.md', ['群论.md', '草稿.md', '集合.md'], manifest(['群论.md', '集合.md', '其他.md']))).toEqual([
			'群论.md',
		]);
	});
	it('没有来源时为空', () => {
		expect(publishedBacklinks('a.md', [], manifest(['b.md']))).toEqual([]);
	});
});

describe('unpublishedLinkTargets', () => {
	it('列出未在本站发布的链接目标；跳过嵌入、排除、自身、已发布、无法解析、附件；去重', () => {
		const { vault, note } = fakeVault({
			'群论.md': '[[集合]] [[集合|再提]] [[映射]] ![[片段]] [[Private/秘]] [[群论#a]] [[已发]] [[无此]] [[图.png]]',
			'集合.md': '',
			'映射.md': '',
			'片段.md': '',
			'Private/秘.md': '',
			'已发.md': '',
			'图.png': '',
		});
		const out = unpublishedLinkTargets(
			note('群论.md'),
			(t, f) => vault.resolve(t, f),
			(p) => isExcluded(p, ['Private']),
			(p) => p === '已发.md',
		);
		expect(out).toEqual(['集合.md', '映射.md']);
	});
});
