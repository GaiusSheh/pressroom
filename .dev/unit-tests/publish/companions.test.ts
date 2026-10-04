// Phase 4-4：连带收集与 plainLinks 记录
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { MAX_COMPANIONS, scanCompanions } from '../../../src/core/companions';
import { utf8Decode } from '../../../src/core/hash';
import { MANIFEST_PATH, parseManifest, serializeManifest } from '../../../src/core/manifest/manifest';
import { type PublishContext, prepareNote, publishBatch } from '../../../src/core/publish';
import type { DirMode } from '../../../src/core/types';
import { newSite } from '../../../src/settings/settings';
import { FakeGitHub } from '../backend/fake-github';
import { fakeVault } from '../transform/fake-vault';

function deps(notes: Record<string, string>, published: string[] = [], excluded: string[] = ['Private'], known?: string[]) {
	const { vault, note } = fakeVault(notes);
	return {
		note,
		deps: {
			load: async (p: string) => (notes[p] === undefined ? undefined : note(p)),
			resolve: (t: string, f: string) => vault.resolve(t, f),
			excluded: (p: string) => excluded.some((e) => p.startsWith(`${e}/`)),
			publishedOnSite: (p: string) => published.includes(p),
			known: known && new Set(known),
		},
	};
}

describe('scanCompanions', () => {
	const notes = {
		'甲.md': '见 [[乙]] 与 [[丙]]，嵌入 ![[丁]]，私密 [[Private/秘]]，不存在 [[无]]，自己 [[甲]]',
		'乙.md': '回到 [[甲]]，再到 [[戊]]',
		'丙.md': '已发布',
		'丁.md': '只被嵌入，链接 [[己]]',
		'戊.md': '到 [[乙]]',
		'己.md': 'x',
		'Private/秘.md': 's',
	};

	it('一层：直接链接、去掉嵌入 / 排除 / 无法解析 / 已发布 / 自身', async () => {
		const { note, deps: d } = deps(notes, ['丙.md']);
		expect(await scanCompanions(note('甲.md'), d, false)).toEqual({ paths: ['乙.md'], truncated: false });
	});

	it('到底：广度优先，环形链接不重复', async () => {
		const { note, deps: d } = deps(notes, ['丙.md']);
		expect((await scanCompanions(note('甲.md'), d, true)).paths).toEqual(['乙.md', '戊.md']);
	});

	it('更新时：上次已为纯文本的直接链接不再列出（更深层照常）', async () => {
		const { note, deps: d } = deps(notes, [], ['Private'], ['乙.md']);
		expect((await scanCompanions(note('甲.md'), d, false)).paths).toEqual(['丙.md']);
	});

	it('到底达到上限时停止并标记', async () => {
		const many: Record<string, string> = { '起点.md': '[[n0]]' };
		for (let i = 0; i < MAX_COMPANIONS + 10; i++) many[`n${i}.md`] = `[[n${i + 1}]]`;
		const { note, deps: d } = deps(many);
		const out = await scanCompanions(note('起点.md'), d, true);
		expect(out.truncated).toBe(true);
		expect(out.paths).toHaveLength(MAX_COMPANIONS);
	});
});

describe('plainLinks', () => {
	async function setup(mode: DirMode) {
		const fake = await FakeGitHub.create({ [MANIFEST_PATH]: serializeManifest({ version: 1, mode, notes: [], attachments: [] }) });
		const { vault, note } = fakeVault({ 'a.md': '[[b]] [[c]]', 'b.md': 'b', 'c.md': 'c' });
		const ctx: PublishContext = {
			backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
			vault,
			site: { ...newSite('s1', '站点 A'), repo: 'o/r', siteUrl: 'https://example.pages.dev', mode },
			whitelist: [],
			excludedFolders: [],
			parseYaml: parse,
			stringifyYaml: (d) => stringify(d),
		};
		const manifest = () => parseManifest(utf8Decode(fake.headFiles().get(MANIFEST_PATH)!));
		const item = async (p: string, sitePath?: string) => ({ ...(await prepareNote(ctx, note(p))), sitePath });
		return { ctx, manifest, item };
	}

	it('跟随站点：记录本次为纯文本的链接；一并发布的不算', async () => {
		const t = await setup('follow');
		await publishBatch(t.ctx, [await t.item('a.md'), await t.item('b.md')], { message: () => 'm' });
		const a = t.manifest().notes.find((n) => n.vaultPath === 'a.md')!;
		expect(a.plainLinks).toEqual(['c.md']);
		// b 没有链接：不写入该字段
		expect(t.manifest().notes.find((n) => n.vaultPath === 'b.md')).not.toHaveProperty('plainLinks');
	});

	it('手动站点不记录', async () => {
		const t = await setup('manual');
		await publishBatch(t.ctx, [await t.item('a.md', 'a.md')], { message: () => 'm' });
		expect(t.manifest().notes[0]).not.toHaveProperty('plainLinks');
	});
});
