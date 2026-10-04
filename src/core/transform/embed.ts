// 嵌入笔记的预加载（需求 v1 §7）：转换是同步纯函数，因此在转换前把所有可达的嵌入内容异步读好
// 展开时的防循环与深度上限在 transform.ts 中处理（依赖展开链）

import { type EmbedSource, type NoteRef, type ParsedNote, type VaultAccess, isMarkdown } from '../note';

/** 嵌入展开的最大深度（含本篇的嵌入为第 1 层） */
export const MAX_EMBED_DEPTH = 10;

export type EmbedMap = Map<string, EmbedSource>;

export const embedKey = (vaultPath: string, subpath?: string) => `${vaultPath}\u0000${subpath ?? ''}`;

/** 落在 [start, end) 中、且位于正文（frontmatter 之后）的引用 */
export function refsInRange(note: ParsedNote, start: number, end: number): NoteRef[] {
	const bodyStart = note.frontmatter?.bodyStart ?? 0;
	return note.refs.filter((r) => r.start >= Math.max(start, bodyStart) && r.end <= end);
}

export interface EmbedLoadContext {
	vault: Pick<VaultAccess, 'resolve' | 'loadEmbed'>;
	excluded: (vaultPath: string) => boolean;
}

/**
 * 从本篇出发，广度优先读取所有可达的嵌入笔记（去重；排除文件夹中的不读取；深度不超过上限）。
 * 读取失败（笔记或子路径不存在）的不放入结果，转换时显示为纯文本。
 */
export async function loadEmbeds(note: ParsedNote, ctx: EmbedLoadContext): Promise<EmbedMap> {
	const map: EmbedMap = new Map();
	const seen = new Set<string>();
	let frontier: { source: ParsedNote; start: number; end: number }[] = [{ source: note, start: 0, end: note.text.length }];
	for (let depth = 1; depth <= MAX_EMBED_DEPTH && frontier.length > 0; depth++) {
		const next: typeof frontier = [];
		for (const { source, start, end } of frontier) {
			for (const ref of refsInRange(source, start, end)) {
				if (!ref.embed) continue;
				const target = ref.target === '' ? source.vaultPath : ctx.vault.resolve(ref.target, source.vaultPath);
				if (target === undefined || !isMarkdown(target) || ctx.excluded(target)) continue;
				const key = embedKey(target, ref.subpath);
				if (seen.has(key)) continue;
				seen.add(key);
				const loaded = await ctx.vault.loadEmbed(target, ref.subpath);
				if (!loaded) continue;
				map.set(key, loaded);
				next.push({ source: loaded.note, start: loaded.start, end: loaded.end });
			}
		}
		frontier = next;
	}
	return map;
}
