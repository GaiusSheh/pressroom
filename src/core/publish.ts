// 发布 / 更新 / 撤稿与状态判定（需求 v1 §5.3、§6.1、§7、§9；Phase 2 详细计划 2-4）
// 所有写操作都在 Backend.commit 的 build 回调中、基于当次 head 重新读取 manifest 与文件树，
// 因此非 fast-forward 重试时能正确合并其他设备的改动。

import { type AttachmentInput, allocateAttachments } from './attachments';
import type { Backend, Change, Head, TreeEntry } from './backend/types';
import { findConflicts, QUARTZ_CONFIG_PATH, readSiteConfig, urlOf } from './generator/quartz';
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
	const manifestText = await read(MANIFEST_PATH);
	const manifest = manifestText === undefined ? emptyManifest(site.mode) : parseManifest(manifestText);
	const config = readSiteConfig(await read(QUARTZ_CONFIG_PATH), ctx.parseYaml);
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

/** 读取附件内容并计算 SHA（在 commit 之外做一次，重试时不重复读取） */
export async function readAttachments(ctx: PublishContext, note: ParsedNote): Promise<(AttachmentInput & { bytes: Uint8Array })[]> {
	const paths = collectAttachments(note, transformRefs(ctx));
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

interface Prepared {
	sitePath: string;
	record: NoteRecord | undefined;
	text: string;
	textSha: string;
	allocation: ReturnType<typeof allocateAttachments>;
	/** 本篇引用的附件站内路径（去重） */
	attachmentPaths: string[];
}

/** 计算本篇在该快照下的发布副本（发布与状态判定共用） */
async function prepare(
	ctx: PublishContext,
	note: ParsedNote,
	snap: SiteSnapshot,
	attachments: AttachmentInput[],
	sitePath: string,
): Promise<Prepared> {
	const record = snap.manifest.notes.find((n) => n.vaultPath === note.vaultPath);
	const allocation = allocateAttachments(
		attachments,
		snap.manifest,
		snap.contentFiles.filter((f) => f.path.startsWith('assets/')),
	);
	const published = new Map(snap.manifest.notes.map((n) => [n.vaultPath, n.sitePath]));
	published.set(note.vaultPath, sitePath);
	const text = transformNote(note, {
		sitePath,
		strategy: snap.linkStrategy,
		whitelist: ctx.whitelist,
		stringifyYaml: ctx.stringifyYaml,
		...transformRefs(ctx),
		publishedPath: (p) => published.get(p),
		attachmentPath: (p) => allocation.paths.get(p),
	});
	return {
		sitePath,
		record,
		text,
		textSha: await gitBlobSha(text),
		allocation,
		attachmentPaths: [...new Set(attachments.map((a) => allocation.paths.get(a.vaultPath)!))],
	};
}

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
	if (isExcluded(note.vaultPath, ctx.excludedFolders)) {
		throw new Error(`笔记 ${note.vaultPath} 位于排除文件夹中，不能发布`);
	}
	const attachments = await readAttachments(ctx, note);
	const bytesOf = new Map(attachments.map((a) => [a.vaultPath, a.bytes]));
	let kind: 'published' | 'updated' = 'published';
	let sitePath = '';

	const result = await ctx.backend.commit(
		() => opts.message(kind, sitePath),
		async (head): Promise<Change[]> => {
			const snap = await loadSnapshot(ctx, head);
			const record = snap.manifest.notes.find((n) => n.vaultPath === note.vaultPath);
			kind = record ? 'updated' : 'published';
			const target = record?.sitePath ?? opts.sitePath;
			if (!target) throw new Error(`笔记 ${note.vaultPath} 尚未发布到「${ctx.site.name}」，首次发布需要指定站内路径`);
			sitePath = target;
			if (!record) {
				const conflicts = findConflicts(target, slugOwners(snap));
				if (conflicts.length > 0) throw new PublishConflictError(target, conflicts);
			}

			const p = await prepare(ctx, note, snap, attachments, target);
			const existing = snap.allFiles.find((f) => f.path === repoPath(ctx.site, target));
			const contentChanged = existing?.sha !== p.textSha;
			const sameAttachments =
				record !== undefined &&
				record.attachments.length === p.attachmentPaths.length &&
				p.attachmentPaths.every((a) => record.attachments.includes(a));
			if (record && !contentChanged && p.allocation.uploads.length === 0 && p.allocation.newRecords.length === 0 && sameAttachments) {
				return []; // 已是最新：不提交，也不刷新 publishedAt
			}

			const nextRecord: NoteRecord = {
				vaultPath: note.vaultPath,
				sitePath: target,
				blobSha: p.textSha,
				publishedAt: ctx.now?.() ?? new Date().toISOString(),
				attachments: p.attachmentPaths,
				aliases: record?.aliases ?? [],
			};
			const manifest: ManifestV1 = {
				...snap.manifest,
				notes: [...snap.manifest.notes.filter((n) => n.vaultPath !== note.vaultPath), nextRecord],
				attachments: [...snap.manifest.attachments, ...p.allocation.newRecords],
			};
			const changes: Change[] = [];
			if (contentChanged) changes.push({ path: repoPath(ctx.site, target), content: p.text });
			for (const u of p.allocation.uploads) {
				changes.push({ path: repoPath(ctx.site, u.sitePath), content: bytesOf.get(u.vaultPath)! });
			}
			changes.push(manifestChange(manifest));
			return changes;
		},
	);

	const url = urlOf(ctx.site.siteUrl, sitePath);
	return result ? { kind, sitePath, url, commitSha: result.commitSha } : { kind: 'upToDate', sitePath, url };
}

export type UnpublishOutcome = { kind: 'unpublished'; sitePath: string; commitSha: string } | { kind: 'notPublished' };

/** 撤稿：删除笔记文件与 manifest 记录，附件保留（需求 §7） */
export async function unpublishNote(
	ctx: PublishContext,
	vaultPath: string,
	message: (sitePath: string) => string,
): Promise<UnpublishOutcome> {
	let sitePath = '';
	const result = await ctx.backend.commit(
		() => message(sitePath),
		async (head): Promise<Change[]> => {
			const snap = await loadSnapshot(ctx, head);
			const record = snap.manifest.notes.find((n) => n.vaultPath === vaultPath);
			if (!record) return [];
			sitePath = record.sitePath;
			const changes: Change[] = [];
			// 文件可能已在仓库外被删除，此时只清理 manifest（删除不存在的路径会被 GitHub 拒绝）
			if (snap.allFiles.some((f) => f.path === repoPath(ctx.site, record.sitePath))) {
				changes.push({ path: repoPath(ctx.site, record.sitePath), delete: true });
			}
			changes.push(manifestChange({ ...snap.manifest, notes: snap.manifest.notes.filter((n) => n !== record) }));
			return changes;
		},
	);
	return result ? { kind: 'unpublished', sitePath, commitSha: result.commitSha } : { kind: 'notPublished' };
}

export type NoteStatus = { kind: 'unpublished' } | { kind: 'synced' | 'modified'; sitePath: string; url: string };

/** 笔记在该站的状态：转换结果的 blob SHA 与仓库中该路径的 SHA 比较（需求 §6.1；「已移动」属 Phase 4） */
export async function noteStatus(
	ctx: PublishContext,
	note: ParsedNote,
	snap: SiteSnapshot,
	attachments: AttachmentInput[],
): Promise<NoteStatus> {
	const record = snap.manifest.notes.find((n) => n.vaultPath === note.vaultPath);
	if (!record) return { kind: 'unpublished' };
	const p = await prepare(ctx, note, snap, attachments, record.sitePath);
	const existing = snap.allFiles.find((f) => f.path === repoPath(ctx.site, record.sitePath));
	const synced = existing?.sha === p.textSha && p.allocation.uploads.length === 0;
	return { kind: synced ? 'synced' : 'modified', sitePath: record.sitePath, url: urlOf(ctx.site.siteUrl, record.sitePath) };
}

/** manifest 中源笔记已不在 vault 的记录（需求 §6.1「源笔记已删除」） */
export function deletedSources(manifest: ManifestV1, exists: (vaultPath: string) => boolean): NoteRecord[] {
	return manifest.notes.filter((n) => !exists(n.vaultPath));
}
