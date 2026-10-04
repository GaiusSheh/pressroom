import { AbstractInputSuggest, App, Modal, Setting, type TextComponent } from 'obsidian';
import { ASSETS_DIR } from '../core/attachments';
import { findConflicts, urlOf } from '../core/generator/quartz';
import { matchIgnorePattern } from '../core/generator/ignore';
import { stem } from '../core/note';
import { type SiteSnapshot, slugOwners } from '../core/publish';
import { isValidDir, isValidName, joinSitePath } from '../core/site-path';
import type { SiteConfig } from '../core/types';
import { t } from '../i18n';

/**
 * 首次发布位置弹窗（需求 §5.3，手动模式）。确认返回站内路径，取消返回 undefined。
 * unpublishedLinks：本篇中指向「未在本站发布」笔记的显示名，非空时列出并说明之后会提醒更新（需求 §7 2026-10-04 修订）
 */
export function chooseLocation(
	app: App,
	site: SiteConfig,
	snap: SiteSnapshot,
	vaultPath: string,
	unpublishedLinks: string[] = [],
): Promise<string | undefined> {
	return new Promise((resolve) => new LocationModal(app, site, snap, vaultPath, unpublishedLinks, resolve).open());
}

/** 列表最多显示的名称数，其余以「等 N 篇」概括 */
const MAX_LISTED = 5;

class LocationModal extends Modal {
	private dir = '';
	private name: string;
	private done = false;

	constructor(
		app: App,
		private readonly site: SiteConfig,
		private readonly snap: SiteSnapshot,
		private readonly vaultPath: string,
		private readonly unpublishedLinks: string[],
		private readonly resolve: (sitePath: string | undefined) => void,
	) {
		super(app);
		this.name = stem(vaultPath);
	}

	onOpen() {
		const { contentEl } = this;
		this.setTitle(t('location.title', { site: this.site.name }));

		let dirText: TextComponent | undefined;
		let nameText: TextComponent | undefined;
		const vaultDir = this.vaultPath.split('/').slice(0, -1).join('/');

		new Setting(contentEl)
			.setName(t('location.useVault'))
			.setDesc(t('location.useVault.desc'))
			.addToggle((tg) =>
				tg.setValue(false).onChange((on) => {
					// 手动模式下是一次性的填入快捷方式，不留记录（需求 §5.1）
					if (!on) return;
					this.dir = vaultDir;
					this.name = stem(this.vaultPath);
					dirText?.setValue(this.dir);
					nameText?.setValue(this.name);
					this.refresh();
				}),
			);

		new Setting(contentEl).setName(t('location.dir')).addText((text) => {
			dirText = text;
			text.setPlaceholder(t('location.dir.placeholder')).onChange((v) => {
				this.dir = v;
				this.refresh();
			});
			new DirSuggest(this.app, text.inputEl, this.existingDirs(), (v) => {
				this.dir = v;
				this.refresh();
			});
		});

		new Setting(contentEl).setName(t('location.name')).addText((text) => {
			nameText = text;
			text.setValue(this.name).onChange((v) => {
				this.name = v;
				this.refresh();
			});
		});

		const preview = new Setting(contentEl).setName(t('location.preview'));
		this.previewEl = preview.descEl;
		this.messageEl = contentEl.createDiv({ cls: 'pressroom-location-messages' });
		if (this.unpublishedLinks.length > 0) {
			const shown = this.unpublishedLinks.slice(0, MAX_LISTED);
			const rest = this.unpublishedLinks.length - shown.length;
			const names = shown.join(t('common.listSep')) + (rest > 0 ? t('location.andMore', { n: rest }) : '');
			const box = contentEl.createDiv({ cls: 'pressroom-location-unpublished setting-item-description' });
			box.createEl('p', { text: t('location.unpublishedLinks', { names }) });
			box.createEl('p', { text: t('location.unpublishedHint') });
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
			.addButton((b) => {
				this.publishButton = b.buttonEl;
				b.setButtonText(t('location.publish'))
					.setCta()
					.onClick(() => {
						if (!this.valid()) return;
						this.done = true;
						this.resolve(joinSitePath(this.dir, this.name));
						this.close();
					});
			});
		this.refresh();
	}

	onClose() {
		this.contentEl.empty();
		if (!this.done) this.resolve(undefined);
	}

	private previewEl?: HTMLElement;
	private messageEl?: HTMLElement;
	private publishButton?: HTMLButtonElement;

	/** 站上已有的目录（内容目录中所有文件的各级上级目录），供输入建议；附件目录不列出，避免把笔记发进去 */
	private existingDirs(): string[] {
		const dirs = new Set<string>();
		for (const f of this.snap.contentFiles) {
			if (f.path.startsWith(`${ASSETS_DIR}/`)) continue;
			const parts = f.path.split('/').slice(0, -1);
			for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
		}
		return [...dirs].sort();
	}

	/** 返回当前输入的错误 / 提示；有 error 时不可发布 */
	private check(): { errors: string[]; warnings: string[] } {
		const errors: string[] = [];
		const warnings: string[] = [];
		if (!isValidName(this.name)) errors.push(t('location.invalidName'));
		if (!isValidDir(this.dir)) errors.push(t('location.invalidDir'));
		if (errors.length) return { errors, warnings };
		const path = joinSitePath(this.dir, this.name);
		const conflicts = findConflicts(path, slugOwners(this.snap));
		if (conflicts.length) {
			const other = conflicts.map((c) => (c.owner.kind === 'file' ? c.owner.path : c.owner.alias)).join('、');
			errors.push(t('location.conflict', { other }));
		}
		const pattern = matchIgnorePattern(path, this.snap.ignorePatterns);
		if (pattern) warnings.push(t('location.ignored', { pattern }));
		return { errors, warnings };
	}

	private valid(): boolean {
		return this.check().errors.length === 0;
	}

	private refresh() {
		const { errors, warnings } = this.check();
		if (this.previewEl) {
			this.previewEl.setText(errors.length ? '' : urlOf(this.site.siteUrl, joinSitePath(this.dir, this.name)));
		}
		if (this.messageEl) {
			this.messageEl.empty();
			for (const e of errors) this.messageEl.createDiv({ text: e, cls: 'pressroom-conn-line mod-error' });
			for (const w of warnings) this.messageEl.createDiv({ text: w, cls: 'pressroom-conn-line mod-warn' });
		}
		if (this.publishButton) this.publishButton.disabled = errors.length > 0;
	}
}

class DirSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		input: HTMLInputElement,
		private readonly dirs: string[],
		private readonly onPick: (dir: string) => void,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		return this.dirs.filter((d) => d.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(dir: string, el: HTMLElement): void {
		el.setText(dir);
	}

	selectSuggestion(dir: string): void {
		this.setValue(dir);
		this.onPick(dir);
		this.close();
	}
}
