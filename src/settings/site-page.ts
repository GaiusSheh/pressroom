import { SettingPage, Setting } from 'obsidian';
import type { DirMode, SiteConfig } from '../core/types';
import { type MessageKey, t } from '../i18n';
import type { Line } from './connection-view';
import {
	type Checked,
	checkBranch,
	checkContentDir,
	checkRepo,
	checkSiteName,
	checkSiteUrl,
} from './validate';

export interface SitePageHost {
	/** 其他站点的名称（重名检查） */
	otherNames(site: SiteConfig): string[];
	save(): Promise<void>;
	/** 确认后移除站点；用户取消返回 false */
	remove(site: SiteConfig): Promise<boolean>;
	/** 测试连接，返回要显示的结果行 */
	testConnection(site: SiteConfig): Promise<Line[]>;
	/** 离开子页面时调用：重建设置定义，刷新站点列表入口的名称与状态 */
	onLeave(): void;
}

/**
 * 站点子页面（命令式渲染）。
 * 不用声明式 items：在子页面内调用 tab.update() 会使打开的子页面变空白、并打断输入法组字，
 * 因此改为离开子页面（hide）时再刷新列表。
 */
export class SitePage extends SettingPage {
	constructor(
		private readonly site: SiteConfig,
		private readonly host: SitePageHost,
	) {
		super();
		this.title = site.name;
	}

	display(): void {
		const { containerEl: el, site } = this;
		el.empty();

		this.text(el, 'settings.site.name', 'settings.site.name.desc', site.name, '', (v) =>
			checkSiteName(v, this.host.otherNames(site)),
			(v) => (site.name = v),
		);
		this.text(el, 'settings.site.repo', 'settings.site.repo.desc', site.repo, 'owner/repo', checkRepo, (v) => (site.repo = v));
		this.text(el, 'settings.site.branch', 'settings.site.branch.desc', site.branch, 'main', checkBranch, (v) => (site.branch = v));
		this.text(
			el,
			'settings.site.contentDir',
			'settings.site.contentDir.desc',
			site.contentDir,
			'content',
			checkContentDir,
			(v) => (site.contentDir = v),
		);
		this.text(
			el,
			'settings.site.siteUrl',
			'settings.site.siteUrl.desc',
			site.siteUrl,
			'https://example.pages.dev',
			checkSiteUrl,
			(v) => (site.siteUrl = v),
		);

		// 目录模式在 Phase 1 只存本地；写回仓库 manifest 与切换确认随 Phase 4 实现
		new Setting(el)
			.setName(t('settings.site.mode'))
			.setDesc(t('settings.site.mode.desc'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						manual: t('settings.site.mode.manual'),
						follow: t('settings.site.mode.follow'),
					} satisfies Record<DirMode, string>)
					.setValue(site.mode)
					.onChange(async (value) => {
						site.mode = value as DirMode;
						await this.host.save();
					}),
			);

		new Setting(el)
			.setName(t('settings.site.isolated'))
			.setDesc(t('settings.site.isolated.desc'))
			.addToggle((tg) =>
				tg.setValue(site.isolated).onChange(async (value) => {
					site.isolated = value;
					await this.host.save();
				}),
			);

		const test = new Setting(el).setName(t('settings.site.test')).setDesc(t('settings.site.test.desc'));
		const resultEl = el.createDiv({ cls: 'pressroom-conn-result' });
		test.addButton((b) =>
			b.setButtonText(t('settings.site.test.button')).onClick(async () => {
				b.setDisabled(true);
				resultEl.empty();
				resultEl.createDiv({ text: t('settings.site.test.running') });
				try {
					const lines = await this.host.testConnection(site);
					resultEl.empty();
					for (const line of lines) {
						resultEl.createDiv({ text: line.text, cls: `pressroom-conn-line mod-${line.level}` });
					}
				} finally {
					b.setDisabled(false);
				}
			}),
		);

		new Setting(el)
			.setName(t('settings.site.delete'))
			.setDesc(t('settings.site.delete.body'))
			.addButton((b) =>
				b
					.setButtonText(t('common.remove'))
					.setDestructive()
					.onClick(async () => {
						if (!(await this.host.remove(site))) return;
						// API 不提供以代码返回上一页；清空内容并提示，返回时 hide() 会刷新列表
						el.empty();
						el.createEl('p', { text: t('settings.site.removed'), cls: 'setting-item-description' });
					}),
			);
	}

	hide(): void {
		super.hide();
		this.host.onLeave();
	}

	/** 带校验的文本框：校验失败时在说明下方显示错误且不保存 */
	private text(
		el: HTMLElement,
		nameKey: MessageKey,
		descKey: MessageKey,
		value: string,
		placeholder: string,
		check: (raw: string) => Checked,
		apply: (value: string) => void,
	) {
		const setting = new Setting(el).setName(t(nameKey)).setDesc(t(descKey));
		const errorEl = setting.descEl.createDiv({ cls: 'pressroom-field-error' });
		const show = (result: Checked) => errorEl.setText(result.error ? t(result.error) : '');
		setting.addText((text) =>
			text
				.setPlaceholder(placeholder)
				.setValue(value)
				.onChange(async (raw) => {
					const result = check(raw);
					show(result);
					if (result.value === undefined) return;
					apply(result.value);
					await this.host.save();
				}),
		);
		// 已保存的值不合法（或必填为空）时，打开页面就提示
		show(check(value));
	}
}
