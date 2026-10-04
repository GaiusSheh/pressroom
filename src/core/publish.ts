// 发布 / 更新 / 撤稿与状态判定（需求 v1 §5.3、§6.1、§6.2、§7、§9；Phase 2 详细计划 2-4、Phase 3 详细计划 3-1）
// 所有写操作都在 Backend.commit 的 build 回调中、基于当次 head 重新读取 manifest 与文件树，
// 因此非 fast-forward 重试时能正确合并其他设备的改动。多篇操作合并为一次提交。

import { type Allocation, type AttachmentInput, allocateAttachments } from './attachments';
import type { Backend, Change, Head, TreeEntry } from './backend/types';
import { findConflicts, QUARTZ_CONFIG_PATH, readSiteConfig, slugOf, urlOf } from './generator/quartz';
import type { Conflict, LinkStrategy, SlugOwner, YamlParser } from './generator/types';
import { gitBlobSha, utf8Decode } from './hash';
import {
	MANIFEST_PATH,
	type ManifestV1,
	type NoteRecord,
	emptyManifest,
	manifestChange,
	parseManifest,
} from './manifest/manifest';
import { type ParsedNote, type VaultAccess, isExcluded } from './note';
import { type EmbedMap, loadEmbeds } from './transform/embed';
import { collectAttachments, transformNote } from './transform/transform';
import type { SiteConfig } from './types';

export interface PublishContext {
	backend: Backend;
	vault: VaultAccess;
	site: SiteConfig;
	whitelist: string[];
	excludedFolders: string[];
	parseYaml: YamlParser;
	stringifyYaml: (data: Record<string, unknown>) => string;
	/** 当前时间（ISO 8601），测试中可注入 */
	now?: () => string;
	/** 其他站点的 manifest（跨站链接用，需求 §8）；隔离规则在 crossSiteLookup 中处理 */
	otherSites?: OtherSite[];
}

export interface OtherSite {
	site: SiteConfig;
	manifest: ManifestV1;
}

/**
 * 跨站链接查询（需求 §8 + 2026-10-04 决定）：本站隔离 → 不链接任何其他站点；
 * 其他站点中隔离的不参与（双向不链接）；多个站点都有时按设置中的站点顺序取第一个
 */
export function crossSiteLookup(ctx: PublishContext): ((vaultPath: string) => string | undefined) | undefined {
	if (ctx.site.isolated) return undefined;
	const candidates = (ctx.otherSites ?? []).filter((o) => o.site.id !== ctx.site.id && !o.site.isolated);
	if (candidates.length === 0) return undefined;
	return (vaultPath) => {
		for (const o of candidates) {
			const record = o.manifest.notes.find((n) => n.vaultPath === vaultPath);
			if (record) return urlOf(o.site.siteUrl, record.sitePath);
		}
		return undefined;
	};
}

/** 某一 head 下站点仓库的状态 */
export interface SiteSnapshot {
	head: Head;
	/** 仓库全部文件 */
	allFiles: TreeEntry[];
	/** 内容目录中的文件，路径相对内容目录 */
	contentFiles: TreeEntry[];
	manifest: ManifestV1;
	linkStrategy: LinkStrategy;
	ignorePatterns: string[];
	aliasRedirects: boolean;
}

export class PublishConflictError extends Error {
	constructor(
		readonly sitePath: string,
		readonly conflicts: Conflict[],
	) {
		super(`站内路径 ${sitePath} 与已有内容网址冲突：${conflicts.map((c) => (c.owner.kind === 'file' ? c.owner.path : c.owner.alias)).join('、')}`);
		this.name = 'PublishConflictError';
	}
}

/** 一批中多篇笔记网址冲突：全部列出，整批不提交 */
export class BatchConflictError extends Error {
	constructor(readonly errors: PublishConflictError[]) {
		super(errors.map((e) => e.message).join('；'));
		this.name = 'BatchConflictError';
	}
}

const repoPath = (site: SiteConfig, sitePath: string) => (site.contentDir ? `${site.contentDir}/${sitePath}` : sitePath);

export async function loadSnapshot(ctx: PublishContext, head?: Head): Promise<SiteSnapshot> {
	const { backend, site } = ctx;
	const h = head ?? (await backend.getHead());
	const allFiles = await backend.getTree(h.treeSha);
	const prefix = site.contentDir ? `${site.contentDir}/` : '';
	const contentFiles = allFiles
		.filter((f) => f.path.startsWith(prefix))
		.map((f) => ({ ...f, path: f.path.slice(prefix.length) }));

	// manifest 与配置从同一棵树按 blob 读取，保证与 head 一致
	const read = async (path: string) => {
		const entry = allFiles.find((f) => f.path === path);
		return entry ? utf8Decode(await backend.readBlob(entry.sha)) : undefined;
	};
	const [manifestText, configText] = await Promise.all([read(MANIFEST_PATH), read(QUARTZ_CONFIG_PATH)]);
	const manifest = manifestText === undefined ? emptyManifest(site.mode) : parseManifest(manifestText);
	const config = readSiteConfig(configText, ctx.parseYaml);
	return {
		head: h,
		allFiles,
		contentFiles,
		manifest,
		// 读不到配置时输出完整路径（shortest / absolute 都适用）
		linkStrategy: config.ok ? config.info.linkStrategy : 'absolute',
		ignorePatterns: config.ok ? config.info.ignorePatterns : [],
		aliasRedirects: config.ok ? config.info.aliasRedirects : false,
	};
}

/** 网址冲突检测的比较对象：内容目录全部文件 + manifest 中的 aliases */
export function slugOwners(snap: SiteSnapshot): SlugOwner[] {
	return [
		...snap.contentFiles.map((f): SlugOwner => ({ kind: 'file', path: f.path })),
		...snap.manifest.notes.flatMap((n) => n.aliases.map((alias): SlugOwner => ({ kind: 'alias', alias, ownerPath: n.sitePath }))),
	];
}

export type AttachmentData = AttachmentInput & { bytes: Uint8Array };

/** 读取附件内容并计算 SHA（在 commit 之外做一次，重试时不重复读取）；含嵌入内容中的附件 */
export async function readAttachments(ctx: PublishContext, note: ParsedNote, embeds?: EmbedMap): Promise<AttachmentData[]> {
	const paths = collectAttachments(note, { ...transformRefs(ctx), embeds });
	return Promise.all(
		paths.map(async (vaultPath) => {
			const bytes = await ctx.vault.readBinary(vaultPath);
			return { vaultPath, bytes, sha: await gitBlobSha(bytes) };
		}),
	);
}

function transformRefs(ctx: PublishContext) {
	return {
		resolve: (t: string, from: string) => ctx.vault.resolve(t, from),
		excluded: (p: string) => isExcluded(p, ctx.excludedFolders),
	};
}

/** 发布 / 状态判定前的准备：预加载嵌入内容、读取附件（commit 之外做一次） */
export interface PreparedNote {
	note: ParsedNote;
	embeds: EmbedMap;
	attachments: AttachmentData[];
}

export async function prepareNote(ctx: PublishContext, note: ParsedNote): Promise<PreparedNote> {
	const embeds = await loadEmbeds(note, { vault: ctx.vault, excluded: transformRefs(ctx).excluded });
	return { note, embeds, attachments: await readAttachments(ctx, note, embeds) };
}

/** 一篇笔记在某快照、某个「本站已发布」视图下的发布副本 */
interface Rendered {
	text: string;
	textSha: string;
	/** 本篇引用的附件站内路径（去重） */
	attachmentPaths: string[];
}

async function render(
	ctx: PublishContext,
	{ note, embeds, attachments }: PreparedNote,
	sitePath: string,
	snap: SiteSnapshot,
	published: Map<string, string>,
	allocation: Allocation,
): Promise<Rendered> {
	const text = transformNote(note, {
		embeds,
		crossSiteUrl: crossSiteLookup(ctx),
		sitePath,
		strategy: snap.linkStrategy,
		whitelist: ctx.whitelist,
		stringifyYaml: ctx.stringifyYaml,
		...transformRefs(ctx),
		publishedPath: (p) => published.get(p),
		attachmentPath: (p) => allocation.paths.get(p),
	});
	return {
		text,
		textSha: await gitBlobSha(text),
		attachmentPaths: [...new Set(attachments.map((a) => allocation.paths.get(a.vaultPath)!))],
	};
}

/** 一批中的一篇：准备好的笔记（prepareNote）与（首次发布时的）站内路径 */
export interface PublishItem extends PreparedNote {
	/** 首次发布的站内路径（相对内容目录，含 .md）；已发布的笔记忽略此项 */
	sitePath?: string;
}

export type ItemOutcome = { vaultPath: string; kind: 'published' | 'updated' | 'upToDate' | 'unpublished'; sitePath: string; url: string };

export interface BatchOutcome {
	items: ItemOutcome[];
	/** 没有任何变化时为 undefined（未提交） */
	commitSha?: string;
}

/** 提交信息所需的摘要（站内路径，不含 vault 路径） */
export interface BatchSummary {
	published: string[];
	updated: string[];
	unpublished: string[];
}

export interface BatchOptions {
	message: (summary: BatchSummary) => string;
	/** 撤下的笔记（vault 路径）；与 items 在同一次提交中处理 */
	unpublish?: string[];
}

/**
 * 多篇发布 / 更新（可同时撤稿）合并为一次提交（需求 §6.2）。
 * 「本站已发布」视图 = manifest + 本批发布的笔记 − 本批撤下的笔记，因此批内互链正确。
 * 任一首次发布的笔记网址冲突时整批不提交（BatchConflictError）。
 */
export async function publishBatch(ctx: PublishContext, items: PublishItem[], opts: BatchOptions): Promise<BatchOutcome> {
	for (const { note } of items) {
		if (isExcluded(note.vaultPath, ctx.excludedFolders)) {
			throw new Error(`笔记 ${note.vaultPath} 位于排除文件夹中，不能发布`);
		}
	}
	const removing = new Set(opts.unpublish ?? []);
	const bytesOf = new Map(items.flatMap((i) => i.attachments.map((a) => [a.vaultPath, a.bytes] as const)));
	let outcomes: ItemOutcome[] = [];
	let summary: BatchSummary = { published: [], updated: [], unpublished: [] };

	const result = await ctx.backend.commit(
		() => opts.message(summary),
		async (head): Promise<Change[]> => {
			const snap = await loadSnapshot(ctx, head);
			const records = new Map(snap.manifest.notes.map((n) => [n.vaultPath, n]));
			outcomes = [];
			summary = { published: [], updated: [], unpublished: [] };

			// 1. 确定每篇的站内位置；首次发布的做冲突检测（与站上已有内容、与本批其他新位置）
			const targets = new Map<string, string>();
			const conflicts: PublishConflictError[] = [];
			const owners = slugOwners(snap);
			const batchNew: { vaultPath: string; sitePath: string }[] = [];
			for (const { note, sitePath } of items) {
				const record = records.get(note.vaultPath);
				const target = record?.sitePath ?? sitePath;
				if (!target) throw new Error(`笔记 ${note.vaultPath} 尚未发布到「${ctx.site.name}」，首次发布需要指定站内路径`);
				targets.set(note.vaultPath, target);
				if (record) continue;
				const found = findConflicts(target, owners);
				for (const other of batchNew) {
					if (slugOf(other.sitePath) === slugOf(target)) {
						found.push({ slug: slugOf(target), owner: { kind: 'file', path: other.sitePath } });
					}
				}
				if (found.length) conflicts.push(new PublishConflictError(target, found));
				batchNew.push({ vaultPath: note.vaultPath, sitePath: target });
			}
			if (conflicts.length === 1) throw conflicts[0]!;
			if (conflicts.length > 1) throw new BatchConflictError(conflicts);

			// 2. 本站已发布视图与附件分配（全批一次）
			const published = new Map([...records].filter(([p]) => !removing.has(p)).map(([p, r]) => [p, r.sitePath]));
			for (const [p, s] of targets) published.set(p, s);
			const allocation = allocateAttachments(
				items.flatMap((i) => i.attachments),
				snap.manifest,
				snap.contentFiles.filter((f) => f.path.startsWith('assets/')),
			);

			// 3. 逐篇生成发布副本
			const changes: Change[] = [];
			const nextRecords = new Map(records);
			const now = ctx.now?.() ?? new Date().toISOString();
			for (const item of items) {
				const { note } = item;
				const target = targets.get(note.vaultPath)!;
				const record = records.get(note.vaultPath);
				const r = await render(ctx, item, target, snap, published, allocation);
				const existing = snap.allFiles.find((f) => f.path === repoPath(ctx.site, target));
				const contentChanged = existing?.sha !== r.textSha;
				const sameAttachments =
					record !== undefined &&
					record.attachments.length === r.attachmentPaths.length &&
					r.attachmentPaths.every((a) => record.attachments.includes(a));
				const url = urlOf(ctx.site.siteUrl, target);
				if (record && !contentChanged && sameAttachments) {
					outcomes.push({ vaultPath: note.vaultPath, kind: 'upToDate', sitePath: target, url });
					continue; // 不刷新 publishedAt
				}
				if (contentChanged) changes.push({ path: repoPath(ctx.site, target), content: r.text });
				nextRecords.set(note.vaultPath, {
					vaultPath: note.vaultPath,
					sitePath: target,
					blobSha: r.textSha,
					publishedAt: now,
					attachments: r.attachmentPaths,
					aliases: record?.aliases ?? [],
				});
				const kind = record ? 'updated' : 'published';
				outcomes.push({ vaultPath: note.vaultPath, kind, sitePath: target, url });
				summary[kind].push(target);
			}

			// 4. 撤稿：删除文件与记录（附件保留）；文件已被外部删除时只清理记录
			for (const vaultPath of removing) {
				const record = records.get(vaultPath);
				if (!record) continue;
				if (snap.allFiles.some((f) => f.path === repoPath(ctx.site, record.sitePath))) {
					changes.push({ path: repoPath(ctx.site, record.sitePath), delete: true });
				}
				nextRecords.delete(vaultPath);
				outcomes.push({ vaultPath, kind: 'unpublished', sitePath: record.sitePath, url: urlOf(ctx.site.siteUrl, record.sitePath) });
				summary.unpublished.push(record.sitePath);
			}

			for (const u of allocation.uploads) {
				changes.push({ path: repoPath(ctx.site, u.sitePath), content: bytesOf.get(u.vaultPath)! });
			}
			const anyRecordChange = summary.published.length + summary.updated.length + summary.unpublished.length > 0;
			if (!anyRecordChange && allocation.uploads.length === 0) return []; // 全部已是最新：不提交
			changes.push(
				manifestChange({
					...snap.manifest,
					notes: [...nextRecords.values()],
					attachments: [...snap.manifest.attachments, ...allocation.newRecords],
				}),
			);
			return changes;
		},
	);
	return { items: outcomes, commitSha: result?.commitSha };
}

// —— 单篇封装（Phase 2 接口，行为不变） ——

export type PublishOutcome =
	| { kind: 'published' | 'updated'; sitePath: string; url: string; commitSha: string }
	| { kind: 'upToDate'; sitePath: string; url: string };

export interface PublishOptions {
	/** 首次发布的站内路径（相对内容目录，含 .md）；已发布的笔记忽略此项 */
	sitePath?: string;
	/** 提交信息 */
	message: (kind: 'published' | 'updated', sitePath: string) => string;
}

/** 首次发布或更新。首次发布网址冲突时抛 PublishConflictError；内容无变化时不提交 */
export async function publishNote(ctx: PublishContext, note: ParsedNote, opts: PublishOptions): Promise<PublishOutcome> {
	const prepared = isExcluded(note.vaultPath, ctx.excludedFolders)
		? { note, embeds: new Map(), attachments: [] }
		: await prepareNote(ctx, note);
	const out = await publishBatch(ctx, [{ ...prepared, sitePath: opts.sitePath }], {
		message: (s) => (s.published.length ? opts.message('published', s.published[0]!) : opts.message('updated', s.updated[0]!)),
	});
	const item = out.items[0]!;
	if (out.commitSha === undefined || item.kind === 'upToDate') return { kind: 'upToDate', sitePath: item.sitePath, url: item.url };
	return { kind: item.kind as 'published' | 'updated', sitePath: item.sitePath, url: item.url, commitSha: out.commitSha };
}

export type UnpublishOutcome = { kind: 'unpublished'; sitePath: string; commitSha: string } | { kind: 'notPublished' };

/** 撤稿：删除笔记文件与 manifest 记录，附件保留（需求 §7） */
export async function unpublishNote(
	ctx: PublishContext,
	vaultPath: string,
	message: (sitePath: string) => string,
): Promise<UnpublishOutcome> {
	const out = await publishBatch(ctx, [], { unpublish: [vaultPath], message: (s) => message(s.unpublished[0]!) });
	const item = out.items[0];
	return item && out.commitSha ? { kind: 'unpublished', sitePath: item.sitePath, commitSha: out.commitSha } : { kind: 'notPublished' };
}

export type NoteStatus = { kind: 'unpublished' } | { kind: 'synced' | 'modified'; sitePath: string; url: string };

/** 笔记在该站的状态：转换结果的 blob SHA 与仓库中该路径的 SHA 比较（需求 §6.1；「已移动」属 Phase 4） */
export async function noteStatus(ctx: PublishContext, prepared: PreparedNote, snap: SiteSnapshot): Promise<NoteStatus> {
	const record = snap.manifest.notes.find((n) => n.vaultPath === prepared.note.vaultPath);
	if (!record) return { kind: 'unpublished' };
	const allocation = allocateAttachments(
		prepared.attachments,
		snap.manifest,
		snap.contentFiles.filter((f) => f.path.startsWith('assets/')),
	);
	const published = new Map(snap.manifest.notes.map((n) => [n.vaultPath, n.sitePath]));
	const r = await render(ctx, prepared, record.sitePath, snap, published, allocation);
	const existing = snap.allFiles.find((f) => f.path === repoPath(ctx.site, record.sitePath));
	const synced = existing?.sha === r.textSha && allocation.uploads.length === 0;
	return { kind: synced ? 'synced' : 'modified', sitePath: record.sitePath, url: urlOf(ctx.site.siteUrl, record.sitePath) };
}

/** manifest 中源笔记已不在 vault 的记录（需求 §6.1「源笔记已删除」） */
export function deletedSources(manifest: ManifestV1, exists: (vaultPath: string) => boolean): NoteRecord[] {
	return manifest.notes.filter((n) => !exists(n.vaultPath));
}
