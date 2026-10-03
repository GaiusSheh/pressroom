import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en';
import { zh } from '../../../src/i18n/zh';
import { createTranslator, resolveLang } from '../../../src/i18n';

describe('字典', () => {
	it('中英键集合一致', () => {
		expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
	});

	it('中英文中的插值参数一致', () => {
		const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			expect(params(zh[key]), key).toEqual(params(en[key]));
		}
	});

	it('没有空文字', () => {
		for (const [key, value] of [...Object.entries(en), ...Object.entries(zh)]) {
			expect(value.trim(), key).not.toBe('');
		}
	});
});

describe('resolveLang', () => {
	it.each([
		['zh', 'zh'],
		['zh-TW', 'zh'],
		['ZH-cn', 'zh'],
		['en', 'en'],
		['en-GB', 'en'],
		['fr', 'en'],
		['', 'en'],
	] as const)('%s → %s', (code, lang) => {
		expect(resolveLang(code)).toBe(lang);
	});
});

describe('createTranslator', () => {
	it('按语言返回文字', () => {
		expect(createTranslator('zh')('settings.sites.heading')).toBe('站点');
		expect(createTranslator('en')('settings.sites.heading')).toBe('Sites');
	});

	it('插值', () => {
		expect(createTranslator('zh')('notice.published', { site: '站点 A' })).toBe(
			'已发布到「站点 A」，约 1 分钟后生效。',
		);
	});

	it('缺少参数时抛错并指出键与参数名', () => {
		expect(() => createTranslator('en')('notice.published')).toThrow(/notice\.published.*site/);
	});

	it('多余参数被忽略', () => {
		expect(createTranslator('en')('plugin.name', { x: 1 })).toBe('Pressroom');
	});
});
