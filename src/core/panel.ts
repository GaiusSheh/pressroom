// 管理面板的数据（纯逻辑，需求 §6、§6.1、§6.2；Phase 5 详细计划 5-1）
// 目录树只显示 Pressroom 管理的笔记（manifest 记录，2026-10-05 用户决定）

import type { NoteRecord } from './manifest/manifest';
import type { DirMode } from './types';
import type { LinkStrategy } from './generator/types';

/** 面板中一篇的状态；loading = 尚在计算，error = 计算失败（如笔记索引未就绪） */
export type PanelStatus =
	| { kind: 'loading' }
	| { kind: 'deleted' }
	| { kind: 'synced' | 'modified'; moved: boolean }
	| { kind: 'error'; message: string };

export interface TreeFolder {
	/** 文件夹名（根为空字符串） */
	name: string;
	/** 站内路径（根为空字符串） */
	path: string;
	folders: TreeFolder[];
	notes: NoteRecord[];
}

const compare = (a: string, b: string) => a.localeCompare(b, 'zh');

/** manifest 记录 → 站内目录树（按站内路径分层；文件夹在前，各层按名称排序） */
export function buildTree(records: NoteRecord[]): TreeFolder {
	const root: TreeFolder = { name: '', path: '', folders: [], notes: [] };
	for (const record of records) {
		const parts = record.sitePath.split('/');
		let node = root;
		for (const part of parts.slice(0, -1)) {
			let child = node.folders.find((f) => f.name === part);
			if (!child) {
				child = { name: part, path: node.path ? `${node.path}/${part}` : part, folders: [], notes: [] };
				node.folders.push(child);
			}
			node = child;
		}
		node.notes.push(record);
	}
	const sort = (f: TreeFolder) => {
		f.folders.sort((a, b) => compare(a.name, b.name));
		f.notes.sort((a, b) => compare(a.sitePath, b.sitePath));
		f.folders.forEach(sort);
	};
	sort(root);
	return root;
}

/** 面板顶部的批量按钮（需求 §6.2） */
export type BatchKind = 'sync' | 'update' | 'relocate' | 'cleanup';

/**
 * 当前站点显示哪些按钮：手动站点没有「已移动」，只有一键更新与清理已删除；
 * 跟随站点另有一键同步与一键重排，relative 链接策略的站点不提供一键重排（2026-10-05 决定）
 */
export function availableBatches(mode: DirMode, strategy: LinkStrategy): BatchKind[] {
	if (mode === 'manual') return ['update', 'cleanup'];
	return strategy === 'relative' ? ['sync', 'update', 'cleanup'] : ['sync', 'update', 'relocate', 'cleanup'];
}

/**
 * 某个批量按钮的作用对象（vault 路径，按 manifest 顺序）：
 * 同步 = 有修改或已移动；更新 = 有修改；重排 = 已移动；清理 = 源笔记已删除。尚在计算或计算失败的不计入
 */
export function batchTargets(kind: BatchKind, records: NoteRecord[], status: (vaultPath: string) => PanelStatus): string[] {
	return records
		.filter((r) => {
			const s = status(r.vaultPath);
			switch (kind) {
				case 'cleanup':
					return s.kind === 'deleted';
				case 'sync':
					return (s.kind === 'modified' || s.kind === 'synced') && (s.kind === 'modified' || s.moved);
				case 'update':
					return s.kind === 'modified';
				case 'relocate':
					return (s.kind === 'modified' || s.kind === 'synced') && s.moved;
			}
		})
		.map((r) => r.vaultPath);
}
