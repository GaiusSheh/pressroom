// Phase 4-3：vault 改名 → manifest 源路径
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { utf8Decode } from '../../../src/core/hash';
import { MANIFEST_PATH, type ManifestV1, type NoteRecord, parseManifest, serializeManifest } from '../../../src/core/manifest/manifest';
import { type PublishContext, commitRenames, loadSnapshot, noteStatus, prepareNote, publishBatch } from '../../../src/core/publish';
import { type Rename, applyRenames } from '../../../src/core/renames';
import { newSite } from '../../../src/settings/settings';
import { FakeGitHub } from '../backend/fake-github';
import { fakeVault } from '../transform/fake-vault';

const SHA = 'a'.repeat(40);
const record = (vaultPath: string, sitePath: string): NoteRecord => ({
	vaultPath,
	sitePath,
	blobSha: SHA,
	publishedAt: '2026-10-01T00:00:00.000Z',
	attachments: [],
	aliases: [],
});
const manifest = (...notes: NoteRecord[]): ManifestV1 => ({ version: 1, mode: 'follow', notes, attachments: [] });
const paths = (m: ManifestV1) => m.notes.map((n) => [n.vaultPath, n.sitePath]);

describe('applyRenames', () => {
	it('单文件改名：只改源路径，站内路径不变', () => {
		const { manifest: m, changed } = applyRenames(manifest(record('a.md', 's/a.md'), record('b.md', 'b.md')), [{ from: 'a.md', to: 'x/a2.md' }]);
		expect(paths(m)).toEqual([
			['x/a2.md', 's/a.md'],
			['b.md', 'b.md'],
		]);
		expect(changed).toBe(1);
	});

	it('文件夹改名按前缀；同名前缀的其他文件夹不受影响', () => {
		const { manifest: m } = applyRenames(manifest(record('笔记/a.md', 'a.md'), record('笔记/子/b.md', 'b.md'), record('笔记2/c.md', 'c.md')), [
			{ from: '笔记', to: '归档/笔记' },
		]);
		expect(m.notes.map((n) => n.vaultPath)).toEqual(['归档/笔记/a.md', '归档/笔记/子/b.md', '笔记2/c.md']);
	});

	it('文件夹事件与子文件事件都来时结果相同（幂等）', () => {
		const renames: Rename[] = [
			{ from: 'f', to: 'g' },
			{ from: 'f/a.md', to: 'g/a.md' },
		];
		const { manifest: m, changed } = applyRenames(manifest(record('f/a.md', 'a.md')), renames);
		expect(m.notes[0]!.vaultPath).toBe('g/a.md');
		expect(changed).toBe(1);
	});

	it('链式改名 A→B→C 与互换', () => {
		expect(applyRenames(manifest(record('A.md', 'a.md')), [{ from: 'A.md', to: 'B.md' }, { from: 'B.md', to: 'C.md' }]).manifest.notes[0]!.vaultPath).toBe('C.md');
		const swapped = applyRenames(manifest(record('x.md', '1.md'), record('y.md', '2.md')), [
			{ from: 'x.md', to: 't.md' },
			{ from: 'y.md', to: 'x.md' },
			{ from: 't.md', to: 'y.md' },
		]).manifest;
		expect(paths(swapped)).toEqual([
			['y.md', '1.md'],
			['x.md', '2.md'],
		]);
	});

	it('不相关的改名：manifest 原样返回，changed = 0', () => {
		const m = manifest(record('a.md', 'a.md'));
		const out = applyRenames(m, [{ from: 'z.md', to: 'y.md' }]);
		expect(out.manifest).toBe(m);
		expect(out.changed).toBe(0);
	});

	it('新路径已被另一条记录占用时跳过，不产生重复 vault 路径', () => {
		const out = applyRenames(manifest(record('a.md', 'a.md'), record('b.md', 'b.md')), [{ from: 'a.md', to: 'b.md' }]);
		expect(out.manifest.notes.map((n) => n.vaultPath)).toEqual(['a.md', 'b.md']);
		expect(out.changed).toBe(0);
	});
});

async function setup(notes: Record<string, string>, m: ManifestV1, repoFiles: Record<string, string> = {}, renames: Rename[] = []) {
	const fake = await FakeGitHub.create({ ...repoFiles, [MANIFEST_PATH]: serializeManifest(m) });
	const { vault, note } = fakeVault(notes);
	const ctx: PublishContext = {
		backend: new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http }),
		vault,
		site: { ...newSite('s1', '站点 A'), repo: 'o/r', siteUrl: 'https://example.pages.dev', mode: m.mode },
		whitelist: [],
		excludedFolders: [],
		parseYaml: parse,
		stringifyYaml: (d) => stringify(d),
		now: () => '2026-10-04T00:00:00.000Z',
		renames,
	};
	const repoManifest = () => parseManifest(utf8Decode(fake.headFiles().get(MANIFEST_PATH)!));
	const commits = () => fake.log.filter((l) => l.startsWith('PATCH')).length;
	return { fake, ctx, note, repoManifest, commits };
}

describe('commitRenames', () => {
	it('只写 manifest 一个文件，一次提交；提交信息不含 vault 路径', async () => {
		const t = await setup({}, manifest(record('私人/a.md', 'a.md')), { 'content/a.md': 'a' }, [{ from: '私人/a.md', to: '私人/b.md' }]);
		const out = await commitRenames(t.ctx, (n) => `更新 ${n} 篇`);
		expect(out.changed).toBe(1);
		expect(t.commits()).toBe(1);
		expect(t.repoManifest().notes[0]!.vaultPath).toBe('私人/b.md');
		expect(t.fake.commits.get(t.fake.ref)!.message).toBe('更新 1 篇');
	});

	it('没有受影响的记录时不提交', async () => {
		const t = await setup({}, manifest(record('a.md', 'a.md')), {}, [{ from: 'z.md', to: 'y.md' }]);
		expect(await commitRenames(t.ctx, () => 'x')).toEqual({ changed: 0, commitSha: undefined });
		expect(t.commits()).toBe(0);
	});
});

describe('未写回的改名参与状态与发布', () => {
	it('改名后立即发布：按已有记录更新（跟随站点则挪动），不当作新笔记重复发布；manifest 一并写入新路径', async () => {
		const t = await setup({ '新.md': '内容' }, manifest(record('旧.md', '旧.md')), { 'content/旧.md': '内容' }, [{ from: '旧.md', to: '新.md' }]);
		const snap = await loadSnapshot(t.ctx);
		expect(snap.renamed).toBe(1);
		expect(await noteStatus(t.ctx, await prepareNote(t.ctx, t.note('新.md')), snap)).toMatchObject({ kind: 'synced', moved: true });
		const out = await publishBatch(t.ctx, [await prepareNote(t.ctx, t.note('新.md'))], { message: () => 'm' });
		expect(out.items[0]).toMatchObject({ kind: 'moved', from: '旧.md', sitePath: '新.md' });
		expect(t.repoManifest().notes.map((n) => [n.vaultPath, n.sitePath])).toEqual([['新.md', '新.md']]);
	});
});
