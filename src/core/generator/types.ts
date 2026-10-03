// 生成器适配层接口：网址规则、冲突检测、链接输出、站点配置读取。v1 只有 Quartz 5 实现

/** Quartz CrawlLinks 的 markdownLinkResolution */
export type LinkStrategy = 'shortest' | 'absolute' | 'relative';

/** 站点中占用网址的东西：内容文件（相对内容目录的路径）或 frontmatter alias（原文） */
export type SlugOwner = { kind: 'file'; path: string } | { kind: 'alias'; alias: string; ownerPath: string };

export interface Conflict {
	/** 冲突的 slug */
	slug: string;
	owner: SlugOwner;
}

export interface LinkTarget {
	/** 链接所在笔记的站内路径（相对内容目录，含扩展名） */
	from: string;
	/** 目标的站内路径（相对内容目录，含扩展名） */
	to: string;
	/** 锚点原文（标题文字或 ^块 id），不含 # */
	anchor?: string;
	/** 显示文字 */
	text: string;
	strategy: LinkStrategy;
}

export interface SiteGeneratorInfo {
	linkStrategy: LinkStrategy;
	/** 配置中未写 markdownLinkResolution，使用了插件默认值 */
	linkStrategyDefaulted: boolean;
	/** AliasRedirects 是否启用（挪动后旧网址能否重定向） */
	aliasRedirects: boolean;
	/** configuration.ignorePatterns：匹配的文件不会被构建 */
	ignorePatterns: string[];
	/** configuration.baseUrl */
	baseUrl?: string;
}

export type SiteConfigResult =
	| { ok: true; info: SiteGeneratorInfo }
	| { ok: false; reason: 'missing' | 'invalid'; detail: string };

/** YAML 解析器由平台层注入（Obsidian 提供 parseYaml），core 不依赖 obsidian */
export type YamlParser = (text: string) => unknown;

export interface Generator {
	/** 站内路径 → slug（与站点生成器一致） */
	slugOf(path: string): string;
	/** 站内路径 → 页面完整网址 */
	urlOf(siteUrl: string, path: string): string;
	/** 候选路径与已有文件 / alias 的网址冲突；exclude 为不参与比较的路径（如被移动笔记的当前位置） */
	findConflicts(candidate: string, owners: SlugOwner[], exclude?: string): Conflict[];
	/** 生成指向站内另一篇笔记的 Markdown 链接 */
	formatLink(target: LinkTarget): string;
	/** 解析站点配置文件；text 为 undefined 表示文件不存在 */
	readSiteConfig(text: string | undefined, parseYaml: YamlParser): SiteConfigResult;
}
