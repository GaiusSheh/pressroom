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
	findRepoBranchClash,
} from './validate';

export interface SitePageHost {
	/** 其他站点的名称（重名检查） */
	otherNames(site: SiteConfig): string[];
	/** 全部站点（仓库 + 分支重复检查） */
	allSites(): SiteConfig[];
	save(): Promise<void>;
	/** 切换目录模式（写回仓库，可能弹确认框）；结束后以 site.mode 为准刷新 */
	changeMode(site: SiteConfig, mode: DirMode): Promise<void>;
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
		this.validators = [];
		this.committers = [];

		this.text(el, 'settings.site.name', 'settings.site.name.desc', site.name, '', (v) =>
			checkSiteName(v, this.host.otherNames(site)),
			(v) => (site.name = v),
		);
		// 仓库 + 分支不能与其他站点相同（同一分支的站点会共用 manifest）
		const noClash = (candidate: { repo: string; branch: string }): Checked | undefined => {
			const clash = findRepoBranchClash({ id: site.id, ...candidate }, this.host.allSites());
			return clash ? { error: 'error.repoBranchTaken', vars: { name: clash.name } } : undefined;
		};
		this.text(el, 'settings.site.repo', 'settings.site.repo.desc', site.repo, 'owner/repo', (raw) => {
			const r = checkRepo(raw);
			return r.error ? r : (noClash({ repo: r.value, branch: site.branch }) ?? r);
		}, (v) => (site.repo = v));
		this.text(el, 'settings.site.branch', 'settings.site.branch.desc', site.branch, 'main', (raw) => {
			const r = checkBranch(raw);
			return r.error ? r : (noClash({ repo: site.repo, branch: r.value }) ?? r);
		}, (v) => (site.branch = v));
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

		// 目录模式写回仓库 manifest（需求 §5.2、§9）；失败或取消时恢复为实际模式
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
						dd.setDisabled(true);
						try {
							await this.host.changeMode(site, value as DirMode);
						} finally {
							dd.setValue(site.mode).setDisabled(false);
						}
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
		// 离开子页面时提交正在编辑的字段（输入框被移除时不一定触发 blur）
		for (const commit of this.committers) void commit();
		super.hide();
		this.host.onLeave();
	}

	/**
	 * 带校验的文本框：打字时只实时显示校验结果；离开输入框或按回车时才保存（合法时）。
	 * 不在每次按键时保存：否则打到一半的合法值（如分支 main 打到 mai）会被存下，
	 * 而最终值不合法时不保存，输入框显示的与实际保存的不一致；也避免保存未上屏的拼音。
	 */
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
		const show = (result: Checked) => errorEl.setText(result.error ? t(result.error, result.vars) : '');
		let current = value;
		let saved = value;
		const commit = async () => {
			const result = check(current);
			show(result);
			if (result.value === undefined || result.value === saved) return;
			apply(result.value);
			saved = result.value;
			await this.host.save();
			// 字段之间有联动校验（仓库 + 分支不能与其他站点重复）：保存后重新校验所有字段
			this.revalidate();
		};
		setting.addText((text) => {
			text.setPlaceholder(placeholder)
				.setValue(value)
				.onChange((raw) => {
					current = raw;
					show(check(raw));
				});
			text.inputEl.addEventListener('blur', () => void commit());
			text.inputEl.addEventListener('keydown', (e) => {
				// 输入法组字中的回车用于选词，不提交
				if (e.key === 'Enter' && !e.isComposing) void commit();
			});
		});
		this.validators.push(() => show(check(current)));
		this.committers.push(commit);
		// 已保存的值不合法（或必填为空）时，打开页面就提示
		show(check(value));
	}

	/** 各文本框的重新校验 / 提交函数（display 时重建） */
	private validators: (() => void)[] = [];
	private committers: (() => Promise<void>)[] = [];

	private revalidate() {
		for (const v of this.validators) v();
	}
}
