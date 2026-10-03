import { App, SuggestModal } from 'obsidian';
import type { SiteConfig } from '../core/types';

/** 站点选择弹窗（需求 §4 方案 B：一级菜单项 + 站点列表）。选中返回站点，关闭返回 undefined */
export function pickSite(app: App, sites: SiteConfig[], placeholder: string): Promise<SiteConfig | undefined> {
	return new Promise((resolve) => {
		new SitePickerModal(app, sites, placeholder, resolve).open();
	});
}

class SitePickerModal extends SuggestModal<SiteConfig> {
	private chosen = false;

	constructor(
		app: App,
		private readonly sites: SiteConfig[],
		placeholder: string,
		private readonly resolve: (site: SiteConfig | undefined) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): SiteConfig[] {
		const q = query.trim().toLowerCase();
		return this.sites.filter((s) => s.name.toLowerCase().includes(q) || s.repo.toLowerCase().includes(q));
	}

	renderSuggestion(site: SiteConfig, el: HTMLElement): void {
		el.createDiv({ text: site.name });
		el.createEl('small', { text: site.repo, cls: 'pressroom-suggestion-note' });
	}

	onChooseSuggestion(site: SiteConfig): void {
		this.chosen = true;
		this.resolve(site);
	}

	onClose(): void {
		// onChooseSuggestion 在 onClose 之后触发，延后判断是否选中
		window.setTimeout(() => {
			if (!this.chosen) this.resolve(undefined);
		}, 0);
	}
}
