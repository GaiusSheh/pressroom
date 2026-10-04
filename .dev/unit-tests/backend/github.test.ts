import { describe, expect, it } from 'vitest';
import { GitHubBackend } from '../../../src/core/backend/github';
import { BackendError, type HttpFn } from '../../../src/core/backend/types';
import { gitBlobSha, utf8Decode } from '../../../src/core/hash';
import { FakeGitHub } from './fake-github';

const backendFor = (fake: FakeGitHub, overrides: Partial<{ token: string; branch: string; maxRetries: number }> = {}) =>
	new GitHubBackend({ repo: 'owner/repo', branch: 'main', token: fake.token, http: fake.http, ...overrides });

const text = (b: Uint8Array | undefined) => (b ? utf8Decode(b) : undefined);

describe('读取', () => {
	it('getRepo / getHead / getTree / readText / readBlob', async () => {
		const fake = await FakeGitHub.create({ 'content/a.md': '甲', 'quartz.config.yaml': 'plugins: []\n' });
		const gh = backendFor(fake);
		expect(await gh.getRepo()).toEqual({ defaultBranch: 'main', private: true });
		const head = await gh.getHead();
		expect(head.commitSha).toBe(fake.ref);
		const tree = await gh.getTree(head.treeSha);
		expect(tree.map((e) => e.path).sort()).toEqual(['content/a.md', 'quartz.config.yaml']);
		const a = tree.find((e) => e.path === 'content/a.md')!;
		expect(a.sha).toBe(await gitBlobSha('甲'));
		expect(a.size).toBe(3);
		expect(utf8Decode(await gh.readBlob(a.sha))).toBe('甲');
		expect(await gh.readText('quartz.config.yaml')).toBe('plugins: []\n');
	});

	it('readText：文件不存在返回 undefined', async () => {
		const gh = backendFor(await FakeGitHub.create());
		expect(await gh.readText('nope.yaml')).toBeUndefined();
	});

	it('readText：路径中的中文与空格经编码后能读到', async () => {
		const fake = await FakeGitHub.create({ 'content/笔记 一.md': '内容' });
		expect(await backendFor(fake).readText('content/笔记 一.md')).toBe('内容');
	});
});

describe('commit', () => {
	it('一次提交内完成新增、修改、删除、挪动（复用 blob）', async () => {
		const fake = await FakeGitHub.create({ 'content/old.md': '旧', 'content/keep.md': '留', 'content/move.md': '挪' });
		const gh = backendFor(fake);
		const moveSha = await gitBlobSha('挪');
		const before = fake.ref;

		const result = await gh.commit('publish', () => [
			{ path: 'content/new.md', content: '新' },
			{ path: 'content/keep.md', content: '改' },
			{ path: 'content/old.md', delete: true },
			{ path: 'content/sub/moved.md', reuseSha: moveSha },
			{ path: 'content/move.md', delete: true },
			{ path: 'assets/bin.dat', content: new Uint8Array([0, 255, 1, 254]) },
		]);

		expect(result).toEqual({ commitSha: fake.ref, attempts: 1 });
		expect(fake.commits.get(fake.ref)!.parents).toEqual([before]);
		expect(fake.commits.get(fake.ref)!.message).toBe('publish');
		const files = fake.headFiles();
		expect([...files.keys()].sort()).toEqual(['assets/bin.dat', 'content/keep.md', 'content/new.md', 'content/sub/moved.md']);
		expect(text(files.get('content/keep.md'))).toBe('改');
		expect(files.get('assets/bin.dat')).toEqual(new Uint8Array([0, 255, 1, 254]));
		// 挪动不重新上传：只上传了 3 个 blob（新增、修改、二进制）
		expect(fake.log.filter((l) => l === 'POST /git/blobs')).toHaveLength(3);
	});

	it('build 返回空数组时不提交', async () => {
		const fake = await FakeGitHub.create({ 'a.md': 'a' });
		const before = fake.ref;
		expect(await backendFor(fake).commit('noop', () => [])).toBeUndefined();
		expect(fake.ref).toBe(before);
		expect(fake.log.some((l) => l.startsWith('POST'))).toBe(false);
	});

	it('非 fast-forward：重新取 head、重建改动后成功，外部推送的文件保留', async () => {
		const fake = await FakeGitHub.create({ 'a.md': 'a' });
		let pushed = false;
		fake.beforePatch = async () => {
			if (!pushed) {
				pushed = true;
				await fake.externalPush('external.md', '外部');
			}
		};
		const heads: string[] = [];
		const result = await backendFor(fake).commit('publish', (head) => {
			heads.push(head.commitSha);
			return [{ path: 'b.md', content: 'b' }];
		});
		expect(result?.attempts).toBe(2);
		expect(heads).toHaveLength(2);
		expect(heads[0]).not.toBe(heads[1]);
		expect([...fake.headFiles().keys()].sort()).toEqual(['a.md', 'b.md', 'external.md']);
	});

	it('非 fast-forward 重试用尽后抛 conflict', async () => {
		const fake = await FakeGitHub.create({ 'a.md': 'a' });
		let n = 0;
		fake.beforePatch = () => fake.externalPush(`ext${n++}.md`, 'x');
		const err = await backendFor(fake, { maxRetries: 2 })
			.commit('publish', () => [{ path: 'b.md', content: 'b' }])
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BackendError);
		expect((err as BackendError).kind).toBe('conflict');
		expect(fake.log.filter((l) => l.startsWith('PATCH'))).toHaveLength(3);
	});

	it('删除不存在的文件：422 且不是 fast-forward 问题，直接抛错不重试', async () => {
		const fake = await FakeGitHub.create({ 'a.md': 'a' });
		const err = await backendFor(fake)
			.commit('publish', () => [{ path: 'missing.md', delete: true }])
			.catch((e: unknown) => e);
		expect((err as BackendError).kind).toBe('invalid');
		expect((err as BackendError).message).toMatch(/missing\.md/);
		expect(fake.log.filter((l) => l === 'POST /git/trees')).toHaveLength(1);
	});
});

describe('错误分类与信息', () => {
	const failing = (status: number, headers: Record<string, string> = {}, message = 'boom'): HttpFn => async () => ({
		status,
		headers,
		json: { message },
	});
	const gh = (http: HttpFn) => new GitHubBackend({ repo: 'owner/repo', branch: 'main', token: 't', http });

	it.each([
		[401, {}, 'auth'],
		[403, {}, 'forbidden'],
		[403, { 'x-ratelimit-remaining': '0' }, 'rateLimit'],
		[429, {}, 'rateLimit'],
		[404, {}, 'notFound'],
		[500, {}, 'server'],
		[422, {}, 'invalid'],
	] as const)('HTTP %i → %s', async (status, headers, kind) => {
		const err = await gh(failing(status, headers)).getRepo().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BackendError);
		expect((err as BackendError).kind).toBe(kind);
		expect((err as BackendError).status).toBe(status);
		expect((err as BackendError).message).toContain(`HTTP ${status}`);
		expect((err as BackendError).message).toContain('boom');
	});

	it('token 错误（假 GitHub）', async () => {
		const fake = await FakeGitHub.create();
		const err = await backendFor(fake, { token: 'wrong' }).getRepo().catch((e: unknown) => e);
		expect((err as BackendError).kind).toBe('auth');
	});

	it('分支不存在', async () => {
		const fake = await FakeGitHub.create();
		const err = await backendFor(fake, { branch: 'nope' }).getHead().catch((e: unknown) => e);
		expect((err as BackendError).kind).toBe('notFound');
		expect((err as BackendError).message).toContain('nope');
	});

	it('响应格式不符时抛 unexpected 并说明字段', async () => {
		const err = await gh(async () => ({ status: 200, headers: {}, json: { private: true } }))
			.getRepo()
			.catch((e: unknown) => e);
		expect((err as BackendError).kind).toBe('unexpected');
		expect((err as BackendError).message).toContain('default_branch');
	});

	it('文件树被截断时抛错', async () => {
		const err = await gh(async () => ({ status: 200, headers: {}, json: { tree: [], truncated: true } }))
			.getTree('x')
			.catch((e: unknown) => e);
		expect((err as BackendError).message).toContain('truncated');
	});

	it('仓库格式不对时构造即报错', () => {
		expect(() => new GitHubBackend({ repo: 'bad', branch: 'main', token: 't', http: failing(200) })).toThrow(/owner\/repo/);
	});

	it('会变化的资源（仓库、分支指向、按分支读文件）绕过缓存；按 sha 读取的不加', async () => {
		const fake = await FakeGitHub.create({ 'a.md': 'a' });
		const seen: { url: string; cache?: string }[] = [];
		const http: HttpFn = (req) => {
			seen.push({ url: req.url.replace(/^.*\/repos\/[^/]+\/[^/]+/, ''), cache: req.headers['Cache-Control'] });
			return fake.http(req);
		};
		const backend = new GitHubBackend({ repo: 'o/r', branch: 'main', token: fake.token, http });
		await backend.getRepo();
		const head = await backend.getHead();
		const tree = await backend.getTree(head.treeSha);
		await backend.readBlob(tree[0]!.sha);
		await backend.readText('a.md');
		const cacheOf = (prefix: string) => seen.find((s) => (prefix === '' ? s.url === '' : s.url.startsWith(prefix)))?.cache;
		expect(cacheOf('')).toBe('no-cache');
		expect(cacheOf('/git/ref/heads/')).toBe('no-cache');
		expect(cacheOf('/contents/')).toBe('no-cache');
		expect(cacheOf('/git/commits/')).toBeUndefined();
		expect(cacheOf('/git/trees/')).toBeUndefined();
		expect(cacheOf('/git/blobs/')).toBeUndefined();
	});

	it('请求带 token 与 API 版本头，有 body 时带 Content-Type', async () => {
		const seen: Record<string, string>[] = [];
		const http: HttpFn = async (req) => {
			seen.push(req.headers);
			return { status: 201, headers: {}, json: { sha: 'x' } };
		};
		await gh(http).getRepo().catch(() => undefined);
		expect(seen[0]).toMatchObject({ Authorization: 'Bearer t', 'X-GitHub-Api-Version': '2022-11-28' });
		expect(seen[0]).not.toHaveProperty('Content-Type');
	});
});
