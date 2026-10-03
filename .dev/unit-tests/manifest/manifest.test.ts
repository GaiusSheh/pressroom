import { describe, expect, it } from 'vitest';
import { GitHubBackend } from '../../../src/core/backend/github';
import { gitBlobSha, utf8Decode } from '../../../src/core/hash';
import {
	MANIFEST_PATH,
	ManifestError,
	type ManifestV1,
	attachmentRefs,
	emptyManifest,
	loadManifest,
	manifestChange,
	parseManifest,
	serializeManifest,
} from '../../../src/core/manifest/manifest';
import { FakeGitHub } from '../backend/fake-github';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const sample = (): ManifestV1 => ({
	version: 1,
	mode: 'manual',
	notes: [
		{
			vaultPath: '笔记/数学/示例笔记.md',
			sitePath: '笔记/数学/示例标题.md',
			blobSha: SHA_A,
			publishedAt: '2026-10-03T12:00:00.000Z',
			attachments: ['assets/图 1.png', 'assets/a.pdf'],
			aliases: ['旧/位置'],
		},
		{
			vaultPath: '欢迎.md',
			sitePath: '欢迎.md',
			blobSha: SHA_B,
			publishedAt: '2026-10-03T12:00:00.000Z',
			attachments: ['assets/图 1.png'],
			aliases: [],
		},
	],
	attachments: [
		{ sitePath: 'assets/图 1.png', blobSha: SHA_C },
		{ sitePath: 'assets/a.pdf', blobSha: SHA_A },
	],
});

/** 宽松结构：允许把字段改成任意（非法）值 */
type LooseNote = { [k: string]: unknown; attachments: unknown[]; aliases: unknown[] };
type Loose = { [k: string]: unknown; notes: LooseNote[]; attachments: { [k: string]: unknown }[] };

/** 改动样例中的某个字段后序列化（用于构造非法输入） */
const mutate = (fn: (m: Loose) => void): string => {
	const m = JSON.parse(serializeManifest(sample())) as Loose;
	fn(m);
	return JSON.stringify(m);
};

describe('序列化', () => {
	it('往返一致', () => {
		const text = serializeManifest(sample());
		expect(serializeManifest(parseManifest(text))).toBe(text);
		expect(parseManifest(text)).toEqual(parseManifest(serializeManifest(parseManifest(text))));
	});

	it('输入顺序不同、列表内重复，输出逐字节相同、blob SHA 相同', async () => {
		const a = sample();
		const b = sample();
		b.notes.reverse();
		b.attachments.reverse();
		b.notes[1]!.attachments = ['assets/a.pdf', 'assets/图 1.png', 'assets/a.pdf'];
		expect(serializeManifest(b)).toBe(serializeManifest(a));
		expect(await gitBlobSha(serializeManifest(b))).toBe(await gitBlobSha(serializeManifest(a)));
	});

	it('固定键顺序、两空格缩进、末尾换行', () => {
		const text = serializeManifest(emptyManifest('follow'));
		expect(text).toBe('{\n  "version": 1,\n  "mode": "follow",\n  "notes": [],\n  "attachments": []\n}\n');
	});

	it('多余字段不写回', () => {
		const m = sample() as ManifestV1 & { extra: number };
		m.extra = 1;
		expect(serializeManifest(m)).not.toContain('extra');
	});
});

describe('parseManifest 报错', () => {
	const expectError = (text: string, kind: string, pattern: RegExp) => {
		let err: unknown;
		try {
			parseManifest(text);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ManifestError);
		expect((err as ManifestError).kind).toBe(kind);
		expect((err as ManifestError).message).toMatch(pattern);
	};

	it('不是 JSON', () => expectError('{oops', 'syntax', /不是合法 JSON/));
	it('根不是对象', () => expectError('[]', 'invalid', /\(根\)/));
	it('未来版本', () => expectError(mutate((m) => (m.version = 2)), 'tooNew', /版本为 2.*升级/));
	it('版本非法', () => expectError(mutate((m) => (m.version = '1')), 'invalid', /version/));
	it('模式非法', () => expectError(mutate((m) => (m.mode = 'auto')), 'invalid', /mode/));
	// 设为 undefined 后 JSON.stringify 会省略该字段，等同于缺失
	it('缺 notes', () =>
		expectError(mutate((m) => ((m as { notes?: unknown }).notes = undefined)), 'invalid', /notes 应为数组/));
	it('SHA 格式', () => expectError(mutate((m) => (m.notes[0]!.blobSha = 'XYZ')), 'invalid', /notes\[0\]\.blobSha/));
	it('时间格式', () => expectError(mutate((m) => (m.notes[1]!.publishedAt = '昨天')), 'invalid', /notes\[1\]\.publishedAt/));
	it.each(['/abs.md', '../up.md', 'a//b.md', 'a\\b.md', '', './a.md'])('非法路径 %j', (p) =>
		expectError(mutate((m) => (m.notes[0]!.sitePath = p)), 'invalid', /notes\[0\]\.sitePath/),
	);
	it('站内路径重复', () =>
		expectError(mutate((m) => (m.notes[1]!.sitePath = m.notes[0]!.sitePath)), 'invalid', /站内路径重复/));
	it('vault 路径重复', () =>
		expectError(mutate((m) => (m.notes[1]!.vaultPath = m.notes[0]!.vaultPath)), 'invalid', /vault 路径重复/));
	it('附件路径重复', () =>
		expectError(mutate((m) => (m.attachments[1]!.sitePath = m.attachments[0]!.sitePath)), 'invalid', /attachments 中站内路径重复/));
	it('笔记引用了未登记的附件', () =>
		expectError(mutate((m) => m.notes[0]!.attachments.push('assets/ghost.png')), 'invalid', /ghost\.png 不在 attachments/));
	it('alias 为空', () => expectError(mutate((m) => (m.notes[0]!.aliases = [''])), 'invalid', /aliases\[0\]/));
});

describe('attachmentRefs', () => {
	it('列出引用某附件的笔记', () => {
		expect(attachmentRefs(sample(), 'assets/图 1.png').sort()).toEqual(['欢迎.md', '笔记/数学/示例标题.md']);
		expect(attachmentRefs(sample(), 'assets/a.pdf')).toEqual(['笔记/数学/示例标题.md']);
		expect(attachmentRefs(sample(), 'assets/none.png')).toEqual([]);
	});
});

describe('与仓库读写', () => {
	const backend = (fake: FakeGitHub) => new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http: fake.http });

	it('仓库中没有 manifest 时返回空 manifest（用设置中的模式）', async () => {
		const fake = await FakeGitHub.create({ 'content/a.md': 'a' });
		expect(await loadManifest(backend(fake), 'follow')).toEqual(emptyManifest('follow'));
	});

	it('与内容放在同一次提交写入，再读回一致', async () => {
		const fake = await FakeGitHub.create({ 'content/a.md': 'a' });
		const gh = backend(fake);
		const m = sample();
		await gh.commit('publish', () => [{ path: 'content/欢迎.md', content: '欢迎' }, manifestChange(m)]);
		expect(fake.commits.get(fake.ref)!.parents).toHaveLength(1);
		expect(utf8Decode(fake.headFiles().get(MANIFEST_PATH)!)).toBe(serializeManifest(m));
		expect(await loadManifest(gh, 'manual')).toEqual(parseManifest(serializeManifest(m)));
	});

	it('仓库中的 manifest 损坏时抛错而不是当作空', async () => {
		const fake = await FakeGitHub.create({ [MANIFEST_PATH]: '{"version": 99}' });
		await expect(loadManifest(backend(fake), 'manual')).rejects.toMatchObject({ kind: 'tooNew' });
	});
});
