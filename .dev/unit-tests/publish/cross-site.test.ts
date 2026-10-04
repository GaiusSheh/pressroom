import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { utf8Decode } from '../../../src/core/hash';
import { type ManifestV1, emptyManifest } from '../../../src/core/manifest/manifest';
import {
	type OtherSite,
	type PublishContext,
	loadSnapshot,
	noteStatus,
	prepareNote,
	publishBatch,
} from '../../../src/core/publish';
import type { SiteConfig } from '../../../src/core/types';
import { newSite } from '../../../src/settings/settings';
import { FakeGitHub } from '../backend/fake-github';
import { fakeVault } from '../transform/fake-vault';

const site = (id: string, url: string, isolated = false): SiteConfig => ({
	...newSite(id, id),
	repo: 'o/r',
	siteUrl: url,
	isolated,
});
const manifestWith = (notes: Record<string, string>): ManifestV1 => ({
	...emptyManifest('manual'),
	notes: Object.entries(notes).map(([vaultPath, sitePath]) => ({
		vaultPath,
		sitePath,
		blobSha: 'a'.repeat(40),
		publishedAt: '2026-10-04T00:00:00.000Z',
		attachments: [],
		aliases: [],
	})),
});

async function publishHost(body: string, self: SiteConfig, others: OtherSite[], extraNotes: Record<string, string> = {}) {
	const fake = await FakeGitHub.create();
	const notes = { 'host.md': body, '群论.md': '', '集合.md': '', ...extraNotes };
	const { vault, note } = fakeVault(notes);
	const ctx: PublishContext = {
		backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
		vault,
		site: self,
		whitelist: [],
		excludedFolders: [],
		parseYaml: parse,
		stringifyYaml: (d) => stringify(d),
		otherSites: others,
	};
	await publishBatch(ctx, [{ ...(await prepareNote(ctx, note('host.md'))), sitePath: 'host.md' }], { message: () => 'm' });
	return { text: utf8Decode(fake.headFiles().get('content/host.md')!), ctx, note, notes };
}

const A = site('A', 'https://a.example.pages.dev');
const B = site('B', 'https://b.example.pages.dev');
const C = site('C', 'https://c.example.pages.dev', true);

describe('跨站链接与站点隔离', () => {
	it('非隔离站点：目标只在其他站点发布 → 输出该站完整网址（锚点按 Quartz 规则）', async () => {
		const { text } = await publishHost('[[群论]] 与 [[群论#第一节 Section A|定义]]', A, [{ site: B, manifest: manifestWith({ '群论.md': '代数/群论.md' }) }]);
		expect(text).toBe(
			'[群论](<https://b.example.pages.dev/%E4%BB%A3%E6%95%B0/%E7%BE%A4%E8%AE%BA>) 与 [定义](<https://b.example.pages.dev/%E4%BB%A3%E6%95%B0/%E7%BE%A4%E8%AE%BA#第一节-section-a>)',
		);
	});

	it('本站隔离 → 指向其他站点的链接一律纯文本', async () => {
		const { text } = await publishHost('[[群论]]', { ...A, isolated: true }, [{ site: B, manifest: manifestWith({ '群论.md': '群论.md' }) }]);
		expect(text).toBe('群论');
	});

	it('目标站点隔离 → 其他站点也不链接过去', async () => {
		const { text } = await publishHost('[[群论]]', A, [{ site: C, manifest: manifestWith({ '群论.md': '群论.md' }) }]);
		expect(text).toBe('群论');
	});

	it('目标同时在本站发布 → 优先本站路径', async () => {
		const fake = await FakeGitHub.create();
		const { vault, note } = fakeVault({ 'host.md': '[[群论]]', '群论.md': '' });
		const ctx: PublishContext = {
			backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
			vault,
			site: A,
			whitelist: [],
			excludedFolders: [],
			parseYaml: parse,
			stringifyYaml: (d) => stringify(d),
			otherSites: [{ site: B, manifest: manifestWith({ '群论.md': '群论.md' }) }],
		};
		const item = async (p: string, s: string) => ({ ...(await prepareNote(ctx, note(p))), sitePath: s });
		await publishBatch(ctx, [await item('群论.md', '本站/群论.md'), await item('host.md', 'host.md')], { message: () => 'm' });
		expect(utf8Decode(fake.headFiles().get('content/host.md')!)).toBe('[群论](<本站/群论>)');
	});

	it('多个站点都有：按设置中的顺序取第一个非隔离站点', async () => {
		const D = site('D', 'https://d.example.pages.dev');
		const { text } = await publishHost('[[群论]]', A, [
			{ site: C, manifest: manifestWith({ '群论.md': 'c.md' }) },
			{ site: D, manifest: manifestWith({ '群论.md': 'd.md' }) },
			{ site: B, manifest: manifestWith({ '群论.md': 'b.md' }) },
		]);
		expect(text).toBe('[群论](<https://d.example.pages.dev/d>)');
	});

	it('其他站点中未发布 → 纯文本', async () => {
		const { text } = await publishHost('[[集合]]', A, [{ site: B, manifest: manifestWith({ '群论.md': '群论.md' }) }]);
		expect(text).toBe('集合');
	});

	it('他站撤稿后，本站引用它的笔记状态变为「有修改」', async () => {
		const others: OtherSite[] = [{ site: B, manifest: manifestWith({ '群论.md': '群论.md' }) }];
		const { ctx, note } = await publishHost('[[群论]]', A, others);
		const status = async () => noteStatus(ctx, await prepareNote(ctx, note('host.md')), await loadSnapshot(ctx));
		expect((await status()).kind).toBe('synced');
		ctx.otherSites = [{ site: B, manifest: manifestWith({}) }];
		expect((await status()).kind).toBe('modified');
	});
});
