import { App, Modal, Setting } from 'obsidian';
import type { CompanionScan } from '../core/companions';
import type { LinkPolicy, SiteConfig } from '../core/types';
import { t } from '../i18n';
import { confirm } from './confirm-modal';

/** 一次连带超过此数量时再确认一次（Phase 4 详细计划 4-4 技术风险） */
const MANY_COMPANIONS = 50;

export interface CompanionsOptions {
	site: SiteConfig;
	/** 更新已发布的笔记（标题与说明不同） */
	update: boolean;
	defaultPolicy: LinkPolicy;
	/** 一层的收集结果（打开弹窗前已算好，用于判断是否需要弹窗） */
	one: CompanionScan;
	/** 到底的收集（选择「到底」时才计算） */
	scanAll: () => Promise<CompanionScan>;
	/** 网址冲突说明；无冲突返回 undefined（有冲突的不能勾选） */
	conflict: (vaultPath: string) => string | undefined;
}

/**
 * 跟随 vault 站点的双链处理与连带清单（需求 §7）：三选一 + 可取消勾选的清单（站内位置 = vault 位置）。
 * 确认返回要一并发布的笔记（vault 路径；选纯文本时为空）；取消返回 undefined
 */
export function chooseCompanions(app: App, options: CompanionsOptions): Promise<string[] | undefined> {
	return new Promise((resolve) => new CompanionsModal(app, options, resolve).open());
}

class CompanionsModal extends Modal {
	private policy: LinkPolicy;
	private all?: CompanionScan;
	/** 用户取消勾选的（切换一层 / 到底时保留） */
	private readonly unchecked = new Set<string>();
	private done = false;
	private listEl?: HTMLElement;
	private countEl?: HTMLElement;
	private button?: HTMLButtonElement;

	constructor(
		app: App,
		private readonly options: CompanionsOptions,
		private readonly resolve: (paths: string[] | undefined) => void,
	) {
		super(app);
		this.policy = options.defaultPolicy;
	}

	onOpen() {
		const { contentEl, options } = this;
		const n = options.one.paths.length;
		this.setTitle(t(options.update ? 'companions.updateTitle' : 'companions.title', { site: options.site.name }));
		contentEl.createEl('p', { text: t(options.update ? 'companions.updateBody' : 'companions.body', { n }) });
		new Setting(contentEl).setName(t('settings.linkPolicy.name')).addDropdown((dd) =>
			dd
				.addOptions({
					plain: t('settings.linkPolicy.plain'),
					one: t('settings.linkPolicy.one'),
					all: t('settings.linkPolicy.all'),
				} satisfies Record<LinkPolicy, string>)
				.setValue(this.policy)
				.onChange((v) => {
					this.policy = v as LinkPolicy;
					void this.render();
				}),
		);
		this.listEl = contentEl.createDiv({ cls: 'pressroom-companions' });
		this.countEl = contentEl.createDiv({ cls: 'setting-item-description' });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
			.addButton((b) => {
				this.button = b.buttonEl;
				b.setButtonText(t(options.update ? 'companions.update' : 'companions.publish'))
					.setCta()
					.onClick(() => void this.submit());
			});
		void this.render();
	}

	onClose() {
		this.contentEl.empty();
		if (!this.done) this.resolve(undefined);
	}

	/** 当前处理方式下的清单 */
	private async current(): Promise<CompanionScan | undefined> {
		if (this.policy === 'plain') return undefined;
		if (this.policy === 'one') return this.options.one;
		this.all ??= await this.options.scanAll();
		return this.all;
	}

	private selected(scan: CompanionScan | undefined): string[] {
		return (scan?.paths ?? []).filter((p) => !this.unchecked.has(p) && this.options.conflict(p) === undefined);
	}

	private async render() {
		const list = this.listEl;
		if (!list) return;
		list.empty();
		if (this.policy === 'all' && !this.all) {
			list.createDiv({ text: t('companions.loading'), cls: 'setting-item-description' });
			if (this.button) this.button.disabled = true;
		}
		const policy = this.policy;
		const scan = await this.current();
		if (policy !== this.policy) return; // 计算期间用户又换了选项
		list.empty();
		if (this.button) this.button.disabled = false;
		if (!scan) {
			list.createDiv({ text: t('companions.plainHint'), cls: 'setting-item-description' });
			this.countEl?.setText('');
			return;
		}
		list.createDiv({ text: t('companions.listHeading'), cls: 'setting-item-description' });
		for (const path of scan.paths) {
			const conflict = this.options.conflict(path);
			const row = list.createEl('label', { cls: 'pressroom-companion-row' });
			const box = row.createEl('input', { type: 'checkbox' });
			box.checked = conflict === undefined && !this.unchecked.has(path);
			box.disabled = conflict !== undefined;
			box.addEventListener('change', () => {
				if (box.checked) this.unchecked.delete(path);
				else this.unchecked.add(path);
				this.updateCount(scan);
			});
			row.createSpan({ text: path });
			if (conflict !== undefined) row.createSpan({ text: conflict, cls: 'pressroom-companion-conflict' });
		}
		if (scan.truncated) {
			list.createDiv({ text: t('companions.truncated', { n: scan.paths.length }), cls: 'pressroom-conn-line mod-warn' });
		}
		this.updateCount(scan);
	}

	private updateCount(scan: CompanionScan) {
		this.countEl?.setText(t('companions.count', { n: this.selected(scan).length }));
	}

	private async submit() {
		const paths = this.selected(await this.current());
		if (paths.length > MANY_COMPANIONS) {
			const ok = await confirm(this.app, {
				title: t('companions.many.title', { n: paths.length }),
				body: t('companions.many.body', { n: paths.length, site: this.options.site.name }),
				confirmText: t(this.options.update ? 'companions.update' : 'companions.publish'),
				cancelText: t('common.cancel'),
			});
			if (!ok) return;
		}
		this.done = true;
		this.resolve(paths);
		this.close();
	}
}
