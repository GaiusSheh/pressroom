import { describe, expect, it } from 'vitest';
import type { TreeEntry } from '../../../src/core/backend/types';
import { allocateAttachments } from '../../../src/core/attachments';
import { type ManifestV1, emptyManifest } from '../../../src/core/manifest/manifest';

const sha = (c: string) => c.repeat(40);
const file = (path: string, s: string): TreeEntry => ({ path, sha: s, size: 1 });
const manifestWith = (attachments: ManifestV1['attachments']): ManifestV1 => ({ ...emptyManifest('manual'), attachments });

describe('allocateAttachments', () => {
	it('新附件放 assets/ 并保留原文件名', () => {
		const r = allocateAttachments([{ vaultPath: '附件/图 1.png', sha: sha('a') }], emptyManifest('manual'), []);
		expect(r.paths.get('附件/图 1.png')).toBe('assets/图 1.png');
		expect(r.uploads).toEqual([{ sitePath: 'assets/图 1.png', vaultPath: '附件/图 1.png' }]);
		expect(r.newRecords).toEqual([{ sitePath: 'assets/图 1.png', blobSha: sha('a') }]);
	});

	it('manifest 中已有同内容附件 → 复用，不上传、不新增记录', () => {
		const m = manifestWith([{ sitePath: 'assets/旧名.png', blobSha: sha('a') }]);
		const r = allocateAttachments([{ vaultPath: '附件/新名.png', sha: sha('a') }], m, [file('assets/旧名.png', sha('a'))]);
		expect(r.paths.get('附件/新名.png')).toBe('assets/旧名.png');
		expect(r.uploads).toEqual([]);
		expect(r.newRecords).toEqual([]);
	});

	it('站上已有同内容文件但 manifest 未登记（如迁移来的）→ 复用并登记', () => {
		const r = allocateAttachments([{ vaultPath: '附件/a.png', sha: sha('a') }], emptyManifest('manual'), [file('assets/x.png', sha('a'))]);
		expect(r.paths.get('附件/a.png')).toBe('assets/x.png');
		expect(r.uploads).toEqual([]);
		expect(r.newRecords).toEqual([{ sitePath: 'assets/x.png', blobSha: sha('a') }]);
	});

	it('同名不同内容 → 加后缀，后缀递增', () => {
		const r = allocateAttachments([{ vaultPath: '另一处/图 1.png', sha: sha('c') }], emptyManifest('manual'), [
			file('assets/图 1.png', sha('a')),
			file('assets/图 1-2.png', sha('b')),
		]);
		expect(r.paths.get('另一处/图 1.png')).toBe('assets/图 1-3.png');
	});

	it('大小写与空格不同也视为同名（按 slug）', () => {
		const r = allocateAttachments([{ vaultPath: 'x/My Image.png', sha: sha('c') }], emptyManifest('manual'), [
			file('assets/my image.png', sha('a')),
		]);
		expect(r.paths.get('x/My Image.png')).toBe('assets/My Image-2.png');
	});

	it('与内容目录中非 assets/ 的文件不比较同名', () => {
		const r = allocateAttachments([{ vaultPath: 'x/a.png', sha: sha('c') }], emptyManifest('manual'), [file('其他/a.png', sha('a'))]);
		expect(r.paths.get('x/a.png')).toBe('assets/a.png');
	});

	it('同一批中两个同名不同内容的文件分别分配', () => {
		const r = allocateAttachments(
			[
				{ vaultPath: 'a/图.png', sha: sha('a') },
				{ vaultPath: 'b/图.png', sha: sha('b') },
			],
			emptyManifest('manual'),
			[],
		);
		expect([...r.paths.values()]).toEqual(['assets/图.png', 'assets/图-2.png']);
		expect(r.uploads).toHaveLength(2);
	});

	it('同一批中两个不同路径但同内容的文件只上传一次', () => {
		const r = allocateAttachments(
			[
				{ vaultPath: 'a/图.png', sha: sha('a') },
				{ vaultPath: 'b/副本.png', sha: sha('a') },
			],
			emptyManifest('manual'),
			[],
		);
		expect(r.paths.get('b/副本.png')).toBe('assets/图.png');
		expect(r.uploads).toHaveLength(1);
		expect(r.newRecords).toHaveLength(1);
	});

	it('无扩展名文件的后缀', () => {
		const r = allocateAttachments([{ vaultPath: 'x/LICENSE', sha: sha('b') }], emptyManifest('manual'), [file('assets/LICENSE', sha('a'))]);
		expect(r.paths.get('x/LICENSE')).toBe('assets/LICENSE-2');
	});
});
