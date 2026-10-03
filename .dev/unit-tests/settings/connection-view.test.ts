import { beforeAll, describe, expect, it } from 'vitest';
import { BackendError } from '../../../src/core/backend/types';
import type { ConnectionResult } from '../../../src/core/connection';
import { setLanguage } from '../../../src/i18n';
import { newSite } from '../../../src/settings/settings';
import { describeConnection } from '../../../src/settings/connection-view';

const site = { ...newSite('s1', '站点 A'), repo: 'owner/repo', siteUrl: 'https://example.pages.dev' };
const okConfig = {
	ok: true as const,
	info: { linkStrategy: 'shortest' as const, linkStrategyDefaulted: false, aliasRedirects: true, ignorePatterns: [] },
};
const done = (over: Partial<Extract<ConnectionResult, { stage: 'done' }>> = {}): ConnectionResult => ({
	stage: 'done',
	defaultBranch: 'main',
	contentDirExists: true,
	fileCount: 3,
	config: okConfig,
	...over,
});

beforeAll(() => setLanguage('zh'));

describe('describeConnection', () => {
	it('全部正常：均为 ok，含文件数、策略、别名与写权限说明', () => {
		const lines = describeConnection(done(), site);
		expect(lines.every((l) => l.level === 'ok')).toBe(true);
		expect(lines.map((l) => l.text)).toEqual([
			'已连接 owner/repo 的 main 分支。',
			'内容目录 content：共 3 个文件。',
			'链接解析方式：shortest。',
			'已启用别名重定向：笔记挪动后旧网址仍可访问。',
			'写入权限无法在不写入的情况下检查，将在首次发布时确认。',
		]);
	});

	it.each([
		['auth', 'token 无效或已过期。'],
		['notFound', '找不到仓库 owner/repo，或 token 无权访问它。'],
		['forbidden', 'token 没有访问 owner/repo 的权限。'],
		['rateLimit', '已达到 GitHub 请求频率上限，请稍后再试。'],
	] as const)('仓库阶段 %s', (kind, text) => {
		const lines = describeConnection({ stage: 'repo', error: new BackendError(kind, 'x') }, site);
		expect(lines).toEqual([{ level: 'error', text }]);
	});

	it('其他错误带上原始信息', () => {
		const lines = describeConnection({ stage: 'repo', error: new BackendError('server', 'HTTP 502') }, site);
		expect(lines[0]!.text).toContain('HTTP 502');
	});

	it('分支不存在时提示默认分支', () => {
		const lines = describeConnection(
			{ stage: 'branch', error: new BackendError('notFound', 'x', 404), defaultBranch: 'v5' },
			{ ...site, branch: 'main' },
		);
		expect(lines).toEqual([{ level: 'error', text: '找不到分支 main。仓库的默认分支是 v5。' }]);
	});

	it('警告：内容目录缺失、配置缺失', () => {
		const lines = describeConnection(done({ contentDirExists: false, fileCount: 0, config: { ok: false, reason: 'missing', detail: '' } }), site);
		expect(lines.filter((l) => l.level === 'warn').map((l) => l.text)).toEqual([
			'内容目录 content 尚不存在，首次发布时会自动创建。',
			'仓库根目录没有 quartz.config.yaml，这是 Quartz 5 站点吗？',
		]);
	});

	it('警告：别名重定向关闭、baseUrl 不一致；策略为默认值时注明', () => {
		const lines = describeConnection(
			done({
				config: {
					ok: true,
					info: { linkStrategy: 'absolute', linkStrategyDefaulted: true, aliasRedirects: false, ignorePatterns: [], baseUrl: 'other.pages.dev' },
				},
			}),
			site,
		);
		const texts = lines.map((l) => l.text);
		expect(texts).toContain('链接解析方式：absolute（配置中未写，使用插件默认值）。');
		expect(lines.filter((l) => l.level === 'warn').map((l) => l.text)).toEqual([
			'未启用别名重定向：笔记挪动后旧网址将失效。',
			'Quartz 的 baseUrl 是 other.pages.dev，与这里填写的站点网址 https://example.pages.dev 不一致。',
		]);
	});

	it('baseUrl 与站点网址仅协议、末尾斜杠、大小写不同时视为一致', () => {
		const lines = describeConnection(
			done({ config: { ok: true, info: { ...okConfig.info, baseUrl: 'Example.pages.dev/' } } }),
			site,
		);
		expect(lines.some((l) => l.level === 'warn')).toBe(false);
	});

	it('内容目录为空时显示为仓库根目录', () => {
		const lines = describeConnection(done(), { ...site, contentDir: '' });
		expect(lines[1]!.text).toBe('内容目录 （仓库根目录）：共 3 个文件。');
	});
});
