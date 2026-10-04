import { App, Modal, Setting } from 'obsidian';
import type { SiteConfig } from '../core/types';
import { t } from '../i18n';
import { type LocationInput, LocationBlock } from './location-modal';

export interface AllSitesInput {
	/** 首次发布的手动站点：各自填写位置 */
	manual: LocationInput[];
	/** 首次发布的跟随 vault 站点：位置固定为 vault 位置 */
	follow: SiteConfig[];
	/** 已发布过的站点：直接更新，只列名称 */
	updating: SiteConfig[];
	vaultPath: string;
}

/**
 * 「发布 → 全部站点」中首次发布的位置弹窗（需求 §5.3）：按站点分块，手动块填目录 / 名称，
 * 跟随块显示固定的 vault 位置。确认返回 手动站点 id → 站内路径；取消返回 undefined
 */
export function chooseAllLocations(app: App, input: AllSitesInput): Promise<Map<string, string> | undefined> {
	return new Promise((resolve) => new AllSitesModal(app, input, resolve).open());
}

class AllSitesModal extends Modal {
	private done = false;
	private button?: HTMLButtonElement;
	private readonly blocks: { site: SiteConfig; block: LocationBlock }[];

	constructor(
		app: App,
		private readonly input: AllSitesInput,
		private readonly resolve: (paths: Map<string, string> | undefined) => void,
	) {
		super(app);
		this.blocks = input.manual.map((m) => ({ site: m.site, block: new LocationBlock(app, m, () => this.refresh()) }));
	}

	onOpen() {
		const { contentEl, input } = this;
		this.setTitle(t('all.title'));
		for (const { site, block } of this.blocks) {
			new Setting(contentEl).setName(site.name).setHeading();
			block.render(contentEl.createDiv({ cls: 'pressroom-all-block' }));
		}
		for (const site of input.follow) {
			new Setting(contentEl).setName(site.name).setHeading();
			contentEl.createDiv({ text: t('all.followBlock', { path: input.vaultPath }), cls: 'setting-item-description pressroom-all-block' });
		}
		if (input.updating.length) {
			contentEl.createEl('p', {
				text: t('all.updating', { names: input.updating.map((s) => s.name).join(t('common.listSep')) }),
				cls: 'setting-item-description',
			});
		}
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
			.addButton((b) => {
				this.button = b.buttonEl;
				b.setButtonText(t('location.publish'))
					.setCta()
					.onClick(() => {
						if (!this.valid()) return;
						this.done = true;
						this.resolve(new Map(this.blocks.map(({ site, block }) => [site.id, block.sitePath()])));
						this.close();
					});
			});
		this.refresh();
	}

	onClose() {
		this.contentEl.empty();
		if (!this.done) this.resolve(undefined);
	}

	private valid(): boolean {
		return this.blocks.every(({ block }) => block.valid());
	}

	private refresh() {
		if (this.button) this.button.disabled = !this.valid();
	}
}
