// Phase 4-1 / 4-2：跟随 vault 站点、模式以仓库为准、「已移动」与挪动（aliases）、setMode
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { utf8Decode } from '../../../src/core/hash';
import { MANIFEST_PATH, type ManifestV1, type NoteRecord, parseManifest, serializeManifest } from '../../../src/core/manifest/manifest';
import {
	type BatchSummary,
	type PublishContext,
	PublishConflictError,
	aliasFor,
	loadSnapshot,
	movedRecords,
	noteStatus,
	prepareNote,
	publishBatch,
	setMode,
} from '../../../src/core/publish';
import type { DirMode } from '../../../src/core/types';
import { newSite } from '../../../src/settings/settings';
import { FakeGitHub } from '../backend/fake-github';
import { fakeVault } from '../transform/fake-vault';

const SHA = 'a'.repeat(40);
const record = (vaultPath: string, sitePath: string, aliases: string[] = []): NoteRecord => ({
	vaultPath,
	sitePath,
	blobSha: SHA,
	publishedAt: '2026-10-01T00:00:00.000Z',
	attachments: [],
	aliases,
});
const manifestFile = (mode: DirMode, notes: NoteRecord[]) => serializeManifest({ version: 1, mode, notes, attachments: [] });

async function setup(opts: {
	notes: Record<string, string>;
	repoFiles?: Record<string, string>;
	localMode?: DirMode;
	whitelist?: string[];
}) {
	const fake = await FakeGitHub.create(opts.repoFiles ?? {});
	const { vault, note } = fakeVault(opts.notes);
	const ctx: PublishContext = {
		backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
		vault,
		site: { ...newSite('s1', '站点 A'), repo: 'o/r', siteUrl: 'https://example.pages.dev', mode: opts.localMode ?? 'follow' },
		whitelist: opts.whitelist ?? [],
		excludedFolders: ['Private'],
		parseYaml: parse,
		stringifyYaml: (d) => stringify(d),
		now: () => '2026-10-04T00:00:00.000Z',
	};
	const item = async (vaultPath: string, sitePath?: string) => ({ ...(await prepareNote(ctx, note(vaultPath))), sitePath });
	const file = (p: string) => {
		const b = fake.headFiles().get(p);
		return b && utf8Decode(b);
	};
	const manifest = (): ManifestV1 => parseManifest(file(MANIFEST_PATH)!);
	const commits = () => fake.log.filter((l) => l.startsWith('PATCH')).length;
	let last: BatchSummary | undefined;
	const message = (s: BatchSummary) => {
		last = s;
		return 'msg';
	};
	return { fake, ctx, item, file, manifest, commits, message, summary: () => last };
}

describe('跟随 vault 站点', () => {
	it('首次发布：站内路径 = vault 路径，忽略传入的位置；manifest 记录模式', async () => {
		const t = await setup({ notes: { '笔记/示例笔记.md': '正文' } });
		const out = await publishBatch(t.ctx, [await t.item('笔记/示例笔记.md', '别处/x.md')], { message: t.message });
		expect(out.items[0]).toMatchObject({ kind: 'published', sitePath: '笔记/示例笔记.md' });
		expect(t.file('content/笔记/示例笔记.md')).toBe('正文');
		expect(t.manifest().mode).toBe('follow');
	});

	it('模式以仓库为准：本地设置为手动，仓库 manifest 为跟随 → 按 vault 路径发布', async () => {
		const t = await setup({
			notes: { 'a/b.md': 'b' },
			localMode: 'manual',
			repoFiles: { [MANIFEST_PATH]: manifestFile('follow', []) },
		});
		const out = await publishBatch(t.ctx, [await t.item('a/b.md', 'x.md')], { message: t.message });
		expect(out.items[0]!.sitePath).toBe('a/b.md');
	});

	it('模式以仓库为准：本地为跟随，仓库为手动 → 使用传入的位置', async () => {
		const t = await setup({
			notes: { 'a/b.md': 'b' },
			localMode: 'follow',
			repoFiles: { [MANIFEST_PATH]: manifestFile('manual', []) },
		});
		const out = await publishBatch(t.ctx, [await t.item('a/b.md', 'x.md')], { message: t.message });
		expect(out.items[0]!.sitePath).toBe('x.md');
	});
});

describe('已移动与挪动', () => {
	const moved = () =>
		setup({
			notes: { '新/示例笔记.md': '新内容' },
			repoFiles: {
				'content/旧/示例笔记.md': '旧内容',
				[MANIFEST_PATH]: manifestFile('follow', [record('新/示例笔记.md', '旧/示例笔记.md')]),
			},
		});

	it('状态：跟随站点上站内路径 ≠ vault 路径 → moved（与有修改叠加）', async () => {
		const t = await moved();
		const snap = await loadSnapshot(t.ctx);
		const status = await noteStatus(t.ctx, await t.item('新/示例笔记.md'), snap);
		expect(status).toMatchObject({ kind: 'modified', moved: true, sitePath: '旧/示例笔记.md' });
		expect(movedRecords(snap.manifest).map((r) => r.vaultPath)).toEqual(['新/示例笔记.md']);
	});

	it('手动站点没有「已移动」，再次发布原地更新', async () => {
		const t = await setup({
			notes: { '新/a.md': '新' },
			localMode: 'manual',
			repoFiles: { 'content/旧/a.md': '旧', [MANIFEST_PATH]: manifestFile('manual', [record('新/a.md', '旧/a.md')]) },
		});
		const snap = await loadSnapshot(t.ctx);
		expect(await noteStatus(t.ctx, await t.item('新/a.md'), snap)).toMatchObject({ moved: false });
		const out = await publishBatch(t.ctx, [await t.item('新/a.md')], { message: t.message });
		expect(out.items[0]).toMatchObject({ kind: 'updated', sitePath: '旧/a.md' });
	});

	it('发布 = 同步：一次提交删旧、写新（含 aliases）、更新 manifest', async () => {
		const t = await moved();
		const out = await publishBatch(t.ctx, [await t.item('新/示例笔记.md')], { message: t.message });
		expect(t.commits()).toBe(1);
		expect(out.items[0]).toMatchObject({ kind: 'moved', sitePath: '新/示例笔记.md', from: '旧/示例笔记.md' });
		expect(t.summary()!.moved).toEqual([{ from: '旧/示例笔记.md', to: '新/示例笔记.md' }]);
		expect(t.file('content/旧/示例笔记.md')).toBeUndefined();
		expect(parse(t.file('content/新/示例笔记.md')!.split('---\n')[1]!)).toEqual({ aliases: ['旧/示例笔记'] });
		expect(t.file('content/新/示例笔记.md')!.endsWith('---\n新内容')).toBe(true);
		const rec = t.manifest().notes[0]!;
		expect(rec).toMatchObject({ sitePath: '新/示例笔记.md', aliases: ['旧/示例笔记'] });
	});

	it('内容未变也会挪动', async () => {
		const t = await setup({
			notes: { '新/a.md': '同样' },
			repoFiles: { 'content/旧/a.md': '同样', [MANIFEST_PATH]: manifestFile('follow', [record('新/a.md', '旧/a.md')]) },
		});
		const out = await publishBatch(t.ctx, [await t.item('新/a.md')], { message: t.message });
		expect(out.items[0]!.kind).toBe('moved');
		expect(t.file('content/旧/a.md')).toBeUndefined();
	});

	it('新位置与站上已有内容冲突 → 拒绝，不提交', async () => {
		const t = await setup({
			notes: { '新/a.md': '新' },
			repoFiles: {
				'content/旧/a.md': '旧',
				'content/新/A.md': '别人的',
				[MANIFEST_PATH]: manifestFile('follow', [record('新/a.md', '旧/a.md')]),
			},
		});
		const err = await publishBatch(t.ctx, [await t.item('新/a.md')], { message: t.message }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PublishConflictError);
		expect(t.commits()).toBe(0);
	});

	it('挪回曾经的位置：旧 alias 与页面本身同网址，去掉；保留其他 aliases', async () => {
		const t = await setup({
			notes: { 'a.md': 'x' },
			repoFiles: { 'content/b.md': 'x', [MANIFEST_PATH]: manifestFile('follow', [record('a.md', 'b.md', ['a', 'c'])]) },
		});
		await publishBatch(t.ctx, [await t.item('a.md')], { message: t.message });
		expect(t.manifest().notes[0]!.aliases).toEqual(['b', 'c']);
	});

	it('笔记自带 aliases 在白名单中时合并去重', async () => {
		const t = await setup({
			notes: { '新/a.md': '---\naliases:\n  - 别名\n  - 旧/a\nsecret: 1\n---\n正文' },
			whitelist: ['aliases'],
			repoFiles: { 'content/旧/a.md': '旧', [MANIFEST_PATH]: manifestFile('follow', [record('新/a.md', '旧/a.md')]) },
		});
		await publishBatch(t.ctx, [await t.item('新/a.md')], { message: t.message });
		expect(parse(t.file('content/新/a.md')!.split('---\n')[1]!)).toEqual({ aliases: ['别名', '旧/a'] });
	});

	it('已有 aliases 在更新时继续写入发布副本', async () => {
		const t = await setup({
			notes: { 'a.md': '新' },
			repoFiles: { 'content/a.md': '旧', [MANIFEST_PATH]: manifestFile('follow', [record('a.md', 'a.md', ['old'])]) },
		});
		const out = await publishBatch(t.ctx, [await t.item('a.md')], { message: t.message });
		expect(out.items[0]!.kind).toBe('updated');
		expect(t.file('content/a.md')).toBe('---\naliases:\n  - old\n---\n新');
	});

	it('批内其他笔记链接到挪动的笔记时指向新位置', async () => {
		const t = await setup({
			notes: { '新/a.md': 'a', 'b.md': '见 [[a]]' },
			repoFiles: { 'content/旧/a.md': 'a', [MANIFEST_PATH]: manifestFile('follow', [record('新/a.md', '旧/a.md')]) },
		});
		await publishBatch(t.ctx, [await t.item('新/a.md'), await t.item('b.md')], { message: t.message });
		expect(t.file('content/b.md')).toBe('见 [a](<新/a>)');
	});

	it('挪动后有多个 aliases 时状态为已同步（发布副本中 aliases 顺序与 manifest 读回一致）', async () => {
		const t = await setup({
			notes: { '新/a.md': '正文' },
			repoFiles: { 'content/旧/a.md': '旧', [MANIFEST_PATH]: manifestFile('follow', [record('新/a.md', '旧/a.md', ['更早'])]) },
		});
		await publishBatch(t.ctx, [await t.item('新/a.md')], { message: t.message });
		const snap = await loadSnapshot(t.ctx);
		expect(await noteStatus(t.ctx, await t.item('新/a.md'), snap)).toMatchObject({ kind: 'synced', moved: false });
	});

	it('aliasFor 去掉 .md', () => {
		expect(aliasFor('旧/示例笔记.md')).toBe('旧/示例笔记');
	});
});

describe('setMode', () => {
	it('只改 manifest 的 mode，不动内容与记录', async () => {
		const t = await setup({
			notes: {},
			repoFiles: { 'content/x.md': 'x', [MANIFEST_PATH]: manifestFile('manual', [record('y.md', 'x.md')]) },
		});
		const before = t.manifest();
		expect(await setMode(t.ctx, 'follow', '切换')).toBeDefined();
		expect(t.manifest()).toEqual({ ...before, mode: 'follow' });
		expect(t.file('content/x.md')).toBe('x');
		expect(t.commits()).toBe(1);
	});

	it('已是该模式时不提交', async () => {
		const t = await setup({ notes: {}, repoFiles: { [MANIFEST_PATH]: manifestFile('follow', []) } });
		expect(await setMode(t.ctx, 'follow', '切换')).toBeUndefined();
		expect(t.commits()).toBe(0);
	});
});
