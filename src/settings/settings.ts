// 插件设置（data.json）的结构、默认值与读取时的规整（纯函数，不依赖 obsidian）

import type { DirMode, LinkPolicy, SiteConfig } from '../core/types';

export interface PressroomSettings {
	sites: SiteConfig[];
	/** Obsidian 密钥库中 token 的 id；token 本体不进 data.json */
	tokenSecretId: string;
	/** 永不发布、也不被双链连带的文件夹（vault 相对路径） */
	excludedFolders: string[];
	/** 指向未发布笔记的链接默认处理 */
	linkPolicy: LinkPolicy;
	/** 发布副本保留的 frontmatter 属性 */
	propertyWhitelist: string[];
}

export const DEFAULT_SETTINGS: PressroomSettings = {
	sites: [],
	tokenSecretId: '',
	excludedFolders: [],
	linkPolicy: 'plain',
	propertyWhitelist: ['title', 'tags', 'date', 'description'],
};

export function newSite(id: string, name: string): SiteConfig {
	return {
		id,
		name,
		repo: '',
		branch: 'main',
		contentDir: 'content',
		siteUrl: '',
		mode: 'manual',
		isolated: false,
	};
}

/** 站点必填项是否齐全（设置页用于标记需要补全的站点） */
export function isSiteComplete(site: SiteConfig): boolean {
	return Boolean(site.name && site.repo && site.branch && site.siteUrl);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const DIR_MODES: DirMode[] = ['manual', 'follow'];
const LINK_POLICIES: LinkPolicy[] = ['plain', 'one', 'all'];

function normalizeSite(raw: unknown): SiteConfig | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const r = raw as Record<string, unknown>;
	if (!isString(r.id) || !r.id) return undefined;
	const base = newSite(r.id, isString(r.name) ? r.name : '');
	return {
		...base,
		repo: isString(r.repo) ? r.repo : base.repo,
		branch: isString(r.branch) ? r.branch : base.branch,
		contentDir: isString(r.contentDir) ? r.contentDir : base.contentDir,
		siteUrl: isString(r.siteUrl) ? r.siteUrl : base.siteUrl,
		mode: DIR_MODES.includes(r.mode as DirMode) ? (r.mode as DirMode) : base.mode,
		isolated: typeof r.isolated === 'boolean' ? r.isolated : base.isolated,
	};
}

/**
 * 把 loadData() 的结果规整为完整设置：缺失或类型不对的字段用默认值，未知字段丢弃。
 * 返回被丢弃 / 回退的字段说明，供调用方在控制台提示（设置文件损坏不应让插件无法加载）。
 */
export function normalizeSettings(raw: unknown): { settings: PressroomSettings; warnings: string[] } {
	const warnings: string[] = [];
	const d = DEFAULT_SETTINGS;
	if (raw === null || raw === undefined) {
		return { settings: structuredClone(d), warnings };
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		warnings.push(`设置数据应为对象，实际为 ${Array.isArray(raw) ? 'array' : typeof raw}，已使用默认设置`);
		return { settings: structuredClone(d), warnings };
	}
	const r = raw as Record<string, unknown>;
	const pick = <T>(key: keyof PressroomSettings, ok: (v: unknown) => v is T, fallback: T): T => {
		if (r[key] === undefined) return structuredClone(fallback);
		if (ok(r[key])) return r[key];
		warnings.push(`设置项 ${key} 类型不正确，已回退为默认值`);
		return structuredClone(fallback);
	};

	const sites: SiteConfig[] = [];
	if (r.sites !== undefined) {
		if (Array.isArray(r.sites)) {
			r.sites.forEach((s, i) => {
				const site = normalizeSite(s);
				if (site) sites.push(site);
				else warnings.push(`站点 #${i + 1} 缺少 id 或格式不正确，已忽略`);
			});
		} else {
			warnings.push('设置项 sites 应为数组，已忽略');
		}
	}

	return {
		settings: {
			sites,
			tokenSecretId: pick('tokenSecretId', isString, d.tokenSecretId),
			excludedFolders: pick('excludedFolders', isStringArray, d.excludedFolders),
			linkPolicy: pick(
				'linkPolicy',
				(v): v is LinkPolicy => LINK_POLICIES.includes(v as LinkPolicy),
				d.linkPolicy,
			),
			propertyWhitelist: pick('propertyWhitelist', isStringArray, d.propertyWhitelist),
		},
		warnings,
	};
}
