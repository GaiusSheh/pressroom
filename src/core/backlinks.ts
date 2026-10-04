// 反向链接提醒（需求 v1 §7，2026-10-04 新增）：找出本站已发布、且在 vault 中链接（或嵌入）到某篇的笔记
// 只看直接引用（一层）：重新发布已在站上的笔记不改变站上有哪些笔记、在什么位置，不会引起连锁更新

import type { ManifestV1 } from './manifest/manifest';
import { type ParsedNote, isMarkdown } from './note';

/**
 * @param sources vault 中链接或嵌入到 target 的笔记（Obsidian resolvedLinks 反查得到）
 * @returns 其中已在本站发布的（不含 target 自身），按 manifest 顺序
 */
export function publishedBacklinks(target: string, sources: string[], manifest: ManifestV1): string[] {
	const set = new Set(sources);
	return manifest.notes.map((n) => n.vaultPath).filter((p) => p !== target && set.has(p));
}

/**
 * 本篇中指向「未在本站发布」笔记的链接（不含嵌入、排除文件夹、本篇自身、无法解析的），vault 路径去重。
 * 用于手动站点首次发布时的说明（需求 §7 2026-10-04 修订）
 */
export function unpublishedLinkTargets(
	note: ParsedNote,
	resolve: (target: string, from: string) => string | undefined,
	excluded: (vaultPath: string) => boolean,
	publishedOnSite: (vaultPath: string) => boolean,
): string[] {
	const out: string[] = [];
	const bodyStart = note.frontmatter?.bodyStart ?? 0;
	for (const ref of note.refs) {
		if (ref.embed || ref.start < bodyStart || ref.target === '') continue;
		const p = resolve(ref.target, note.vaultPath);
		if (p === undefined || !isMarkdown(p) || p === note.vaultPath || excluded(p) || publishedOnSite(p)) continue;
		if (!out.includes(p)) out.push(p);
	}
	return out;
}
