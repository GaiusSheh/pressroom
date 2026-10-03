// 跨模块共享的类型。本目录（core/）禁止 import "obsidian"

/** 站点目录模式：手动 / 跟随 vault（需求 §5.1） */
export type DirMode = 'manual' | 'follow';

/** 指向未发布笔记的链接处理（需求 §7）：纯文本 / 连带一层 / 连带到底 */
export type LinkPolicy = 'plain' | 'one' | 'all';

export interface SiteConfig {
	/** 插件内部 id，创建时生成，不随名称变化 */
	id: string;
	/** 显示名称，如「站点 A」 */
	name: string;
	/** GitHub 仓库 owner/repo */
	repo: string;
	branch: string;
	/** 仓库内 Quartz 内容目录，不含首尾斜杠，如 content */
	contentDir: string;
	/** 站点网址，不含末尾斜杠 */
	siteUrl: string;
	mode: DirMode;
	/** 隔离：指向其他站点的链接一律输出纯文本（需求 §8） */
	isolated: boolean;
}
