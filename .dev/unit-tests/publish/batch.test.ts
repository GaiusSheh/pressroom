import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { utf8Decode } from '../../../src/core/hash';
import { MANIFEST_PATH, parseManifest } from '../../../src/core/manifest/manifest';
import {
	BatchConflictError,
	type PublishContext,
	PublishConflictError,
	type PublishItem,
	loadSnapshot,
	noteStatus,
	prepareNote,
	publishBatch,
} from '../../../src/core/publish';
import { newSite } from '../../../src/settings/settings';
import { FakeGitHub } from '../backend/fake-github';
import { fakeVault } from '../transform/fake-vault';

const PNG = new Uint8Array([137, 80, 78, 71, 9]);

async function setup(notes: Record<string, string>, binaries: Record<string, Uint8Array> = {}, repoFiles: Record<string, string> = {}) {
	const fake = await FakeGitHub.create(repoFiles);
	const { vault, note: parsed } = fakeVault(notes, binaries);
	const ctx: PublishContext = {
		backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
		vault,
		site: { ...newSite('s1', '站点 A'), repo: 'o/r', siteUrl: 'https://example.pages.dev' },
		whitelist: [],
		excludedFolders: ['Private'],
		parseYaml: parse,
		stringifyYaml: (d) => stringify(d),
		now: () => '2026-10-04T00:00:00.000Z',
	};
	const item = async (vaultPath: string, sitePath?: string): Promise<PublishItem> => ({
		...(await prepareNote(ctx, parsed(vaultPath))),
		sitePath,
	});
	const file = (p: string) => {
		const b = fake.headFiles().get(p);
		return b && utf8Decode(b);
	};
	const manifest = () => parseManifest(file(MANIFEST_PATH)!);
	const commits = () => fake.log.filter((l) => l.startsWith('PATCH')).length;
	return { fake, ctx, item, file, manifest, commits, notes };
}

const message = (s: { published: string[]; updated: string[]; unpublished: string[] }) =>
	`发布 ${s.published.join(',')} | 更新 ${s.updated.join(',')} | 撤稿 ${s.unpublished.join(',')}`;

describe('publishBatch', () => {
	it('多篇一次提交，批内互相链接都改写为站内路径', async () => {
		const t = await setup({ '群论.md': '见 [[集合]]', '集合.md': '见 [[群论]]' });
		const out = await publishBatch(t.ctx, [await t.item('群论.md', '代数/群论.md'), await t.item('集合.md', '代数/集合.md')], { message });
		expect(t.commits()).toBe(1);
		expect(out.items.map((i) => i.kind)).toEqual(['published', 'published']);
		expect(t.file('content/代数/群论.md')).toBe('见 [集合](<代数/集合>)');
		expect(t.file('content/代数/集合.md')).toBe('见 [群论](<代数/群论>)');
		expect(t.fake.commits.get(t.fake.ref)!.message).toBe('发布 代数/群论.md,代数/集合.md | 更新  | 撤稿 ');
		expect(t.manifest().notes).toHaveLength(2);
	});

	it('批内两篇目标网址相同 → 冲突，整批不提交', async () => {
		const t = await setup({ 'a.md': 'a', 'b.md': 'b' });
		const err = await publishBatch(t.ctx, [await t.item('a.md', 'x/A B.md'), await t.item('b.md', 'x/a-b.md')], { message }).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(PublishConflictError);
		expect(t.commits()).toBe(0);
	});

	it('多篇分别与站上内容冲突 → BatchConflictError 列出全部', async () => {
		const t = await setup({ 'a.md': 'a', 'b.md': 'b' }, {}, { 'content/a.md': '已有', 'content/b.md': '已有' });
		const err = await publishBatch(t.ctx, [await t.item('a.md', 'a.md'), await t.item('b.md', 'b.md')], { message }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BatchConflictError);
		expect((err as BatchConflictError).errors.map((e) => e.sitePath)).toEqual(['a.md', 'b.md']);
		expect(t.commits()).toBe(0);
	});

	it('多篇共享同一附件只上传一次', async () => {
		const t = await setup({ 'a.md': '![[图.png]]', 'b.md': '![[图.png]]' }, { '图.png': PNG });
		await publishBatch(t.ctx, [await t.item('a.md', 'a.md'), await t.item('b.md', 'b.md')], { message });
		expect(t.fake.log.filter((l) => l === 'POST /git/blobs')).toHaveLength(4); // 两篇 + 一个附件 + manifest
		expect(t.manifest().attachments).toHaveLength(1);
		expect(t.manifest().notes.every((n) => n.attachments[0] === 'assets/图.png')).toBe(true);
	});

	it('撤稿 + 一并更新引用它的笔记，在同一次提交中，链接变回纯文本', async () => {
		const t = await setup({ 'a.md': '目标', 'b.md': '见 [[a]]' });
		await publishBatch(t.ctx, [await t.item('a.md', 'a.md'), await t.item('b.md', 'b.md')], { message });
		expect(t.file('content/b.md')).toBe('见 [a](<a>)');
		const out = await publishBatch(t.ctx, [await t.item('b.md')], { message, unpublish: ['a.md'] });
		expect(t.commits()).toBe(2);
		expect(out.items.map((i) => [i.vaultPath, i.kind])).toEqual([
			['b.md', 'updated'],
			['a.md', 'unpublished'],
		]);
		expect(t.file('content/a.md')).toBeUndefined();
		expect(t.file('content/b.md')).toBe('见 a');
		expect(t.manifest().notes.map((n) => n.vaultPath)).toEqual(['b.md']);
	});

	it('发布新笔记 + 一并更新引用它的已发布笔记（反向链接提醒的「一并更新」）', async () => {
		const t = await setup({ 'a.md': '目标', 'b.md': '见 [[a]]' });
		await publishBatch(t.ctx, [await t.item('b.md', 'b.md')], { message });
		expect(t.file('content/b.md')).toBe('见 a');
		await publishBatch(t.ctx, [await t.item('a.md', 'a.md'), await t.item('b.md')], { message });
		expect(t.file('content/b.md')).toBe('见 [a](<a>)');
		expect(t.commits()).toBe(2);
	});

	it('全部已是最新：不提交；部分最新：只提交有变化的', async () => {
		const t = await setup({ 'a.md': 'a', 'b.md': 'b' });
		await publishBatch(t.ctx, [await t.item('a.md', 'a.md'), await t.item('b.md', 'b.md')], { message });
		const none = await publishBatch(t.ctx, [await t.item('a.md'), await t.item('b.md')], { message });
		expect(none.commitSha).toBeUndefined();
		expect(none.items.map((i) => i.kind)).toEqual(['upToDate', 'upToDate']);
		t.notes['b.md'] = 'b2';
		const some = await publishBatch(t.ctx, [await t.item('a.md'), await t.item('b.md')], { message });
		expect(some.items.map((i) => i.kind)).toEqual(['upToDate', 'updated']);
		expect(t.commits()).toBe(2);
	});

	it('非 fast-forward 重试后整批仍正确', async () => {
		const t = await setup({ 'a.md': '[[b]]', 'b.md': '[[a]]' });
		let pushed = false;
		t.fake.beforePatch = async () => {
			if (pushed) return;
			pushed = true;
			await t.fake.externalPush('content/外部.md', 'x');
		};
		await publishBatch(t.ctx, [await t.item('a.md', 'a.md'), await t.item('b.md', 'b.md')], { message });
		expect(t.file('content/外部.md')).toBe('x');
		expect(t.file('content/a.md')).toBe('[b](<b>)');
		expect(t.manifest().notes).toHaveLength(2);
	});

	it('嵌入：被嵌入内容写进宿主页面；被嵌入笔记修改后宿主状态变为「有修改」，更新后同步', async () => {
		const t = await setup({ 'host.md': '![[片段]]', '片段.md': '第一版\n' });
		await publishBatch(t.ctx, [await t.item('host.md', 'host.md')], { message });
		expect(t.file('content/host.md')).toBe('> [!quote] 片段\n> 第一版');
		expect(t.file('content/片段.md')).toBeUndefined(); // 被嵌入笔记不单独成页
		const status = async () => noteStatus(t.ctx, await prepareNote(t.ctx, (await t.item('host.md')).note), await loadSnapshot(t.ctx));
		expect((await status()).kind).toBe('synced');
		t.notes['片段.md'] = '第二版\n';
		expect((await status()).kind).toBe('modified');
		await publishBatch(t.ctx, [await t.item('host.md')], { message });
		expect(t.file('content/host.md')).toBe('> [!quote] 片段\n> 第二版');
		expect((await status()).kind).toBe('synced');
	});

	it('批中含排除文件夹的笔记 → 拒绝', async () => {
		const t = await setup({ 'Private/a.md': 'a' });
		await expect(publishBatch(t.ctx, [await t.item('Private/a.md', 'a.md')], { message })).rejects.toThrow(/排除文件夹/);
	});
});
