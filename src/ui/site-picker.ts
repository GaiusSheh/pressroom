import { App, SuggestModal } from 'obsidian';
import type { SiteConfig } from '../core/types';

export interface SiteItem {
	site: SiteConfig;
	/** 显示在站点名后的状态，如「✓ 已同步」 */
	note?: string;
	/** 灰显且不可选（如撤稿时未发布的站点） */
	disabled?: boolean;
}

/** 站点选择弹窗（需求 §4 方案 B：一级菜单项 + 站点列表）。选中返回站点，关闭或选中灰显项返回 undefined */
export function pickSite(app: App, items: SiteItem[], placeholder: string): Promise<SiteConfig | undefined> {
	return new Promise((resolve) => {
		new SitePickerModal(app, items, placeholder, resolve).open();
	});
}

class SitePickerModal extends SuggestModal<SiteItem> {
	private chosen = false;

	constructor(
		app: App,
		private readonly items: SiteItem[],
		placeholder: string,
		private readonly resolve: (site: SiteConfig | undefined) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): SiteItem[] {
		const q = query.trim().toLowerCase();
		return this.items.filter((i) => i.site.name.toLowerCase().includes(q) || i.site.repo.toLowerCase().includes(q));
	}

	renderSuggestion(item: SiteItem, el: HTMLElement): void {
		if (item.disabled) el.addClass('pressroom-suggestion-disabled');
		const row = el.createDiv({ cls: 'pressroom-suggestion-row' });
		row.createSpan({ text: item.site.name });
		if (item.note) row.createSpan({ text: item.note, cls: 'pressroom-suggestion-note' });
	}

	onChooseSuggestion(item: SiteItem): void {
		this.chosen = true;
		this.resolve(item.disabled ? undefined : item.site);
	}

	onClose(): void {
		// onChooseSuggestion 在 onClose 之后触发，延后判断是否选中
		window.setTimeout(() => {
			if (!this.chosen) this.resolve(undefined);
		}, 0);
	}
}
