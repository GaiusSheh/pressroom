// 右键菜单 / 命令面板背后的四个操作：发布、撤稿、获取链接、打开网页（需求 §4、§5.3）
// Phase 3：跨站链接（读取其他站点快照）、反向链接提醒（发布后「一并更新」、撤稿时一并更新）、手动站点的未发布链接说明

import { Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type PressroomPlugin from '../main';
import { GitHubBackend } from '../core/backend/github';
import { publishedBacklinks, unpublishedLinkTargets } from '../core/backlinks';
import { isExcluded, stem } from '../core/note';
import {
	type NoteStatus,
	type OtherSite,
	type PublishContext,
	type PublishItem,
	type SiteSnapshot,
	crossSiteLookup,
	loadSnapshot,
	noteStatus,
	prepareNote,
	publishBatch,
} from '../core/publish';
import type { SiteConfig } from '../core/types';
import { t } from '../i18n';
import { isSiteComplete } from '../settings/settings';
import { findRepoBranchClash } from '../settings/validate';
import { obsidianHttp } from '../platform/http';
import { backlinkSources, obsidianVault, parseNote } from '../platform/vault';
import { commitMessage } from './commit-message';
import { confirmWithOption } from './confirm-modal';
import { describeError } from './errors';
import { chooseLocation } from './location-modal';
import { type SiteItem, pickSite } from './site-picker';

/** 站点快照缓存：右键菜单显示状态时复用，减少请求；发布动作本身总是基于最新 head 重新计算 */
const SNAPSHOT_TTL_MS = 30_000;

export class PressroomActions {
	private readonly cache = new Map<string, { at: number; snap: SiteSnapshot }>();

	constructor(private readonly plugin: PressroomPlugin) {}

	private baseContext(site: SiteConfig): PublishContext {
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

	/**
	 * 带其他站点 manifest 的上下文（跨站链接，需求 §8）。本站隔离时不读取其他站点；
	 * 其他隔离站点由 core 过滤。某个站点读取失败不阻止发布（那些链接显示为纯文本）
	 */
	private async context(site: SiteConfig): Promise<PublishContext> {
		const ctx = this.baseContext(site);
		if (site.isolated) return ctx;
		const others = this.usableSites()[0].filter((s) => s.id !== site.id && !s.isolated);
		const loaded = await Promise.all(
			others.map(async (o): Promise<OtherSite | undefined> => {
				try {
					return { site: o, manifest: (await this.snapshot(o)).manifest };
				} catch (e) {
					console.warn(`[Pressroom] 读取站点「${o.name}」失败，跨站链接将显示为纯文本`, e);
					return undefined;
				}
			}),
		);
		ctx.otherSites = loaded.filter((x): x is OtherSite => x !== undefined);
		return ctx;
	}

	private async snapshot(site: SiteConfig, fresh = false): Promise<SiteSnapshot> {
		const hit = this.cache.get(site.id);
		if (!fresh && hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.snap;
		const snap = await loadSnapshot(this.baseContext(site));
		this.cache.set(site.id, { at: Date.now(), snap });
		return snap;
	}

	private invalidate(site: SiteConfig) {
		this.cache.delete(site.id);
	}

	/**
	 * 可用站点：必填项齐全，且「仓库 + 分支」不与其他站点重复（同一分支的站点会共用 manifest，
	 * 设置页已拦截，这里防住旧设置）。返回 [可用站点, 因重复被排除的站点]
	 */
	private usableSites(): [SiteConfig[], SiteConfig[]] {
		const complete = this.plugin.settings.sites.filter(isSiteComplete);
		const clashing = complete.filter((s) => findRepoBranchClash(s, complete) !== undefined);
		return [complete.filter((s) => !clashing.includes(s)), clashing];
	}

	/** 可用站点；有重复配置的站点时提示；没有可用站点时提示并返回空 */
	private sites(): SiteConfig[] {
		const [sites, clashing] = this.usableSites();
		if (clashing.length) {
			new Notice(t('notice.repoClash', { names: clashing.map((s) => s.name).join(t('common.listSep')) }), 10_000);
		}
		if (sites.length === 0 && clashing.length === 0) new Notice(t('notice.noSites'));
		return sites;
	}

	canHandle(file: TFile): boolean {
		return file.extension === 'md' && !isExcluded(file.path, this.plugin.settings.excludedFolders);
	}

	private async prepare(ctx: PublishContext, file: TFile, sitePath?: string): Promise<PublishItem> {
		return { ...(await prepareNote(ctx, await parseNote(this.plugin.app, file))), sitePath };
	}

	/** 读取各站快照并计算本篇状态 */
	private async statuses(file: TFile, sites: SiteConfig[]): Promise<Map<string, NoteStatus>> {
		const loading = new Notice(t('notice.loading'), 0);
		try {
			// 笔记解析、嵌入与附件与站点无关：只准备一次，各站共用
			const prepared = await this.prepare(this.baseContext(sites[0]!), file);
			// 先并行读好所有可用站点的快照（含跨站查询要用的其他站点），后续都命中缓存
			await Promise.all(this.usableSites()[0].map((s) => this.snapshot(s).catch(() => undefined)));
			const result = new Map<string, NoteStatus>();
			await Promise.all(
				sites.map(async (site) => {
					const ctx = await this.context(site);
					result.set(site.id, await noteStatus(ctx, prepared, await this.snapshot(site)));
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

	/** vault 路径 → TFile（不存在的跳过） */
	private files(paths: string[]): TFile[] {
		return paths.map((p) => this.plugin.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
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
			const chosen = site;
			const ctx = await this.context(chosen);
			let sitePath: string | undefined;
			const firstPublish = statuses.get(chosen.id)?.kind === 'unpublished';
			if (firstPublish) {
				// 首次发布：用最新快照做冲突检测；列出本篇中未在本站发布的链接
				const snap = await this.snapshot(chosen, true);
				const note = await parseNote(this.plugin.app, file);
				const published = new Set(snap.manifest.notes.map((n) => n.vaultPath));
				// 已发布在其他站点、会输出跨站链接的，不算「将显示为纯文本」（与转换时同一个跨站查询）
				const crossSite = crossSiteLookup(ctx);
				const unpublished = unpublishedLinkTargets(
					note,
					(target, from) => ctx.vault.resolve(target, from),
					(p) => isExcluded(p, ctx.excludedFolders),
					(p) => published.has(p) || crossSite?.(p) !== undefined,
				).map(stem);
				sitePath = await chooseLocation(this.plugin.app, chosen, snap, file.path, unpublished);
				if (!sitePath) return;
			}
			const working = new Notice(t('notice.working', { site: chosen.name }), 0);
			try {
				const out = await publishBatch(ctx, [await this.prepare(ctx, file, sitePath)], { message: commitMessage });
				this.invalidate(chosen);
				const item = out.items[0]!;
				const key =
					out.commitSha === undefined || item.kind === 'upToDate'
						? 'notice.upToDate'
						: item.kind === 'published'
							? 'notice.published'
							: 'notice.updated';
				const action = firstPublish && out.commitSha ? await this.backlinkAction(chosen, file) : undefined;
				this.notice(t(key, { site: chosen.name }), item.url, action);
			} finally {
				working.hide();
			}
		});
	}

	/**
	 * 反向链接提醒（发布后）：本站已发布、链接到本篇、且现在判为「有修改」的笔记 → 提供「一并更新」按钮。
	 * 只看一层，不自动更新（会带上这些笔记中尚未发布的其他改动，须用户确认）
	 */
	private async backlinkAction(site: SiteConfig, file: TFile): Promise<{ text: string; label: string; run: () => void } | undefined> {
		const snap = await this.snapshot(site, true);
		const candidates = this.files(publishedBacklinks(file.path, backlinkSources(this.plugin.app, file.path), snap.manifest));
		if (candidates.length === 0) return undefined;
		const ctx = await this.context(site);
		const modified: TFile[] = [];
		for (const f of candidates) {
			if ((await noteStatus(ctx, await this.prepare(ctx, f), snap)).kind === 'modified') modified.push(f);
		}
		if (modified.length === 0) return undefined;
		const n = modified.length;
		return {
			text: t('notice.backlinks', { n }),
			label: t('notice.backlinks.button', { n }),
			run: () =>
				void this.guard(() => site, async () => {
					// 操作需要几秒：期间显示进度，完成提示停留更久（GUI 测试中完成提示曾因太短被错过）
					const working = new Notice(t('notice.updating', { site: site.name }), 0);
					try {
						const c = await this.context(site);
						const items = await Promise.all(modified.map((f) => this.prepare(c, f)));
						await publishBatch(c, items, { message: commitMessage });
						this.invalidate(site);
					} finally {
						working.hide();
					}
					new Notice(t('notice.backlinks.done', { n, site: site.name }), 10_000);
				}),
		};
	}

	async unpublish(file: TFile): Promise<void> {
		const sites = this.sites();
		if (sites.length === 0) return;
		let site: SiteConfig | undefined;
		await this.guard(() => site, async () => {
			const statuses = await this.statuses(file, sites);
			site = await this.choose(sites, statuses, t('picker.unpublish'), true);
			if (!site) return;
			const chosen = site;
			const status = statuses.get(chosen.id);
			const url = status && status.kind !== 'unpublished' ? status.url : '';
			// 反向链接：撤稿后它们的链接会失效，默认勾选一并更新（链接改为纯文本）
			const snap = await this.snapshot(chosen, true);
			const backlinks = this.files(publishedBacklinks(file.path, backlinkSources(this.plugin.app, file.path), snap.manifest));
			const names = backlinks.map((f) => f.basename).join(t('common.listSep'));
			const answer = await confirmWithOption(this.plugin.app, {
				title: t('unpublish.title', { site: chosen.name }),
				body: t('unpublish.body', { url }),
				confirmText: t('unpublish.confirm'),
				cancelText: t('common.cancel'),
				destructive: true,
				option: backlinks.length
					? { label: t('unpublish.alsoUpdate', { n: backlinks.length }), desc: t('unpublish.alsoUpdate.desc', { names }), checked: true }
					: undefined,
			});
			if (!answer.ok) return;
			const working = new Notice(t('notice.unpublishing', { site: chosen.name }), 0);
			let removed = false;
			try {
				const ctx = await this.context(chosen);
				const items = answer.checked ? await Promise.all(backlinks.map((f) => this.prepare(ctx, f))) : [];
				const out = await publishBatch(ctx, items, { unpublish: [file.path], message: commitMessage });
				this.invalidate(chosen);
				removed = out.items.some((i) => i.kind === 'unpublished');
			} finally {
				working.hide();
			}
			new Notice(t(removed ? 'notice.unpublished' : 'notice.notPublished', { site: chosen.name }), 10_000);
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

	/** 结果提示：复制链接按钮；可选的附加说明与操作按钮（如反向链接的「一并更新」） */
	private notice(message: string, url: string, action?: { text: string; label: string; run: () => void }) {
		const frag = createFragment((f) => {
			f.createDiv({ text: message });
			if (action) f.createDiv({ text: action.text, cls: 'pressroom-notice-extra' });
			const row = f.createDiv({ cls: 'pressroom-notice-buttons' });
			const copy = row.createEl('button', { text: t('notice.copyLink') });
			copy.addEventListener('click', () => void navigator.clipboard.writeText(url).then(() => new Notice(t('notice.linkCopied', { url }))));
			if (action) {
				const btn = row.createEl('button', { text: action.label, cls: 'mod-cta' });
				btn.addEventListener('click', () => action.run());
			}
		});
		// 带操作按钮时停留更久，给用户时间决定
		new Notice(frag, action ? 30_000 : 10_000);
	}
}
