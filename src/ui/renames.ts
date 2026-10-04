// vault 改名 / 移动监听与自动写回（需求 §9；2026-10-04 用户决定：改名后自动提交，几秒内合并为一次，
// 离线或失败时记在 data.json，插件加载或下次操作时补提交）。
// 未写回前，PublishContext.renames 让状态与发布按新路径计算（见 core/publish.ts loadSnapshot），
// 因此先改名、再立即发布也不会把改名后的笔记当作新笔记重复发布

import { TFile } from 'obsidian';
import type PressroomPlugin from '../main';
import type { Rename } from '../core/renames';
import type { SiteConfig } from '../core/types';
import { type PendingRename, isSiteComplete } from '../settings/settings';

/** 最后一次改名后等待的时间，期间的多次改名合并为一次提交 */
const DEBOUNCE_MS = 3000;

export class RenameQueue {
	private timer: number | undefined;
	private running: Promise<void> = Promise.resolve();

	constructor(
		private readonly plugin: PressroomPlugin,
		/** 把改名写回某站点仓库；失败时抛错（条目保留，之后重试） */
		private readonly write: (site: SiteConfig, renames: Rename[]) => Promise<void>,
		/** 记录了新的改名（站点快照缓存应失效） */
		private readonly onRecorded: () => void,
	) {}

	register(): void {
		const { plugin } = this;
		plugin.registerEvent(
			plugin.app.vault.on('rename', (file, oldPath) => {
				// 只关心笔记与文件夹（文件夹改名可能只触发一次文件夹事件，按前缀处理）；附件在 manifest 中按站内路径记录，与 vault 路径无关
				if (file instanceof TFile && file.extension !== 'md') return;
				this.record(oldPath, file.path);
			}),
		);
		// 插件加载后补写上次未写回的改名
		plugin.app.workspace.onLayoutReady(() => void this.flush());
		plugin.register(() => window.clearTimeout(this.timer));
	}

	/** 某站点尚未写回的改名（按发生顺序） */
	pending(siteId: string): PendingRename[] {
		return this.plugin.settings.pendingRenames[siteId] ?? [];
	}

	private record(from: string, to: string) {
		const all = this.plugin.settings.pendingRenames;
		const id = Math.max(0, ...Object.values(all).flat().map((r) => r.id)) + 1;
		// 记给所有站点：哪些站点发布过这篇，要读取仓库才知道；不受影响的站点写回时不提交
		for (const site of this.plugin.settings.sites) {
			all[site.id] = [...(all[site.id] ?? []), { id, from, to }];
		}
		void this.plugin.saveSettings();
		this.onRecorded();
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => void this.flush(), DEBOUNCE_MS);
	}

	/** 写回所有站点的待写改名；与正在进行的写回串行 */
	flush(): Promise<void> {
		this.running = this.running.then(() => this.flushOnce());
		return this.running;
	}

	private async flushOnce() {
		window.clearTimeout(this.timer);
		this.timer = undefined;
		for (const site of this.plugin.settings.sites) {
			const list = this.pending(site.id);
			if (list.length === 0 || !isSiteComplete(site)) continue;
			try {
				await this.write(site, list);
			} catch (e) {
				console.warn(`[Pressroom] 改名暂未写回站点「${site.name}」，之后重试`, e);
				continue;
			}
			// 只移除已写回的条目：写回期间新发生的改名留待下次
			const done = new Set(list.map((r) => r.id));
			const rest = this.pending(site.id).filter((r) => !done.has(r.id));
			if (rest.length) this.plugin.settings.pendingRenames[site.id] = rest;
			else delete this.plugin.settings.pendingRenames[site.id];
			await this.plugin.saveSettings();
		}
	}
}
