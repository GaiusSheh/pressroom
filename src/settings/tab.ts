import {
	App,
	PluginSettingTab,
	SecretComponent,
	type SettingDefinitionItem,
	type SettingGroupItem,
	parseYaml,
} from 'obsidian';
import type PressroomPlugin from '../main';
import { GitHubBackend } from '../core/backend/github';
import { testConnection } from '../core/connection';
import type { LinkPolicy, SiteConfig } from '../core/types';
import { obsidianHttp } from '../platform/http';
import { type Line, describeConnection } from './connection-view';
import { t } from '../i18n';
import { confirm } from '../ui/confirm-modal';
import { isSiteComplete, newSite } from './settings';
import { SitePage, type SitePageHost } from './site-page';
import { parseFolders, parseList } from './validate';

/**
 * 声明式设置页（Obsidian 1.13+）。
 * 全局设置用声明式控件（键即字段名）；站点列表用 list，每个站点的子页面见 site-page.ts
 */
export class PressroomSettingTab extends PluginSettingTab {
	private readonly siteHost: SitePageHost;

	constructor(
		app: App,
		private readonly plugin: PressroomPlugin,
	) {
		super(app, plugin);
		this.siteHost = {
			otherNames: (site) => this.settings.sites.filter((s) => s.id !== site.id).map((s) => s.name),
			allSites: () => this.settings.sites,
			save: () => this.plugin.saveSettings(),
			remove: (site) => this.removeSite(site),
			testConnection: (site) => this.testSite(site),
			onLeave: () => this.update(),
		};
	}

	private get settings() {
		return this.plugin.settings;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: t('settings.global.heading'),
				items: [
					{
						name: t('settings.token.name'),
						desc: t('settings.token.desc'),
						render: (setting) => {
							setting.addComponent((el) =>
								new SecretComponent(this.app, el)
									.setValue(this.settings.tokenSecretId)
									.onChange(async (id) => {
										this.settings.tokenSecretId = id;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: t('settings.excluded.name'),
						desc: t('settings.excluded.desc'),
						control: { type: 'textarea', key: 'excludedFolders', placeholder: 'Private', rows: 3 },
					},
					{
						name: t('settings.linkPolicy.name'),
						desc: t('settings.linkPolicy.desc'),
						control: {
							type: 'dropdown',
							key: 'linkPolicy',
							options: {
								plain: t('settings.linkPolicy.plain'),
								one: t('settings.linkPolicy.one'),
								all: t('settings.linkPolicy.all'),
							} satisfies Record<LinkPolicy, string>,
						},
					},
					{
						name: t('settings.whitelist.name'),
						desc: t('settings.whitelist.desc'),
						control: { type: 'text', key: 'propertyWhitelist' },
					},
				],
			},
			{
				type: 'list',
				heading: t('settings.sites.heading'),
				emptyState: t('settings.sites.empty'),
				addItem: {
					name: t('settings.sites.add'),
					action: () => void this.addSite(),
				},
				// 框架对 page 类型条目不显示删除按钮，仅支持选中后按 Delete；子页面内另有「移除站点」按钮
				onDelete: (index) => {
					const site = this.settings.sites[index];
					if (site) void this.removeSite(site).then((removed) => removed && this.update());
				},
				items: this.settings.sites.map((site) => this.siteEntry(site)),
			},
		];
	}

	private siteEntry(site: SiteConfig): SettingGroupItem {
		return {
			type: 'page',
			name: site.name,
			displayValue: () => site.repo,
			status: () => (isSiteComplete(site) ? null : 'warning'),
			page: () => new SitePage(site, this.siteHost),
		};
	}

	getControlValue(key: string): unknown {
		const s = this.settings;
		switch (key) {
			case 'excludedFolders':
				return s.excludedFolders.join('\n');
			case 'propertyWhitelist':
				return s.propertyWhitelist.join(', ');
			case 'linkPolicy':
				return s.linkPolicy;
			default:
				throw new Error(`未知的设置键：${key}`);
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.settings;
		switch (key) {
			case 'excludedFolders':
				s.excludedFolders = parseFolders(String(value));
				break;
			case 'propertyWhitelist':
				s.propertyWhitelist = parseList(String(value));
				break;
			case 'linkPolicy':
				s.linkPolicy = value as LinkPolicy;
				break;
			default:
				throw new Error(`未知的设置键：${key}`);
		}
		await this.plugin.saveSettings();
	}

	private async addSite() {
		const n = this.settings.sites.length + 1;
		this.settings.sites.push(newSite(crypto.randomUUID(), t('settings.sites.defaultName', { n })));
		await this.plugin.saveSettings();
		this.update();
	}

	private async testSite(site: SiteConfig): Promise<Line[]> {
		const token = this.plugin.getToken();
		if (!token) return [{ level: 'error', text: t('conn.noToken') }];
		if (!site.repo || !site.branch) return [{ level: 'error', text: t('conn.incomplete') }];
		const backend = new GitHubBackend({ repo: site.repo, branch: site.branch, token, http: obsidianHttp });
		try {
			return describeConnection(await testConnection(backend, site.contentDir, parseYaml), site);
		} catch (e) {
			// 非 BackendError：网络断开、DNS 失败等
			return [{ level: 'error', text: t('conn.network', { message: e instanceof Error ? e.message : String(e) }) }];
		}
	}

	/** 确认后移除站点并保存；不调用 update()（在子页面内调用会使页面变空白），由调用方决定何时刷新 */
	private async removeSite(site: SiteConfig): Promise<boolean> {
		const ok = await confirm(this.app, {
			title: t('settings.site.delete.title', { name: site.name }),
			body: t('settings.site.delete.body'),
			confirmText: t('common.remove'),
			cancelText: t('common.cancel'),
			destructive: true,
		});
		if (!ok) return false;
		this.settings.sites = this.settings.sites.filter((s) => s.id !== site.id);
		await this.plugin.saveSettings();
		return true;
	}
}
