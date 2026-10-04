import { App, SuggestModal } from 'obsidian';
import type { SiteConfig } from '../core/types';

export interface SiteItem {
	site: SiteConfig;
	/** 显示在站点名后的状态，如「✓ 已同步」 */
	note?: string;
	/** 灰显且不可选（如撤稿时未发布的站点） */
	disabled?: boolean;
}

/** 列表末尾的「全部站点」项（需求 §4） */
export interface AllItem {
	label: string;
	disabled?: boolean;
}

type Entry = { kind: 'site'; item: SiteItem } | { kind: 'all'; item: AllItem };

/**
 * 站点选择弹窗（需求 §4 方案 B：一级菜单项 + 站点列表）。选中返回站点或 'all'，关闭或选中灰显项返回 undefined
 */
export function pickSite(app: App, items: SiteItem[], placeholder: string, all?: AllItem): Promise<SiteConfig | 'all' | undefined> {
	const entries: Entry[] = items.map((item) => ({ kind: 'site', item }));
	if (all) entries.push({ kind: 'all', item: all });
	return new Promise((resolve) => {
		new SitePickerModal(app, entries, placeholder, resolve).open();
	});
}

class SitePickerModal extends SuggestModal<Entry> {
	private chosen = false;

	constructor(
		app: App,
		private readonly entries: Entry[],
		placeholder: string,
		private readonly resolve: (site: SiteConfig | 'all' | undefined) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): Entry[] {
		const q = query.trim().toLowerCase();
		return this.entries.filter((e) =>
			e.kind === 'all'
				? e.item.label.toLowerCase().includes(q)
				: e.item.site.name.toLowerCase().includes(q) || e.item.site.repo.toLowerCase().includes(q),
		);
	}

	renderSuggestion(entry: Entry, el: HTMLElement): void {
		if (entry.item.disabled) el.addClass('pressroom-suggestion-disabled');
		if (entry.kind === 'all') {
			el.addClass('pressroom-suggestion-all');
			el.createDiv({ text: entry.item.label });
			return;
		}
		const row = el.createDiv({ cls: 'pressroom-suggestion-row' });
		row.createSpan({ text: entry.item.site.name });
		if (entry.item.note) row.createSpan({ text: entry.item.note, cls: 'pressroom-suggestion-note' });
	}

	onChooseSuggestion(entry: Entry): void {
		this.chosen = true;
		if (entry.item.disabled) this.resolve(undefined);
		else this.resolve(entry.kind === 'all' ? 'all' : entry.item.site);
	}

	onClose(): void {
		// onChooseSuggestion 在 onClose 之后触发，延后判断是否选中
		window.setTimeout(() => {
			if (!this.chosen) this.resolve(undefined);
		}, 0);
	}
}
