import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readSiteConfig } from '../../../src/core/generator/quartz';

// fixtures/quartz.config.default.yaml 为 Quartz 5（v5 分支 97a2d05）自带的默认配置
const defaultConfig = fs.readFileSync(path.join(__dirname, 'fixtures', 'quartz.config.default.yaml'), 'utf-8');
const defaultIgnorePatterns = (parse(defaultConfig) as { configuration: { ignorePatterns: string[] } }).configuration
	.ignorePatterns;

const withCrawl = (options: string, aliasEnabled = true) => `
configuration:
  baseUrl: example.pages.dev
plugins:
  - source: github:quartz-community/crawl-links
    enabled: true
${options}
  - source: "@quartz-community/alias-redirects"
    enabled: ${aliasEnabled}
`;

describe('readSiteConfig', () => {
	it('Quartz 5 默认配置：shortest、AliasRedirects 启用', () => {
		expect(defaultIgnorePatterns).toHaveLength(3);
		const result = readSiteConfig(defaultConfig, parse);
		expect(result).toEqual({
			ok: true,
			info: {
				linkStrategy: 'shortest',
				linkStrategyDefaulted: false,
				aliasRedirects: true,
				// 期望值取配置文件原值（其中含 Quartz 忽略的 Obsidian 配置目录名，lint 不允许写成字面量）
				ignorePatterns: defaultIgnorePatterns,
				baseUrl: 'quartz.jzhao.xyz',
			},
		});
	});

	it('relative 配置；source 写作 github: 形式也能识别', () => {
		const result = readSiteConfig(withCrawl('    options:\n      markdownLinkResolution: relative'), parse);
		expect(result.ok && result.info.linkStrategy).toBe('relative');
		expect(result.ok && result.info.linkStrategyDefaulted).toBe(false);
	});

	it('未写 markdownLinkResolution 时用 CrawlLinks 插件默认值 absolute 并标记', () => {
		const result = readSiteConfig(withCrawl(''), parse);
		expect(result.ok && result.info).toMatchObject({ linkStrategy: 'absolute', linkStrategyDefaulted: true });
	});

	it('取值不识别时视同未配置', () => {
		const result = readSiteConfig(withCrawl('    options:\n      markdownLinkResolution: nearest'), parse);
		expect(result.ok && result.info).toMatchObject({ linkStrategy: 'absolute', linkStrategyDefaulted: true });
	});

	it('AliasRedirects 关闭或缺失', () => {
		const off = readSiteConfig(withCrawl('', false), parse);
		expect(off.ok && off.info.aliasRedirects).toBe(false);
		const missing = readSiteConfig('plugins:\n  - source: "@quartz-community/crawl-links"\n', parse);
		expect(missing.ok && missing.info.aliasRedirects).toBe(false);
	});

	it('文件不存在', () => {
		expect(readSiteConfig(undefined, parse)).toMatchObject({ ok: false, reason: 'missing' });
	});

	it('YAML 语法错误', () => {
		expect(readSiteConfig('plugins: [unclosed', parse)).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('没有 plugins 列表（如 Quartz 4 或其他文件）', () => {
		expect(readSiteConfig('title: hello\n', parse)).toMatchObject({ ok: false, reason: 'invalid' });
		expect(readSiteConfig('just a string', parse)).toMatchObject({ ok: false, reason: 'invalid' });
	});
});
