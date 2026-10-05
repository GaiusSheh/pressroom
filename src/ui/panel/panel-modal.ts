// 管理面板（需求 §6；Phase 5 详细计划 5-2 ~ 5-4）：ribbon 呼出的弹窗，每个站点一个选项卡，
// 主体为站内目录树（只含 Pressroom 管理的笔记），顶部为批量按钮。目录树先显示，状态逐篇计算后填入

import { App, Menu, Modal, Notice, TFile, setIcon } from 'obsidian';
import type PressroomPlugin from '../../main';
import { urlOf } from '../../core/generator/quartz';
import type { NoteRecord } from '../../core/manifest/manifest';
import { stem } from '../../core/note';
import { type BatchKind, type PanelStatus, type TreeFolder, availableBatches, batchTargets, buildTree } from '../../core/panel';
import type { SiteSnapshot } from '../../core/publish';
import type { SiteConfig } from '../../core/types';
import { t } from '../../i18n';
import { describeError } from '../errors';

interface SiteState {
	snap?: SiteSnapshot;
	error?: string;
	statuses: Map<string, PanelStatus>;
	/** 状态全部算完 */
	done: boolean;
}

export class PanelModal extends Modal {
	private current?: SiteConfig;
	private readonly states = new Map<string, SiteState>();
	private closed = false;
	private tabsEl!: HTMLElement;
	private toolbarEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	/** 当前选项卡中各篇的状态标签元素（逐篇填入时只更新这一格） */
	private statusEls = new Map<string, HTMLElement>();

	constructor(
		app: App,
		private readonly plugin: PressroomPlugin,
	) {
		super(app);
	}

	private get actions() {
		return this.plugin.actions;
	}

	onOpen() {
		this.modalEl.addClass('pressroom-panel');
		this.setTitle(t('panel.title'));
		const { sites, clashing } = this.actions.panelSites();
		const { contentEl } = this;
		if (clashing.length) {
			contentEl.createDiv({
				text: t('notice.repoClash', { names: clashing.map((s) => s.name).join(t('common.listSep')) }),
				cls: 'pressroom-conn-line mod-warn',
			});
		}
		if (sites.length === 0) {
			contentEl.createEl('p', { text: t('notice.noSites'), cls: 'setting-item-description' });
			return;
		}
		this.tabsEl = contentEl.createDiv({ cls: 'pressroom-panel-tabs' });
		for (const site of sites) {
			const tab = this.tabsEl.createEl('button', { text: site.name, cls: 'pressroom-panel-tab' });
			tab.dataset.site = site.id;
			tab.addEventListener('click', () => this.select(site));
		}
		this.toolbarEl = contentEl.createDiv({ cls: 'pressroom-panel-toolbar' });
		this.bodyEl = contentEl.createDiv({ cls: 'pressroom-panel-body' });
		this.select(sites[0]!);
	}

	onClose() {
		this.closed = true;
		this.contentEl.empty();
	}

	private select(site: SiteConfig) {
		this.current = site;
		for (const el of Array.from(this.tabsEl.children) as HTMLElement[]) {
			el.toggleClass('is-active', el.dataset.site === site.id);
		}
		const state = this.states.get(site.id);
		if (state) this.render();
		else void this.load(site);
	}

	/** 读取快照并逐篇计算状态；各选项卡独立加载、结果缓存，关闭面板时停止 */
	private async load(site: SiteConfig) {
		const state: SiteState = { statuses: new Map(), done: false };
		this.states.set(site.id, state);
		if (this.current === site) this.render();
		try {
			state.snap = await this.actions.panelSnapshot(site);
		} catch (e) {
			state.error = describeError(e, site.repo);
			if (this.current === site) this.render();
			return;
		}
		if (this.current === site) this.render();
		await this.actions.panelStatuses(
			site,
			state.snap,
			(vaultPath, status) => {
				state.statuses.set(vaultPath, status);
				if (this.current !== site || this.states.get(site.id) !== state) return;
				const el = this.statusEls.get(vaultPath);
				if (el) this.paintStatus(el, status);
				this.renderToolbar();
			},
			() => this.closed || this.states.get(site.id) !== state,
		);
		state.done = true;
		if (this.current === site && this.states.get(site.id) === state) this.renderToolbar();
	}

	/** 操作完成后重新读取该站 */
	private async reload(site: SiteConfig) {
		if (this.closed) return;
		await this.load(site);
	}

	private render() {
		const site = this.current;
		if (!site) return;
		const state = this.states.get(site.id);
		this.renderToolbar();
		this.bodyEl.empty();
		this.statusEls.clear();
		if (!state || (!state.snap && !state.error)) {
			this.bodyEl.createDiv({ text: t('notice.loading'), cls: 'setting-item-description' });
			return;
		}
		if (state.error || !state.snap) {
			this.bodyEl.createDiv({ text: state.error ?? '', cls: 'pressroom-conn-line mod-error' });
			return;
		}
		const records = state.snap.manifest.notes;
		if (records.length === 0) {
			this.bodyEl.createDiv({ text: t('panel.empty'), cls: 'setting-item-description' });
			return;
		}
		this.renderFolder(this.bodyEl, buildTree(records), site, state);
	}

	private renderToolbar() {
		const site = this.current;
		if (!site) return;
		const state = this.states.get(site.id);
		this.toolbarEl.empty();
		const snap = state?.snap;
		if (snap && state) {
			const records = snap.manifest.notes;
			const status = (p: string): PanelStatus => state.statuses.get(p) ?? { kind: 'loading' };
			for (const kind of availableBatches(snap.manifest.mode, snap.linkStrategy)) {
				const targets = batchTargets(kind, records, status);
				const btn = this.toolbarEl.createEl('button', { text: t(`batch.${kind}.button` as const, { n: targets.length }) });
				// 只有确实有要清理的笔记时才用醒目的警示色
				if (kind === 'cleanup' && targets.length > 0) btn.addClass('mod-warning');
				// 状态全部算完前不允许批量操作（避免只作用于部分笔记）
				btn.disabled = !state.done || targets.length === 0;
				btn.addEventListener('click', () => void this.batch(site, kind, targets));
			}
			const progress = state.done ? '' : t('panel.computing', { done: state.statuses.size, n: records.length });
			if (progress) this.toolbarEl.createSpan({ text: progress, cls: 'pressroom-panel-progress' });
		}
		const refresh = this.toolbarEl.createEl('button', { cls: 'clickable-icon pressroom-panel-refresh', attr: { 'aria-label': t('panel.refresh') } });
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => void this.reload(site));
	}

	private async batch(site: SiteConfig, kind: BatchKind, targets: string[]) {
		await this.actions.runBatch(site, kind, targets);
		await this.reload(site);
	}

	private renderFolder(el: HTMLElement, folder: TreeFolder, site: SiteConfig, state: SiteState) {
		for (const sub of folder.folders) {
			const details = el.createEl('details', { cls: 'pressroom-panel-folder' });
			details.open = true;
			details.createEl('summary', { text: sub.name });
			this.renderFolder(details.createDiv({ cls: 'pressroom-panel-children' }), sub, site, state);
		}
		for (const record of folder.notes) this.renderNote(el, record, site, state);
	}

	private renderNote(el: HTMLElement, record: NoteRecord, site: SiteConfig, state: SiteState) {
		const row = el.createDiv({ cls: 'pressroom-panel-row' });
		const names = row.createDiv({ cls: 'pressroom-panel-names' });
		names.createSpan({ text: stem(record.sitePath), cls: 'pressroom-panel-name' });
		names.createSpan({ text: record.vaultPath, cls: 'pressroom-panel-vault' });
		const statusEl = row.createSpan({ cls: 'pressroom-panel-status' });
		this.statusEls.set(record.vaultPath, statusEl);
		this.paintStatus(statusEl, state.statuses.get(record.vaultPath) ?? { kind: 'loading' });
		const more = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('panel.actions') } });
		setIcon(more, 'more-horizontal');
		more.addEventListener('click', (evt) => this.itemMenu(record, site, state).showAtMouseEvent(evt));
	}

	private paintStatus(el: HTMLElement, status: PanelStatus) {
		el.removeClass('mod-synced', 'mod-modified', 'mod-moved', 'mod-deleted', 'mod-error');
		switch (status.kind) {
			case 'loading':
				el.setText(t('status.loading'));
				return;
			case 'deleted':
				el.setText(t('status.deleted'));
				el.addClass('mod-deleted');
				return;
			case 'error':
				el.setText(t('status.error'));
				el.setAttr('title', status.message);
				el.addClass('mod-error');
				return;
			default: {
				const parts: string[] = [];
				if (status.kind === 'modified') parts.push(t('status.modified'));
				if (status.moved) parts.push(t('status.moved'));
				if (parts.length === 0) parts.push(t('status.synced'));
				el.setText(parts.join(' '));
				el.addClass(status.kind === 'modified' ? 'mod-modified' : status.moved ? 'mod-moved' : 'mod-synced');
			}
		}
	}

	/** 单项操作（需求 §6）：源笔记已删除的只能撤稿、复制链接、打开网页；站内改名 / 移动只在手动站点 */
	private itemMenu(record: NoteRecord, site: SiteConfig, state: SiteState): Menu {
		const menu = new Menu();
		const file = this.app.vault.getAbstractFileByPath(record.vaultPath);
		const exists = file instanceof TFile;
		const url = urlOf(site.siteUrl, record.sitePath);
		const after = () => void this.reload(site);
		if (exists) {
			menu.addItem((i) =>
				i.setTitle(t('panel.update')).setIcon('upload').onClick(() => void this.actions.publishOnSite(file, site).then(after)),
			);
			if (state.snap?.manifest.mode === 'manual') {
				menu.addItem((i) =>
					i.setTitle(t('panel.move')).setIcon('folder-input').onClick(() => void this.actions.moveOnSite(file, site).then(after)),
				);
			}
		}
		menu.addItem((i) =>
			i.setTitle(t('panel.unpublish')).setIcon('trash-2').onClick(() => void this.actions.unpublishOnSite(record.vaultPath, site).then(after)),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle(t('panel.copyLink')).setIcon('link').onClick(() => {
				void navigator.clipboard.writeText(url).then(() => new Notice(t('notice.linkCopied', { url })));
			}),
		);
		menu.addItem((i) => i.setTitle(t('panel.openPage')).setIcon('globe').onClick(() => window.open(url)));
		if (exists) {
			menu.addItem((i) =>
				i.setTitle(t('panel.openInVault')).setIcon('file-text').onClick(() => {
					this.close();
					void this.app.workspace.getLeaf(false).openFile(file);
				}),
			);
		}
		return menu;
	}
}
