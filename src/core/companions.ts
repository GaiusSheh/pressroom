// 连带发布（需求 §7 2026-10-04 修订：只在跟随 vault 站点提供；Phase 4 详细计划 4-4）
// 从本篇出发收集指向「未在本站发布」笔记的链接目标：一层 = 直接链接；到底 = 广度优先递归。
// 只跟随链接（嵌入的内容会展开进本篇，不单独成页）；跳过排除文件夹、无法解析、已在本站发布的笔记；去重防循环

import { unpublishedLinkTargets } from './backlinks';
import type { ParsedNote } from './note';

/** 到底时最多收集的篇数（防止大 vault 中无止境地遍历）；超过时 truncated = true */
export const MAX_COMPANIONS = 500;

export interface CompanionScan {
	/** vault 路径：本篇直接链接的在前（按出现顺序），到底时之后按广度优先顺序 */
	paths: string[];
	/** 到底的收集因达到上限而停止 */
	truncated: boolean;
}

export interface CompanionDeps {
	/** 读取并解析笔记；不存在返回 undefined（到底时使用） */
	load(vaultPath: string): Promise<ParsedNote | undefined>;
	resolve(target: string, from: string): string | undefined;
	excluded(vaultPath: string): boolean;
	/** 已在本站发布 */
	publishedOnSite(vaultPath: string): boolean;
	/** 本篇上次发布时已输出为纯文本的链接目标：更新时不再询问（只对本篇的直接链接生效） */
	known?: Set<string>;
}

/** @param deep false = 一层，true = 到底 */
export async function scanCompanions(start: ParsedNote, deps: CompanionDeps, deep: boolean): Promise<CompanionScan> {
	const targets = (note: ParsedNote) =>
		unpublishedLinkTargets(note, (t, f) => deps.resolve(t, f), (p) => deps.excluded(p), (p) => deps.publishedOnSite(p));
	const paths = targets(start).filter((p) => !deps.known?.has(p));
	if (!deep) return { paths, truncated: false };
	const seen = new Set([start.vaultPath, ...paths]);
	for (let i = 0; i < paths.length; i++) {
		const note = await deps.load(paths[i]!);
		if (!note) continue;
		for (const p of targets(note)) {
			if (seen.has(p)) continue;
			if (paths.length >= MAX_COMPANIONS) return { paths, truncated: true };
			seen.add(p);
			paths.push(p);
		}
	}
	return { paths, truncated: false };
}
