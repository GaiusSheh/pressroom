// Phase 5-1：一键更新（move never）、站内移动（moveTo）、一键重排（relocateBatch）、面板目录树与按钮筛选
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { utf8Decode } from '../../../src/core/hash';
import { MANIFEST_PATH, type ManifestV1, type NoteRecord, parseManifest, serializeManifest } from '../../../src/core/manifest/manifest';
import { type PanelStatus, availableBatches, batchTargets, buildTree } from '../../../src/core/panel';
import {
	type PublishContext,
	PublishConflictError,
	RelocateUnsupportedError,
	loadSnapshot,
	noteStatus,
	prepareNote,
	publishBatch,
	relocateBatch,
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
const config = (strategy: string) => `configuration:\n  pageTitle: x\nplugins:\n  - source: github:quartz-community/crawl-links\n    enabled: true\n    options:\n      markdownLinkResolution: ${strategy}\n`;

async function setup(notes: Record<string, string>, repoFiles: Record<string, string>, mode: DirMode) {
	const fake = await FakeGitHub.create(repoFiles);
	const { vault, note } = fakeVault(notes);
	const ctx: PublishContext = {
		backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
		vault,
		site: { ...newSite('s1', '站点 A'), repo: 'o/r', siteUrl: 'https://example.pages.dev', mode },
		whitelist: ['title'],
		excludedFolders: [],
		parseYaml: parse,
		stringifyYaml: (d) => stringify(d),
		now: () => '2026-10-05T00:00:00.000Z',
	};
	const file = (p: string) => {
		const b = fake.headFiles().get(p);
		return b && utf8Decode(b);
	};
	const manifest = (): ManifestV1 => parseManifest(file(MANIFEST_PATH)!);
	const item = async (p: string, extra: { moveTo?: string } = {}) => ({ ...(await prepareNote(ctx, note(p))), ...extra });
	const commits = () => fake.log.filter((l) => l.startsWith('PATCH')).length;
	return { ctx, file, manifest, item, commits, note };
}

describe('一键更新：move never', () => {
	it('跟随站点上已移动的笔记在原位置更新，「已移动」保留', async () => {
		const t = await setup(
			{ '新/a.md': '新内容' },
			{ 'content/旧/a.md': '旧内容', [MANIFEST_PATH]: manifestFile('follow', [record('新/a.md', '旧/a.md')]) },
			'follow',
		);
		const out = await publishBatch(t.ctx, [await t.item('新/a.md')], { message: () => 'm', move: 'never' });
		expect(out.items[0]).toMatchObject({ kind: 'updated', sitePath: '旧/a.md' });
		expect(t.file('content/旧/a.md')).toBe('新内容');
		const snap = await loadSnapshot(t.ctx);
		expect(await noteStatus(t.ctx, await t.item('新/a.md'), snap)).toMatchObject({ kind: 'synced', moved: true });
	});

	it('未发布的笔记照常按 vault 位置首次发布', async () => {
		const t = await setup({ 'x/b.md': 'b' }, { [MANIFEST_PATH]: manifestFile('follow', []) }, 'follow');
		const out = await publishBatch(t.ctx, [await t.item('x/b.md')], { message: () => 'm', move: 'never' });
		expect(out.items[0]).toMatchObject({ kind: 'published', sitePath: 'x/b.md' });
	});
});

describe('站内移动：moveTo（手动站点）', () => {
	const moved = () =>
		setup(
			{ 'v/a.md': '正文' },
			{ 'content/a.md': '正文', 'content/占用.md': 'x', [MANIFEST_PATH]: manifestFile('manual', [record('v/a.md', 'a.md')]) },
			'manual',
		);

	it('删旧、写新、旧路径写入 aliases，一次提交', async () => {
		const t = await moved();
		const out = await publishBatch(t.ctx, [await t.item('v/a.md', { moveTo: '归档/新名.md' })], { message: () => 'm' });
		expect(t.commits()).toBe(1);
		expect(out.items[0]).toMatchObject({ kind: 'moved', from: 'a.md', sitePath: '归档/新名.md' });
		expect(t.file('content/a.md')).toBeUndefined();
		expect(t.file('content/归档/新名.md')).toBe('---\naliases:\n  - a\n---\n正文');
		expect(t.manifest().notes[0]).toMatchObject({ sitePath: '归档/新名.md', aliases: ['a'] });
	});

	it('新位置冲突时拒绝', async () => {
		const t = await moved();
		const err = await publishBatch(t.ctx, [await t.item('v/a.md', { moveTo: '占用.md' })], { message: () => 'm' }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PublishConflictError);
		expect(t.commits()).toBe(0);
	});
});

describe('一键重排：relocateBatch', () => {
	const site = (strategy = 'shortest', vaultText = '新的正文') =>
		setup(
			{ '新/a.md': vaultText },
			{
				'quartz.config.yaml': config(strategy),
				'content/旧/a.md': '---\ntitle: 示例标题\n---\n旧的正文',
				[MANIFEST_PATH]: manifestFile('follow', [record('新/a.md', '旧/a.md', ['更旧'])]),
			},
			'follow',
		);

	it('只挪位置：正文保持旧版本，frontmatter 合并 aliases，「有修改」保留', async () => {
		const t = await site();
		const out = await relocateBatch(t.ctx, ['新/a.md'], () => 'm');
		expect(out.items[0]).toMatchObject({ kind: 'moved', from: '旧/a.md', sitePath: '新/a.md' });
		expect(t.file('content/旧/a.md')).toBeUndefined();
		const text = t.file('content/新/a.md')!;
		expect(text.endsWith('---\n旧的正文')).toBe(true);
		expect(parse(text.split('---\n')[1]!)).toEqual({ title: '示例标题', aliases: ['旧/a', '更旧'] });
		expect(t.manifest().notes[0]).toMatchObject({ sitePath: '新/a.md', aliases: ['旧/a', '更旧'] });
		const snap = await loadSnapshot(t.ctx);
		expect(await noteStatus(t.ctx, await t.item('新/a.md'), snap)).toMatchObject({ kind: 'modified', moved: false });
	});

	it('vault 内容未变时，重排后为已同步', async () => {
		const t = await site('shortest', '旧的正文');
		// 构造与发布结果一致的旧副本：先按旧位置更新一次
		await publishBatch(t.ctx, [await t.item('新/a.md')], { message: () => 'm', move: 'never' });
		await relocateBatch(t.ctx, ['新/a.md'], () => 'm');
		const snap = await loadSnapshot(t.ctx);
		expect(await noteStatus(t.ctx, await t.item('新/a.md'), snap)).toMatchObject({ kind: 'synced', moved: false });
	});

	it('relative 链接策略的站点拒绝', async () => {
		const t = await site('relative');
		await expect(relocateBatch(t.ctx, ['新/a.md'], () => 'm')).rejects.toBeInstanceOf(RelocateUnsupportedError);
		expect(t.commits()).toBe(0);
	});

	it('没有已移动的笔记时不提交', async () => {
		const t = await site();
		await relocateBatch(t.ctx, ['新/a.md'], () => 'm');
		const before = t.commits();
		const out = await relocateBatch(t.ctx, ['新/a.md'], () => 'm');
		expect(out.commitSha).toBeUndefined();
		expect(t.commits()).toBe(before);
	});
});

describe('面板数据', () => {
	const records = [record('v/c.md', '笔记/数学/c.md'), record('v/a.md', 'a.md'), record('v/b.md', '笔记/b.md')];

	it('目录树：文件夹在前、按名称排序', () => {
		const tree = buildTree(records);
		expect(tree.notes.map((n) => n.sitePath)).toEqual(['a.md']);
		expect(tree.folders.map((f) => f.path)).toEqual(['笔记']);
		const notes = tree.folders[0]!;
		expect(notes.folders.map((f) => f.path)).toEqual(['笔记/数学']);
		expect(notes.notes.map((n) => n.sitePath)).toEqual(['笔记/b.md']);
	});

	it('按钮：手动站点只有更新与清理；relative 站点没有重排', () => {
		expect(availableBatches('manual', 'shortest')).toEqual(['update', 'cleanup']);
		expect(availableBatches('follow', 'shortest')).toEqual(['sync', 'update', 'relocate', 'cleanup']);
		expect(availableBatches('follow', 'relative')).toEqual(['sync', 'update', 'cleanup']);
	});

	it('按钮作用对象', () => {
		const rs = [record('m.md', 'm.md'), record('mv.md', 'x.md'), record('both.md', 'y.md'), record('ok.md', 'ok.md'), record('gone.md', 'g.md'), record('wait.md', 'w.md')];
		const st: Record<string, PanelStatus> = {
			'm.md': { kind: 'modified', moved: false },
			'mv.md': { kind: 'synced', moved: true },
			'both.md': { kind: 'modified', moved: true },
			'ok.md': { kind: 'synced', moved: false },
			'gone.md': { kind: 'deleted' },
			'wait.md': { kind: 'loading' },
		};
		const of = (k: Parameters<typeof batchTargets>[0]) => batchTargets(k, rs, (p) => st[p]!);
		expect(of('sync')).toEqual(['m.md', 'mv.md', 'both.md']);
		expect(of('update')).toEqual(['m.md', 'both.md']);
		expect(of('relocate')).toEqual(['mv.md', 'both.md']);
		expect(of('cleanup')).toEqual(['gone.md']);
	});
});
