import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { utf8Decode, utf8Encode } from '../../../src/core/hash';
import { MANIFEST_PATH, parseManifest } from '../../../src/core/manifest/manifest';
import type { VaultAccess } from '../../../src/core/note';
import {
	type PublishContext,
	PublishConflictError,
	deletedSources,
	loadSnapshot,
	noteStatus,
	publishNote,
	readAttachments,
	unpublishNote,
} from '../../../src/core/publish';
import { newSite } from '../../../src/settings/settings';
import { FakeGitHub } from '../backend/fake-github';
import { makeNote } from '../transform/make-note';

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const CONFIG = 'plugins:\n  - source: "@quartz-community/crawl-links"\n    options:\n      markdownLinkResolution: shortest\n';

/** 假 vault：笔记文本 + 附件字节 */
function fakeVault(notes: Record<string, string>, binaries: Record<string, Uint8Array> = {}) {
	const all = [...Object.keys(notes), ...Object.keys(binaries)];
	const vault: VaultAccess = {
		resolve: (target) =>
			all.find((f) => f === target || f === `${target}.md` || f.endsWith(`/${target}`) || f.endsWith(`/${target}.md`)),
		readBinary: async (p) => {
			const b = binaries[p];
			if (!b) throw new Error(`fake vault: 没有 ${p}`);
			return b;
		},
	};
	return { vault, note: (p: string) => makeNote(p, notes[p]!) };
}

async function setup(notes: Record<string, string>, binaries: Record<string, Uint8Array> = {}, repoFiles: Record<string, string | Uint8Array> = {}) {
	const fake = await FakeGitHub.create({ 'quartz.config.yaml': CONFIG, ...repoFiles });
	const { vault, note } = fakeVault(notes, binaries);
	let clock = 0;
	const ctx: PublishContext = {
		backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
		vault,
		site: { ...newSite('s1', '站点 A'), repo: 'o/r', siteUrl: 'https://example.pages.dev' },
		whitelist: ['title'],
		excludedFolders: ['Private'],
		parseYaml: parse,
		stringifyYaml: (d) => stringify(d),
		now: () => new Date(Date.UTC(2026, 9, 3, 12, 0, clock++)).toISOString(),
	};
	const manifest = () => parseManifest(utf8Decode(fake.headFiles().get(MANIFEST_PATH)!));
	const file = (p: string) => fake.headFiles().get(p);
	const commits = () => fake.log.filter((l) => l.startsWith('PATCH')).length;
	return { fake, ctx, note, manifest, file, commits };
}

const msg = (kind: string, p: string) => `Pressroom: ${kind} ${p}`;

describe('首次发布', () => {
	it('写入转换后的笔记、附件与 manifest，只产生一个提交', async () => {
		const t = await setup(
			{ '笔记/示例笔记.md': '---\ntitle: 示例\nprivate: x\n---\n见 ![[图 1.png]] 与 [[未发布]]\n', '笔记/未发布.md': '' },
			{ '附件/图 1.png': PNG },
		);
		const out = await publishNote(t.ctx, t.note('笔记/示例笔记.md'), { sitePath: '数学/示例标题.md', message: msg });

		expect(out).toMatchObject({ kind: 'published', sitePath: '数学/示例标题.md' });
		expect(out.url).toBe('https://example.pages.dev/' + encodeURI('数学/示例标题'));
		expect(t.commits()).toBe(1);
		expect(t.fake.commits.get(t.fake.ref)!.message).toBe('Pressroom: published 数学/示例标题.md');
		expect(utf8Decode(t.file('content/数学/示例标题.md')!)).toBe('---\ntitle: 示例\n---\n见 ![图 1](<assets/图-1.png>) 与 未发布\n');
		expect(t.file('content/assets/图 1.png')).toEqual(PNG);
		const m = t.manifest();
		expect(m.notes).toEqual([
			{
				vaultPath: '笔记/示例笔记.md',
				sitePath: '数学/示例标题.md',
				blobSha: expect.stringMatching(/^[0-9a-f]{40}$/) as string,
				publishedAt: '2026-10-03T12:00:00.000Z',
				attachments: ['assets/图 1.png'],
				aliases: [],
			},
		]);
		expect(m.attachments).toHaveLength(1);
	});

	it('链接到已发布笔记时改写为站内路径', async () => {
		const t = await setup({ 'a.md': '目标', 'b.md': '看 [[a]]' });
		await publishNote(t.ctx, t.note('a.md'), { sitePath: '站内/甲.md', message: msg });
		await publishNote(t.ctx, t.note('b.md'), { sitePath: '乙.md', message: msg });
		expect(utf8Decode(t.file('content/乙.md')!)).toBe('看 [a](<站内/甲>)');
	});

	it('网址冲突时抛错且不提交', async () => {
		const t = await setup({ 'a.md': 'x' }, {}, { 'content/A B.md': '已有' });
		const err = await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a-b.md', message: msg }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PublishConflictError);
		expect((err as PublishConflictError).conflicts[0]!.owner).toEqual({ kind: 'file', path: 'A B.md' });
		expect(t.commits()).toBe(0);
	});

	it('与其他笔记的 alias 冲突', async () => {
		const t = await setup({ 'a.md': 'x' });
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		// 模拟 a 曾被挪动、留下 alias「旧/位置」
		const m = t.manifest();
		m.notes[0]!.aliases = ['旧/位置'];
		await t.ctx.backend.commit('seed', () => [{ path: MANIFEST_PATH, content: JSON.stringify(m) }]);
		const t2 = fakeVault({ 'b.md': 'y' });
		const err = await publishNote({ ...t.ctx, vault: t2.vault }, t2.note('b.md'), { sitePath: '旧/位置.md', message: msg }).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(PublishConflictError);
	});

	it('排除文件夹中的笔记不能发布', async () => {
		const t = await setup({ 'Private/a.md': 'x' });
		await expect(publishNote(t.ctx, t.note('Private/a.md'), { sitePath: 'a.md', message: msg })).rejects.toThrow(/排除文件夹/);
	});

	it('未给站内路径的首次发布报错', async () => {
		const t = await setup({ 'a.md': 'x' });
		await expect(publishNote(t.ctx, t.note('a.md'), { message: msg })).rejects.toThrow(/需要指定站内路径/);
	});

	it('仓库没有 Quartz 配置时按完整路径输出', async () => {
		const t = await setup({ 'a.md': '目标', 'b.md': '[[a]]' });
		await t.ctx.backend.commit('rm config', () => [{ path: 'quartz.config.yaml', delete: true }]);
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'x/a.md', message: msg });
		await publishNote(t.ctx, t.note('b.md'), { sitePath: 'y/b.md', message: msg });
		expect(utf8Decode(t.file('content/y/b.md')!)).toBe('[a](<x/a>)');
	});
});

describe('更新', () => {
	it('内容变化：位置不变，只推新内容并刷新 publishedAt', async () => {
		const notes = { 'a.md': '第一版' };
		const t = await setup(notes);
		await publishNote(t.ctx, t.note('a.md'), { sitePath: '站内/甲.md', message: msg });
		notes['a.md'] = '第二版';
		const out = await publishNote(t.ctx, t.note('a.md'), { sitePath: '别处.md', message: msg });
		expect(out).toMatchObject({ kind: 'updated', sitePath: '站内/甲.md' });
		expect(utf8Decode(t.file('content/站内/甲.md')!)).toBe('第二版');
		expect(t.file('content/别处.md')).toBeUndefined();
		expect(t.manifest().notes[0]!.publishedAt).toBe('2026-10-03T12:00:01.000Z');
		expect(t.commits()).toBe(2);
	});

	it('内容无变化：不提交，返回 upToDate', async () => {
		const t = await setup({ 'a.md': '不变' }, { '图.png': PNG });
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		const out = await publishNote(t.ctx, t.note('a.md'), { message: msg });
		expect(out.kind).toBe('upToDate');
		expect(t.commits()).toBe(1);
	});

	it('附件内容不变时不重复上传', async () => {
		const notes = { 'a.md': '![[图.png]] v1' };
		const t = await setup(notes, { '图.png': PNG });
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		const before = t.fake.log.length;
		notes['a.md'] = '![[图.png]] v2';
		await publishNote(t.ctx, t.note('a.md'), { message: msg });
		// 第二次只上传笔记与 manifest 两个 blob，附件不重传
		expect(t.fake.log.slice(before).filter((l) => l === 'POST /git/blobs')).toHaveLength(2);
		expect(t.manifest().attachments).toHaveLength(1);
	});
});

describe('撤稿', () => {
	it('删除笔记文件与记录，附件保留', async () => {
		const t = await setup({ 'a.md': '![[图.png]]' }, { '图.png': PNG });
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		const out = await unpublishNote(t.ctx, 'a.md', (p) => `撤稿 ${p}`);
		expect(out).toMatchObject({ kind: 'unpublished', sitePath: 'a.md' });
		expect(t.file('content/a.md')).toBeUndefined();
		expect(t.file('content/assets/图.png')).toEqual(PNG);
		expect(t.manifest().notes).toEqual([]);
		expect(t.manifest().attachments).toHaveLength(1);
	});

	it('未发布的笔记撤稿：不提交', async () => {
		const t = await setup({ 'a.md': 'x' });
		expect(await unpublishNote(t.ctx, 'a.md', (p) => p)).toEqual({ kind: 'notPublished' });
		expect(t.commits()).toBe(0);
	});

	it('仓库中文件已被外部删除：只清理 manifest', async () => {
		const t = await setup({ 'a.md': 'x' });
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		await t.ctx.backend.commit('外部删除', () => [{ path: 'content/a.md', delete: true }]);
		const out = await unpublishNote(t.ctx, 'a.md', (p) => p);
		expect(out.kind).toBe('unpublished');
		expect(t.manifest().notes).toEqual([]);
	});
});

describe('并发与状态', () => {
	it('发布期间其他设备推送（非 fast-forward）：重建后两边的改动都在', async () => {
		const t = await setup({ 'a.md': 'x' });
		let pushed = false;
		t.fake.beforePatch = async () => {
			if (pushed) return;
			pushed = true;
			await t.fake.externalPush('content/他人.md', '其他设备发布');
		};
		const out = await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		expect(out.kind).toBe('published');
		expect(t.file('content/他人.md')).toBeDefined();
		expect(t.file('content/a.md')).toBeDefined();
	});

	it('已同步 / 有修改（vault 改了、或仓库被外部手改）/ 未发布', async () => {
		const notes = { 'a.md': '原文', 'b.md': '' };
		const t = await setup(notes);
		const status = async (p: string) => {
			const note = t.note(p);
			return noteStatus(t.ctx, note, await loadSnapshot(t.ctx), await readAttachments(t.ctx, note));
		};
		expect((await status('b.md')).kind).toBe('unpublished');
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		expect((await status('a.md')).kind).toBe('synced');
		notes['a.md'] = '改了';
		expect((await status('a.md')).kind).toBe('modified');
		notes['a.md'] = '原文';
		await t.ctx.backend.commit('外部手改', () => [{ path: 'content/a.md', content: utf8Encode('被手改') }]);
		expect((await status('a.md')).kind).toBe('modified');
	});

	it('deletedSources：列出源笔记已不在 vault 的记录', async () => {
		const t = await setup({ 'a.md': 'x', 'b.md': 'y' });
		await publishNote(t.ctx, t.note('a.md'), { sitePath: 'a.md', message: msg });
		await publishNote(t.ctx, t.note('b.md'), { sitePath: 'b.md', message: msg });
		expect(deletedSources(t.manifest(), (p) => p === 'a.md').map((n) => n.vaultPath)).toEqual(['b.md']);
	});
});
