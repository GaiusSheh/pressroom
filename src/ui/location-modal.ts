import { AbstractInputSuggest, App, Modal, Setting, type TextComponent } from 'obsidian';
import { ASSETS_DIR } from '../core/attachments';
import { displayUrl, findConflicts, urlOf } from '../core/generator/quartz';
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
	return new Promise((resolve) =>
		new LocationModal(app, { site, snap, vaultPath, unpublishedLinks }, resolve, {
			title: t('location.title', { site: site.name }),
			button: t('location.publish'),
		}).open(),
	);
}

/**
 * 管理面板的站内改名 / 移动（需求 §5.3，仅手动站点）：同一位置弹窗，预填当前站内位置、不含双链处理，
 * 冲突检测排除本篇当前位置。确认返回新站内路径；未改变或取消返回 undefined
 */
export function chooseMoveLocation(app: App, site: SiteConfig, snap: SiteSnapshot, vaultPath: string, sitePath: string): Promise<string | undefined> {
	const parts = sitePath.split('/');
	const initial = { dir: parts.slice(0, -1).join('/'), name: stem(sitePath) };
	return new Promise((resolve) =>
		new LocationModal(app, { site, snap, vaultPath, unpublishedLinks: [], initial, exclude: sitePath }, (p) => resolve(p === sitePath ? undefined : p), {
			title: t('move.title', { site: site.name }),
			button: t('move.confirm'),
			note: snap.aliasRedirects ? undefined : t('move.noRedirect'),
		}).open(),
	);
}

/** 列表最多显示的名称数，其余以「等 N 篇」概括 */
const MAX_LISTED = 5;

export interface LocationInput {
	site: SiteConfig;
	snap: SiteSnapshot;
	vaultPath: string;
	unpublishedLinks: string[];
	/** 预填的目录与名称（移动时为当前站内位置）；缺省为站点根 + vault 文件名 */
	initial?: { dir: string; name: string };
	/** 冲突检测排除的站内路径（移动时为本篇当前位置） */
	exclude?: string;
}

/**
 * 一个手动站点的位置填写区（目录、名称、网址预览、冲突与忽略提示、未发布链接说明）。
 * 单站弹窗与「全部站点」的分块弹窗共用
 */
export class LocationBlock {
	private dir: string;
	private name: string;
	private previewEl?: HTMLElement;
	private messageEl?: HTMLElement;

	constructor(
		private readonly app: App,
		private readonly input: LocationInput,
		/** 输入变化（调用方据此启用 / 禁用发布按钮） */
		private readonly onChange: () => void,
	) {
		this.dir = input.initial?.dir ?? '';
		this.name = input.initial?.name ?? stem(input.vaultPath);
	}

	render(el: HTMLElement) {
		const { vaultPath, unpublishedLinks } = this.input;
		let dirText: TextComponent | undefined;
		let nameText: TextComponent | undefined;
		const vaultDir = vaultPath.split('/').slice(0, -1).join('/');

		new Setting(el)
			.setName(t('location.useVault'))
			.setDesc(t('location.useVault.desc'))
			// 一次性的填入快捷方式，不留记录（需求 §5.1）。用按钮而不是开关：
			// 开关在用户随后改动目录 / 名称后仍显示为打开，容易被误解为「跟随 vault」（2026-10-05 用户决定）
			.addButton((b) =>
				b.setButtonText(t('location.useVault.button')).onClick(() => {
					this.dir = vaultDir;
					this.name = stem(vaultPath);
					dirText?.setValue(this.dir);
					nameText?.setValue(this.name);
					this.refresh();
				}),
			);

		new Setting(el).setName(t('location.dir')).addText((text) => {
			dirText = text;
			text.setPlaceholder(t('location.dir.placeholder')).setValue(this.dir).onChange((v) => {
				this.dir = v;
				this.refresh();
			});
			new DirSuggest(this.app, text.inputEl, this.existingDirs(), (v) => {
				this.dir = v;
				this.refresh();
			});
		});

		new Setting(el).setName(t('location.name')).addText((text) => {
			nameText = text;
			text.setValue(this.name).onChange((v) => {
				this.name = v;
				this.refresh();
			});
		});

		// 网址可能很长（中文百分号编码后没有断行点），允许任意位置换行，避免被截断
		const preview = new Setting(el).setName(t('location.preview')).setClass('pressroom-location-preview');
		this.previewEl = preview.descEl;
		this.messageEl = el.createDiv({ cls: 'pressroom-location-messages' });
		if (unpublishedLinks.length > 0) {
			const shown = unpublishedLinks.slice(0, MAX_LISTED);
			const rest = unpublishedLinks.length - shown.length;
			const names = shown.join(t('common.listSep')) + (rest > 0 ? t('location.andMore', { n: rest }) : '');
			const box = el.createDiv({ cls: 'pressroom-location-unpublished setting-item-description' });
			box.createEl('p', { text: t('location.unpublishedLinks', { names }) });
			box.createEl('p', { text: t('location.unpublishedHint') });
		}
		this.refresh();
	}

	valid(): boolean {
		return this.check().errors.length === 0;
	}

	sitePath(): string {
		return joinSitePath(this.dir, this.name);
	}

	/** 站上已有的目录（内容目录中所有文件的各级上级目录），供输入建议；附件目录不列出，避免把笔记发进去 */
	private existingDirs(): string[] {
		const dirs = new Set<string>();
		for (const f of this.input.snap.contentFiles) {
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
		const path = this.sitePath();
		const conflicts = findConflicts(path, slugOwners(this.input.snap), this.input.exclude);
		if (conflicts.length) {
			const other = conflicts.map((c) => (c.owner.kind === 'file' ? c.owner.path : c.owner.alias)).join('、');
			errors.push(t('location.conflict', { other }));
		}
		const pattern = matchIgnorePattern(path, this.input.snap.ignorePatterns);
		if (pattern) warnings.push(t('location.ignored', { pattern }));
		return { errors, warnings };
	}

	private refresh() {
		const { errors, warnings } = this.check();
		this.previewEl?.setText(errors.length ? '' : displayUrl(urlOf(this.input.site.siteUrl, this.sitePath())));
		if (this.messageEl) {
			this.messageEl.empty();
			for (const e of errors) this.messageEl.createDiv({ text: e, cls: 'pressroom-conn-line mod-error' });
			for (const w of warnings) this.messageEl.createDiv({ text: w, cls: 'pressroom-conn-line mod-warn' });
		}
		this.onChange();
	}
}

class LocationModal extends Modal {
	private done = false;
	private publishButton?: HTMLButtonElement;
	private readonly block: LocationBlock;

	constructor(
		app: App,
		private readonly input: LocationInput,
		private readonly resolve: (sitePath: string | undefined) => void,
		private readonly texts: { title: string; button: string; note?: string },
	) {
		super(app);
		this.block = new LocationBlock(app, input, () => this.refresh());
	}

	onOpen() {
		const { contentEl } = this;
		this.setTitle(this.texts.title);
		this.block.render(contentEl);
		if (this.texts.note) this.noteEl = contentEl.createDiv({ text: this.texts.note, cls: 'pressroom-conn-line mod-warn pressroom-location-note' });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
			.addButton((b) => {
				this.publishButton = b.buttonEl;
				b.setButtonText(this.texts.button)
					.setCta()
					.onClick(() => {
						if (!this.block.valid()) return;
						this.done = true;
						this.resolve(this.block.sitePath());
						this.close();
					});
			});
		this.refresh();
	}

	onClose() {
		this.contentEl.empty();
		if (!this.done) this.resolve(undefined);
	}

	private noteEl?: HTMLElement;

	/**
	 * 移动时位置与当前相同（exclude 即当前站内路径）：没有可移动的，禁用按钮并隐藏「旧网址将失效」的提示
	 * （GUI 测试反馈）
	 */
	private refresh() {
		const unchanged = this.input.exclude !== undefined && this.block.sitePath() === this.input.exclude;
		if (this.publishButton) this.publishButton.disabled = unchanged || !this.block.valid();
		this.noteEl?.toggle(!unchanged);
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
