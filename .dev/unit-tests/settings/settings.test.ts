import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isSiteComplete, newSite, normalizeSettings } from '../../../src/settings/settings';

describe('isSiteComplete', () => {
	it('新建站点缺仓库与网址', () => {
		expect(isSiteComplete(newSite('s1', '站点 A'))).toBe(false);
	});
	it('必填齐全', () => {
		expect(
			isSiteComplete({ ...newSite('s1', '站点 A'), repo: 'owner/repo', siteUrl: 'https://example.pages.dev' }),
		).toBe(true);
	});
});

describe('normalizeSettings', () => {
	it('无数据时返回默认设置的副本', () => {
		for (const raw of [null, undefined]) {
			const { settings, warnings } = normalizeSettings(raw);
			expect(settings).toEqual(DEFAULT_SETTINGS);
			expect(settings).not.toBe(DEFAULT_SETTINGS);
			expect(settings.propertyWhitelist).not.toBe(DEFAULT_SETTINGS.propertyWhitelist);
			expect(warnings).toEqual([]);
		}
	});

	it('非对象数据回退为默认并给出提示', () => {
		const { settings, warnings } = normalizeSettings('oops');
		expect(settings).toEqual(DEFAULT_SETTINGS);
		expect(warnings).toHaveLength(1);
	});

	it('保留合法字段，丢弃未知字段', () => {
		const site = { ...newSite('s1', '站点 A'), repo: 'owner/repo', extra: 1 };
		const { settings, warnings } = normalizeSettings({
			sites: [site],
			tokenSecretId: 'pressroom-token',
			excludedFolders: ['Private'],
			linkPolicy: 'one',
			propertyWhitelist: ['title'],
			unknown: true,
		});
		expect(warnings).toEqual([]);
		expect(settings.sites).toEqual([{ ...newSite('s1', '站点 A'), repo: 'owner/repo' }]);
		expect(settings).not.toHaveProperty('unknown');
		expect(settings.linkPolicy).toBe('one');
	});

	it('站点缺字段时补默认值，类型错误的字段回退', () => {
		const { settings } = normalizeSettings({ sites: [{ id: 's1', name: 'A', mode: 'weird', isolated: 'yes' }] });
		expect(settings.sites[0]).toEqual({ ...newSite('s1', 'A') });
	});

	it('缺少 id 的站点被忽略并提示', () => {
		const { settings, warnings } = normalizeSettings({ sites: [{ name: 'A' }, null] });
		expect(settings.sites).toEqual([]);
		expect(warnings).toHaveLength(2);
	});

	it('全局字段类型错误时回退并提示', () => {
		const { settings, warnings } = normalizeSettings({ linkPolicy: 'bad', excludedFolders: 'Private', sites: {} });
		expect(settings.linkPolicy).toBe('plain');
		expect(settings.excludedFolders).toEqual([]);
		expect(warnings).toHaveLength(3);
	});
});
