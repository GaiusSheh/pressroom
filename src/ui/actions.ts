// 右键菜单 / 命令面板背后的四个操作：发布、撤稿、获取链接、打开网页（需求 §4、§5.3）

import { Notice, type TFile, parseYaml, stringifyYaml } from 'obsidian';
import type PressroomPlugin from '../main';
import { GitHubBackend } from '../core/backend/github';
import { isExcluded } from '../core/note';
import {
	type NoteStatus,
	type PublishContext,
	type SiteSnapshot,
	loadSnapshot,
	noteStatus,
	publishNote,
	readAttachments,
	unpublishNote,
} from '../core/publish';
import type { SiteConfig } from '../core/types';
import { t } from '../i18n';
import { isSiteComplete } from '../settings/settings';
import { obsidianHttp } from '../platform/http';
import { obsidianVault, parseNote } from '../platform/vault';
import { confirm } from './confirm-modal';
import { describeError } from './errors';
import { chooseLocation } from './location-modal';
import { type SiteItem, pickSite } from './site-picker';

/** 站点快照缓存：右键菜单显示状态时复用，减少请求；发布动作本身总是基于最新 head 重新计算 */
const SNAPSHOT_TTL_MS = 30_000;

export class PressroomActions {
	private readonly cache = new Map<string, { at: number; snap: SiteSnapshot }>();

	constructor(private readonly plugin: PressroomPlugin) {}

	private context(site: SiteConfig): PublishContext {
		const token = this.plugin.getToken();
		if (!token) throw new Error(t('conn.noToken'));
		const s = this.plugin.settings;
		return {
			backend: new GitHubBackend({ repo: site.repo, branch: site.branch, token, http: obsidianHttp }),
			vault: obsidianVault(this.plugin.app),
			site,
			whitelist: s.propertyWhitelist,
			excludedFolders: s.excludedFolders,
			parseYaml: (text) => parseYaml(text) as unknown,
			stringifyYaml: (data) => stringifyYaml(data),
		};
	}

	private async snapshot(site: SiteConfig, fresh = false): Promise<SiteSnapshot> {
		const hit = this.cache.get(site.id);
		if (!fresh && hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.snap;
		const snap = await loadSnapshot(this.context(site));
		this.cache.set(site.id, { at: Date.now(), snap });
		return snap;
	}

	private invalidate(site: SiteConfig) {
		this.cache.delete(site.id);
	}

	/** 可用站点（必填项齐全）；没有时提示并返回空 */
	private sites(): SiteConfig[] {
		const sites = this.plugin.settings.sites.filter(isSiteComplete);
		if (sites.length === 0) new Notice(t('notice.noSites'));
		return sites;
	}

	canHandle(file: TFile): boolean {
		return file.extension === 'md' && !isExcluded(file.path, this.plugin.settings.excludedFolders);
	}

	/** 读取各站快照并计算本篇状态 */
	private async statuses(file: TFile, sites: SiteConfig[]): Promise<Map<string, NoteStatus>> {
		const loading = new Notice(t('notice.loading'), 0);
		try {
			const note = await parseNote(this.plugin.app, file);
			const result = new Map<string, NoteStatus>();
			await Promise.all(
				sites.map(async (site) => {
					const ctx = this.context(site);
					const snap = await this.snapshot(site);
					result.set(site.id, await noteStatus(ctx, note, snap, await readAttachments(ctx, note)));
				}),
			);
			return result;
		} finally {
			loading.hide();
		}
	}

	private statusLabel(status: NoteStatus | undefined): string {
		if (!status || status.kind === 'unpublished') return t('status.unpublished');
		return status.kind === 'synced' ? t('status.synced') : t('status.modified');
	}

	/** 只有一个站点时跳过选择；requirePublished 时未发布的站点灰显 */
	private async choose(
		sites: SiteConfig[],
		statuses: Map<string, NoteStatus>,
		placeholder: string,
		requirePublished: boolean,
	): Promise<SiteConfig | undefined> {
		const items: SiteItem[] = sites.map((site) => {
			const status = statuses.get(site.id);
			return {
				site,
				note: this.statusLabel(status),
				disabled: requirePublished && (!status || status.kind === 'unpublished'),
			};
		});
		if (items.length === 1) {
			const only = items[0]!;
			if (only.disabled) {
				new Notice(t('notice.notPublished', { site: only.site.name }));
				return undefined;
			}
			return only.site;
		}
		return pickSite(this.plugin.app, items, placeholder);
	}

	private async guard(site: () => SiteConfig | undefined, run: () => Promise<void>) {
		try {
			await run();
		} catch (e) {
			console.error('[Pressroom]', e);
			new Notice(describeError(e, site()?.repo ?? ''), 10_000);
		}
	}

	async publish(file: TFile): Promise<void> {
		if (!this.canHandle(file)) {
			new Notice(t('notice.excluded'));
			return;
		}
		const sites = this.sites();
		if (sites.length === 0) return;
		let site: SiteConfig | undefined;
		await this.guard(() => site, async () => {
			const statuses = await this.statuses(file, sites);
			site = await this.choose(sites, statuses, t('picker.publish'), false);
			if (!site) return;
			const ctx = this.context(site);
			let sitePath: string | undefined;
			if (statuses.get(site.id)?.kind === 'unpublished') {
				// 首次发布：用最新快照做冲突检测
				sitePath = await chooseLocation(this.plugin.app, site, await this.snapshot(site, true), file.path);
				if (!sitePath) return;
			}
			const working = new Notice(t('notice.working', { site: site.name }), 0);
			try {
				const chosen = site;
				const out = await publishNote(ctx, await parseNote(this.plugin.app, file), {
					sitePath,
					message: (kind, p) => t(kind === 'published' ? 'commit.published' : 'commit.updated', { path: p }),
				});
				this.invalidate(chosen);
				const key = out.kind === 'published' ? 'notice.published' : out.kind === 'updated' ? 'notice.updated' : 'notice.upToDate';
				this.noticeWithLink(t(key, { site: chosen.name }), out.url);
			} finally {
				working.hide();
			}
		});
	}

	async unpublish(file: TFile): Promise<void> {
		const sites = this.sites();
		if (sites.length === 0) return;
		let site: SiteConfig | undefined;
		await this.guard(() => site, async () => {
			const statuses = await this.statuses(file, sites);
			site = await this.choose(sites, statuses, t('picker.unpublish'), true);
			if (!site) return;
			const status = statuses.get(site.id);
			const url = status && status.kind !== 'unpublished' ? status.url : '';
			const ok = await confirm(this.plugin.app, {
				title: t('unpublish.title', { site: site.name }),
				body: t('unpublish.body', { url }),
				confirmText: t('unpublish.confirm'),
				cancelText: t('common.cancel'),
				destructive: true,
			});
			if (!ok) return;
			const chosen = site;
			const out = await unpublishNote(this.context(chosen), file.path, (p) => t('commit.unpublished', { path: p }));
			this.invalidate(chosen);
			new Notice(t(out.kind === 'unpublished' ? 'notice.unpublished' : 'notice.notPublished', { site: chosen.name }));
		});
	}

	async copyLink(file: TFile): Promise<void> {
		await this.withPublishedUrl(file, t('picker.copyLink'), async (url) => {
			await navigator.clipboard.writeText(url);
			new Notice(t('notice.linkCopied', { url }));
		});
	}

	async openPage(file: TFile): Promise<void> {
		await this.withPublishedUrl(file, t('picker.openPage'), (url) => {
			window.open(url);
			return Promise.resolve();
		});
	}

	private async withPublishedUrl(file: TFile, placeholder: string, use: (url: string) => Promise<void>) {
		const sites = this.sites();
		if (sites.length === 0) return;
		let site: SiteConfig | undefined;
		await this.guard(() => site, async () => {
			const statuses = await this.statuses(file, sites);
			site = await this.choose(sites, statuses, placeholder, true);
			if (!site) return;
			const status = statuses.get(site.id);
			if (status && status.kind !== 'unpublished') await use(status.url);
		});
	}

	private noticeWithLink(message: string, url: string) {
		const frag = createFragment((f) => {
			f.createDiv({ text: message });
			const button = f.createEl('button', { text: t('notice.copyLink'), cls: 'pressroom-notice-button' });
			button.addEventListener('click', () => void navigator.clipboard.writeText(url).then(() => new Notice(t('notice.linkCopied', { url }))));
		});
		new Notice(frag, 10_000);
	}
}
