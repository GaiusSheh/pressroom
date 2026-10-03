import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { GitHubBackend } from '../../../src/core/backend/github';
import { testConnection } from '../../../src/core/connection';
import { FakeGitHub } from './fake-github';

const config = `plugins:
  - source: "@quartz-community/crawl-links"
    options:
      markdownLinkResolution: shortest
  - source: "@quartz-community/alias-redirects"
`;

const run = (fake: FakeGitHub, opts: { token?: string; branch?: string; contentDir?: string } = {}) =>
	testConnection(
		new GitHubBackend({ repo: 'owner/repo', branch: opts.branch ?? 'main', token: opts.token ?? fake.token, http: fake.http }),
		opts.contentDir ?? 'content',
		parse,
	);

describe('testConnection', () => {
	it('全部正常', async () => {
		const fake = await FakeGitHub.create({ 'quartz.config.yaml': config, 'content/a.md': 'a', 'content/b/c.md': 'c' });
		const result = await run(fake);
		expect(result).toMatchObject({ stage: 'done', defaultBranch: 'main', contentDirExists: true, fileCount: 2 });
		expect(result.stage === 'done' && result.config).toMatchObject({
			ok: true,
			info: { linkStrategy: 'shortest', aliasRedirects: true },
		});
	});

	it('token 无效 → repo 阶段 auth', async () => {
		const result = await run(await FakeGitHub.create(), { token: 'wrong' });
		expect(result.stage).toBe('repo');
		expect(result.stage === 'repo' && result.error.kind).toBe('auth');
	});

	it('分支不存在 → branch 阶段，并给出默认分支', async () => {
		const result = await run(await FakeGitHub.create({ 'content/a.md': 'a' }), { branch: 'v5' });
		expect(result).toMatchObject({ stage: 'branch', defaultBranch: 'main' });
		expect(result.stage === 'branch' && result.error.kind).toBe('notFound');
	});

	it('内容目录不存在、配置文件缺失', async () => {
		const result = await run(await FakeGitHub.create({ 'docs/a.md': 'a' }));
		expect(result).toMatchObject({ stage: 'done', contentDirExists: false, fileCount: 0 });
		expect(result.stage === 'done' && result.config).toMatchObject({ ok: false, reason: 'missing' });
	});

	it('内容目录为空字符串表示仓库根', async () => {
		const result = await run(await FakeGitHub.create({ 'a.md': 'a' }), { contentDir: '' });
		expect(result).toMatchObject({ stage: 'done', contentDirExists: true, fileCount: 1 });
	});

	it('前缀相似的目录不算内容目录（content2/ 不是 content/）', async () => {
		const result = await run(await FakeGitHub.create({ 'content2/a.md': 'a' }));
		expect(result).toMatchObject({ contentDirExists: false });
	});

	it('网络错误（非 BackendError）原样抛出', async () => {
		const backend = new GitHubBackend({
			repo: 'owner/repo',
			branch: 'main',
			token: 't',
			http: () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')),
		});
		await expect(testConnection(backend, 'content', parse)).rejects.toThrow('ERR_INTERNET_DISCONNECTED');
	});
});
