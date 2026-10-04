// 右键菜单 / 命令面板背后的四个操作：发布、撤稿、获取链接、打开网页（需求 §4、§5.3）
// Phase 3：跨站链接（读取其他站点快照）、反向链接提醒（发布后「一并更新」、撤稿时一并更新）、手动站点的未发布链接说明

import { Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type PressroomPlugin from '../main';
import { GitHubBackend } from '../core/backend/github';
import { publishedBacklinks, unpublishedLinkTargets } from '../core/backlinks';
import { scanCompanions } from '../core/companions';
import { findConflicts } from '../core/generator/quartz';
import { isExcluded, stem } from '../core/note';
import {
	type NoteStatus,
	type OtherSite,
	type PublishContext,
	type PublishItem,
	type SiteSnapshot,
	commitRenames,
	crossSiteLookup,
	hasManifest,
	loadSnapshot,
	movedRecords,
	noteStatus,
	prepareNote,
	publishBatch,
	setMode,
	slugOwners,
} from '../core/publish';
import type { Rename } from '../core/renames';
import type { DirMode, SiteConfig } from '../core/types';
import { t } from '../i18n';
import { isSiteComplete } from '../settings/settings';
import { findRepoBranchClash } from '../settings/validate';
import { obsidianHttp } from '../platform/http';
import { backlinkSources, obsidianVault, parseNote } from '../platform/vault';
import { commitMessage } from './commit-message';
import { confirm, confirmWithOption } from './confirm-modal';
import { describeError } from './errors';
import { chooseLocation } from './location-modal';
import { chooseAllLocations } from './publish-modal';
import { RenameQueue } from './renames';
import { chooseCompanions } from './companions-modal';
import { type SiteItem, pickSite } from './site-picker';

/** 站点快照缓存：右键菜单显示状态时复用，减少请求；发布动作本身总是基于最新 head 重新计算 */
const SNAPSHOT_TTL_MS = 30_000;

export class PressroomActions {
	private readonly cache = new Map<string, { at: number; snap: SiteSnapshot }>();
	/** vault 改名的待写队列（需求 §9） */
	readonly renames: RenameQueue;

	constructor(private readonly plugin: PressroomPlugin) {
		this.renames = new RenameQueue(plugin, (site, renames) => this.writeRenames(site, renames), () => this.cache.clear());
	}

	private async writeRenames(site: SiteConfig, renames: Rename[]) {
		const out = await commitRenames({ ...this.baseContext(site), renames }, (n) => t('commit.renamed', { n }));
		if (out.commitSha) this.invalidate(site);
	}

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
			// 尚未写回的改名：状态与发布按新路径计算，提交时一并写入 manifest
			renames: this.renames.pending(site.id),
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
		this.adoptRepoMode(site, snap);
		return snap;
	}

	/** 目录模式以仓库 manifest 为准（换设备一致，需求 §9）：与本地设置不同时更新本地并提示 */
	private adoptRepoMode(site: SiteConfig, snap: SiteSnapshot) {
		if (!hasManifest(snap) || snap.manifest.mode === site.mode) return;
		site.mode = snap.manifest.mode;
		void this.plugin.saveSettings();
		new Notice(t('notice.modeFromRepo', { site: site.name, mode: t(`settings.site.mode.${site.mode}` as const) }), 10_000);
	}

	/**
	 * 设置页切换目录模式（需求 §5.2）：写回仓库 manifest（一次提交，只改 mode，不挪动内容），成功后才改本地设置。
	 * 手动 → 跟随且有 N 篇位置与 vault 不同时先确认。站点信息不全时只改本地（首次发布时写入 manifest）。
	 * 仓库中还没有 manifest 时同样只改本地。调用方之后以 site.mode 刷新界面（读取仓库时可能被仓库中的模式覆盖）
	 */
	async changeMode(site: SiteConfig, mode: DirMode): Promise<void> {
		if (site.mode === mode) return;
		if (!isSiteComplete(site)) {
			site.mode = mode;
			await this.plugin.saveSettings();
			return;
		}
		try {
			const snap = await this.snapshot(site, true);
			if (site.mode === mode) return; // 仓库中已是该模式（adoptRepoMode 已同步）
			if (!hasManifest(snap)) {
				site.mode = mode;
				await this.plugin.saveSettings();
				return;
			}
			if (mode === 'follow') {
				const moved = movedRecords(snap.manifest);
				if (moved.length > 0) {
					const n = moved.length;
					const ok = await confirm(this.plugin.app, {
						title: t('mode.toFollow.title', { site: site.name }),
						body: t('mode.toFollow.body', { n }),
						confirmText: t('mode.confirm'),
						cancelText: t('common.cancel'),
						details: { summary: t('mode.toFollow.list', { n }), items: moved.map((r) => t('commit.movePair', { from: r.sitePath, to: r.vaultPath })) },
					});
					if (!ok) return;
				}
			}
			const working = new Notice(t('mode.saving', { site: site.name }), 0);
			try {
				await setMode(this.baseContext(site), mode, t(`commit.mode.${mode}` as const));
			} finally {
				working.hide();
			}
			this.invalidate(site);
			site.mode = mode;
			await this.plugin.saveSettings();
			new Notice(t('mode.saved', { site: site.name }));
		} catch (e) {
			console.error('[Pressroom]', e);
			new Notice(t('mode.failed', { reason: describeError(e, site.repo) }), 10_000);
		}
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
		// 每次操作时顺带补写之前未写回的改名（不阻塞本次操作：本次操作已按新路径计算）
		void this.renames.flush();
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
		// 已移动可与有修改叠加（需求 §6.1）
		if (status.moved) return status.kind === 'synced' ? t('status.moved') : `${t('status.modified')} ${t('status.moved')}`;
		return status.kind === 'synced' ? t('status.synced') : t('status.modified');
	}

	/**
	 * 只有一个站点时跳过选择；requirePublished 时未发布的站点灰显。
	 * allowAll：多个站点时在末尾提供「全部站点」（需求 §4；requirePublished 时没有已发布站点则灰显）
	 */
	private async choose(
		sites: SiteConfig[],
		statuses: Map<string, NoteStatus>,
		placeholder: string,
		requirePublished: boolean,
		allowAll = false,
	): Promise<SiteConfig | 'all' | undefined> {
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
		const all = allowAll ? { label: t('picker.all'), disabled: requirePublished && items.every((i) => i.disabled) } : undefined;
		return pickSite(this.plugin.app, items, placeholder, all);
	}

	/** 本站已发布的（状态不是未发布）；保持设置中的站点顺序 */
	private publishedOn(sites: SiteConfig[], statuses: Map<string, NoteStatus>): SiteConfig[] {
		return sites.filter((s) => {
			const st = statuses.get(s.id);
			return st !== undefined && st.kind !== 'unpublished';
		});
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
			const picked = await this.choose(sites, statuses, t('picker.publish'), false, true);
			if (picked === 'all') return this.publishAll(file, sites, statuses);
			site = picked;
			if (!site) return;
			const chosen = site;
			const ctx = await this.context(chosen);
			let sitePath: string | undefined;
			let companions: string[] = [];
			const firstPublish = statuses.get(chosen.id)?.kind === 'unpublished';
			// 最新快照：冲突检测、连带清单、别名跳转提示都基于它（读取时已按仓库同步目录模式）
			const snap = await this.snapshot(chosen, true);
			if (chosen.mode === 'follow') {
				// 跟随 vault 站点：位置即 vault 位置，不弹位置窗口；指向本站未发布笔记的链接按双链处理（需求 §7）
				const picked = await this.pickCompanions(ctx, chosen, snap, file);
				if (!picked) return;
				companions = picked;
			} else if (firstPublish) {
				// 手动站点首次发布：列出本篇中未在本站发布的链接
				const unpublished = await this.unpublishedNames(ctx, snap, file);
				sitePath = await chooseLocation(this.plugin.app, chosen, snap, file.path, unpublished);
				if (!sitePath) return;
			}
			const working = new Notice(t('notice.working', { site: chosen.name }), 0);
			try {
				const items = [await this.prepare(ctx, file, sitePath), ...(await Promise.all(this.files(companions).map((f) => this.prepare(ctx, f))))];
				const out = await publishBatch(ctx, items, { message: commitMessage });
				this.invalidate(chosen);
				const item = out.items[0]!;
				const key =
					out.commitSha === undefined || item.kind === 'upToDate'
						? 'notice.upToDate'
						: item.kind === 'published'
							? 'notice.published'
							: item.kind === 'moved'
								? snap.aliasRedirects
									? 'notice.moved'
									: 'notice.movedNoRedirect'
								: 'notice.updated';
				const extra = companions.length ? ` ${t('notice.companions', { n: companions.length })}` : '';
				const action = firstPublish && out.commitSha ? await this.backlinkAction(chosen, file) : undefined;
				this.notice(t(key, { site: chosen.name }) + extra, item.url, action);
			} finally {
				working.hide();
			}
		});
	}

	/** 手动站点首次发布时说明的：本篇中指向本站未发布笔记的链接（显示名） */
	private async unpublishedNames(ctx: PublishContext, snap: SiteSnapshot, file: TFile): Promise<string[]> {
		const note = await parseNote(this.plugin.app, file);
		const published = new Set(snap.manifest.notes.map((n) => n.vaultPath));
		// 已发布在其他站点、会输出跨站链接的，不算「将显示为纯文本」（与转换时同一个跨站查询）
		const crossSite = crossSiteLookup(ctx);
		return unpublishedLinkTargets(
			note,
			(target, from) => ctx.vault.resolve(target, from),
			(p) => isExcluded(p, ctx.excludedFolders),
			(p) => published.has(p) || crossSite?.(p) !== undefined,
		).map(stem);
	}

	/**
	 * 发布 → 全部站点（需求 §4、§5.3）：已发布的站点直接更新；首次发布的手动站点在一个分块弹窗中填写位置；
	 * 跟随 vault 站点按各自的双链处理询问连带。全部确认后逐站提交（一站一次，无法跨站原子），最后汇总结果
	 */
	private async publishAll(file: TFile, sites: SiteConfig[], statuses: Map<string, NoteStatus>): Promise<void> {
		const first = (s: SiteConfig) => statuses.get(s.id)?.kind === 'unpublished';
		const manual = sites.filter((s) => first(s) && s.mode === 'manual');
		const paths = new Map<string, string>();
		if (manual.length > 0) {
			const inputs = await Promise.all(
				manual.map(async (site) => {
					const snap = await this.snapshot(site, true);
					return { site, snap, vaultPath: file.path, unpublishedLinks: await this.unpublishedNames(await this.context(site), snap, file) };
				}),
			);
			const chosen = await chooseAllLocations(this.plugin.app, {
				manual: inputs,
				follow: sites.filter((s) => first(s) && s.mode === 'follow'),
				updating: this.publishedOn(sites, statuses),
				vaultPath: file.path,
			});
			if (!chosen) return;
			for (const [id, p] of chosen) paths.set(id, p);
		}
		// 跟随 vault 站点的连带清单（各站一个弹窗；任一取消则整体取消，此时尚未提交任何内容）
		const companions = new Map<string, string[]>();
		for (const site of sites.filter((s) => s.mode === 'follow')) {
			const picked = await this.pickCompanions(await this.context(site), site, await this.snapshot(site, true), file);
			if (!picked) return;
			companions.set(site.id, picked);
		}
		await this.runOnSites(sites, t('all.working', { n: sites.length }), async (site) => {
			const ctx = await this.context(site);
			const extra = await Promise.all(this.files(companions.get(site.id) ?? []).map((f) => this.prepare(ctx, f)));
			const out = await publishBatch(ctx, [await this.prepare(ctx, file, paths.get(site.id)), ...extra], { message: commitMessage });
			const kind = out.commitSha === undefined ? 'upToDate' : out.items[0]!.kind;
			const result = t(`all.kind.${kind}` as const);
			const text = extra.length && out.commitSha ? `${result} ${t('notice.companions', { n: extra.length })}` : result;
			return { text, committed: out.commitSha !== undefined };
		});
	}

	/**
	 * 逐站执行并汇总（某站失败不影响其他站点）；结果提示列出每个站点的结果或失败原因。
	 * 只有确实提交了内容时才提示「约 1 分钟后网站更新」
	 */
	private async runOnSites(
		sites: SiteConfig[],
		progress: string,
		run: (site: SiteConfig) => Promise<{ text: string; committed: boolean }>,
	): Promise<void> {
		const working = new Notice(progress, 0);
		const lines: { text: string; failed: boolean }[] = [];
		let committed = false;
		try {
			for (const site of sites) {
				try {
					const r = await run(site);
					committed ||= r.committed;
					lines.push({ text: t('all.result', { site: site.name, result: r.text }), failed: false });
				} catch (e) {
					console.error('[Pressroom]', site.name, e);
					const result = t('all.failed', { reason: describeError(e, site.repo) });
					lines.push({ text: t('all.result', { site: site.name, result }), failed: true });
				} finally {
					this.invalidate(site);
				}
			}
		} finally {
			working.hide();
		}
		const failed = lines.filter((l) => l.failed).length;
		const frag = createFragment((f) => {
			f.createDiv({ text: t(committed ? 'all.summary' : 'all.summaryNoChange', { ok: sites.length - failed, n: sites.length }) });
			for (const l of lines) f.createDiv({ text: l.text, cls: l.failed ? 'pressroom-notice-extra mod-failed' : 'pressroom-notice-extra' });
		});
		new Notice(frag, failed ? 30_000 : 15_000);
	}

	/**
	 * 跟随 vault 站点的连带发布（需求 §7 2026-10-04 修订）：本篇中指向本站未发布笔记的链接 → 三选一 + 清单。
	 * 首次发布时默认取设置；更新时只看上次发布后新出现的链接，设置为纯文本时不询问（绝不静默多发）。
	 * 没有这类链接时直接返回空；用户取消返回 undefined
	 */
	private async pickCompanions(ctx: PublishContext, site: SiteConfig, snap: SiteSnapshot, file: TFile): Promise<string[] | undefined> {
		const record = snap.manifest.notes.find((n) => n.vaultPath === file.path);
		const policy = this.plugin.settings.linkPolicy;
		if (record && policy === 'plain') return [];
		const app = this.plugin.app;
		const published = new Set(snap.manifest.notes.map((n) => n.vaultPath));
		const deps = {
			load: async (p: string) => {
				const f = app.vault.getAbstractFileByPath(p);
				return f instanceof TFile ? parseNote(app, f) : undefined;
			},
			resolve: (target: string, from: string) => ctx.vault.resolve(target, from),
			excluded: (p: string) => isExcluded(p, ctx.excludedFolders),
			publishedOnSite: (p: string) => published.has(p),
			known: record ? new Set(record.plainLinks ?? []) : undefined,
		};
		const note = await parseNote(app, file);
		const one = await scanCompanions(note, deps, false);
		if (one.paths.length === 0) return [];
		const owners = slugOwners(snap);
		return chooseCompanions(app, {
			site,
			update: record !== undefined,
			defaultPolicy: policy,
			one,
			scanAll: () => scanCompanions(note, deps, true),
			conflict: (p) => {
				const found = findConflicts(p, owners);
				return found.length
					? t('companions.conflict', { other: found.map((c) => (c.owner.kind === 'file' ? c.owner.path : c.owner.alias)).join(t('common.listSep')) })
					: undefined;
			},
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
			const picked = await this.choose(sites, statuses, t('picker.unpublish'), true, true);
			if (picked === 'all') return this.unpublishAll(file, this.publishedOn(sites, statuses));
			site = picked;
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

	/**
	 * 撤稿 → 全部站点：只对已发布的站点执行，一个确认框；反向链接的「一并更新」按站点分别处理
	 * （每站只更新本站已发布、链接到本篇的笔记）
	 */
	private async unpublishAll(file: TFile, sites: SiteConfig[]): Promise<void> {
		const sources = backlinkSources(this.plugin.app, file.path);
		const backlinks = new Map<string, TFile[]>();
		for (const site of sites) {
			backlinks.set(site.id, this.files(publishedBacklinks(file.path, sources, (await this.snapshot(site, true)).manifest)));
		}
		const total = [...backlinks.values()].reduce((n, l) => n + l.length, 0);
		const names = [...new Set([...backlinks.values()].flat().map((f) => f.basename))].join(t('common.listSep'));
		const answer = await confirmWithOption(this.plugin.app, {
			title: t('all.unpublish.title'),
			body: t('all.unpublish.body', { names: sites.map((s) => s.name).join(t('common.listSep')) }),
			confirmText: t('unpublish.confirm'),
			cancelText: t('common.cancel'),
			destructive: true,
			option: total ? { label: t('unpublish.alsoUpdate', { n: total }), desc: t('unpublish.alsoUpdate.desc', { names }), checked: true } : undefined,
		});
		if (!answer.ok) return;
		await this.runOnSites(sites, t('all.unpublishing', { n: sites.length }), async (site) => {
			const ctx = await this.context(site);
			const items = answer.checked ? await Promise.all((backlinks.get(site.id) ?? []).map((f) => this.prepare(ctx, f))) : [];
			const out = await publishBatch(ctx, items, { unpublish: [file.path], message: commitMessage });
			const removed = out.items.some((i) => i.kind === 'unpublished');
			return { text: t(removed ? 'all.kind.unpublished' : 'all.kind.notPublished'), committed: out.commitSha !== undefined };
		});
	}

	async copyLink(file: TFile): Promise<void> {
		await this.withPublishedUrl(
			file,
			t('picker.copyLink'),
			async (url) => {
				await navigator.clipboard.writeText(url);
				new Notice(t('notice.linkCopied', { url }));
			},
			// 全部站点：多行「站点名：网址」，只含已发布的站点（需求 §4）
			async (published) => {
				const text = published.map(({ site, url }) => t('all.linkLine', { site: site.name, url })).join('\n');
				await navigator.clipboard.writeText(text);
				new Notice(t('all.copied', { n: published.length }));
			},
		);
	}

	async openPage(file: TFile): Promise<void> {
		await this.withPublishedUrl(file, t('picker.openPage'), (url) => {
			window.open(url);
			return Promise.resolve();
		});
	}

	/** useAll：提供「全部站点」（打开网页不提供） */
	private async withPublishedUrl(
		file: TFile,
		placeholder: string,
		use: (url: string) => Promise<void>,
		useAll?: (published: { site: SiteConfig; url: string }[]) => Promise<void>,
	) {
		const sites = this.sites();
		if (sites.length === 0) return;
		let site: SiteConfig | undefined;
		await this.guard(() => site, async () => {
			const statuses = await this.statuses(file, sites);
			const picked = await this.choose(sites, statuses, placeholder, true, useAll !== undefined);
			if (picked === 'all') {
				const published = this.publishedOn(sites, statuses).map((s) => {
					const st = statuses.get(s.id);
					return { site: s, url: st && st.kind !== 'unpublished' ? st.url : '' };
				});
				return useAll?.(published);
			}
			site = picked;
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
