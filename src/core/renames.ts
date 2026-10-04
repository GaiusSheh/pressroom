// vault 改名 / 移动 → manifest 源路径更新（需求 §9；Phase 4 详细计划 4-3）
// 站内路径不变；跟随 vault 站点因此出现「已移动」。改名按顺序应用，支持文件夹前缀与链式改名（A→B→C）。
// 同一改名重复应用无副作用（Obsidian 改文件夹名时，文件夹与其中文件可能各触发一次事件）

import type { ManifestV1 } from './manifest/manifest';

export interface Rename {
	/** 改名前的 vault 路径（文件或文件夹） */
	from: string;
	/** 改名后的 vault 路径 */
	to: string;
}

/** 单个路径经一次改名后的结果；不受影响时返回 undefined */
function renamed(path: string, r: Rename): string | undefined {
	if (path === r.from) return r.to;
	if (path.startsWith(`${r.from}/`)) return r.to + path.slice(r.from.length);
	return undefined;
}

/**
 * 依次应用改名，返回新 manifest 与源路径改变的记录数。
 * 新路径已被另一条记录占用（如那篇的源笔记已删除、又有笔记改名到同一路径）时跳过该条，
 * 避免 manifest 中出现重复的 vault 路径（已删除的那条留待管理面板「清理已删除」处理）
 */
export function applyRenames(manifest: ManifestV1, renames: Rename[]): { manifest: ManifestV1; changed: number } {
	const notes = manifest.notes.map((n) => ({ ...n }));
	const original = new Map(notes.map((n) => [n, n.vaultPath]));
	for (const r of renames) {
		if (r.from === r.to) continue;
		const taken = new Set(notes.map((n) => n.vaultPath));
		for (const n of notes) {
			const next = renamed(n.vaultPath, r);
			if (next === undefined) continue;
			if (taken.has(next)) continue;
			taken.delete(n.vaultPath);
			taken.add(next);
			n.vaultPath = next;
		}
	}
	const changed = notes.filter((n) => original.get(n) !== n.vaultPath).length;
	return { manifest: changed ? { ...manifest, notes } : manifest, changed };
}
