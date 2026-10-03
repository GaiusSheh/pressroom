// Quartz 5 生成器适配。slug 规则直接复用 Quartz 5 所用的 @quartz-community/utils，不自行实现
// 依据：.dev/docs/others/phase0-findings.md §0-1 ~ §0-3

import { type FilePath, getFileExtension, simplifySlug, slugifyFilePath } from '@quartz-community/utils/path';
import type { Conflict, Generator, LinkStrategy, LinkTarget, SiteConfigResult, SlugOwner, YamlParser } from './types';

/** Quartz 配置文件在站点仓库中的路径 */
export const QUARTZ_CONFIG_PATH = 'quartz.config.yaml';

export function slugOf(path: string): string {
	return slugifyFilePath(path as FilePath);
}

/** alias 的 slug：与 note-properties 插件 getAliasSlugs 一致（非 .md 结尾时补 .md 再 slug） */
export function aliasSlugOf(alias: string): string {
	return slugifyFilePath((getFileExtension(alias) === '.md' ? alias : `${alias}.md`) as FilePath);
}

export function urlOf(siteUrl: string, path: string): string {
	const simple = simplifySlug(slugOf(path));
	const tail = simple === '/' ? '' : encodeURI(simple);
	return `${siteUrl.replace(/\/+$/, '')}/${tail}`;
}

export function findConflicts(candidate: string, owners: SlugOwner[], exclude?: string): Conflict[] {
	const target = slugOf(candidate);
	const excludeSlug = exclude === undefined ? undefined : slugOf(exclude);
	return owners
		.filter((owner) => {
			// 被移动笔记自身的文件与它写入的 alias 都不算冲突
			if (excludeSlug !== undefined) {
				if (owner.kind === 'file' && slugOf(owner.path) === excludeSlug) return false;
				if (owner.kind === 'alias' && slugOf(owner.ownerPath) === excludeSlug) return false;
			}
			return true;
		})
		.map((owner) => ({ slug: owner.kind === 'file' ? slugOf(owner.path) : aliasSlugOf(owner.alias), owner }))
		.filter((c) => c.slug === target);
}

/** 链接显示文字中的 [ ] \ 需转义 */
function escapeLinkText(text: string): string {
	return text.replace(/([\\[\]])/g, '\\$1');
}

/** 由 from 所在目录指向 to 的相对路径（两者均为 / 分隔、无前导斜杠） */
function relativePath(from: string, to: string): string {
	const fromDir = from.split('/').slice(0, -1);
	const toParts = to.split('/');
	let i = 0;
	while (i < fromDir.length && i < toParts.length - 1 && fromDir[i] === toParts[i]) i++;
	const up = fromDir.slice(i).map(() => '..');
	const rest = toParts.slice(i);
	return (up.length ? up : ['.']).concat(rest).join('/');
}

/**
 * 链接目标写目标的 slug（而非原文件名）：Quartz 会再 slug 一次且结果不变，
 * 空格、%、#、<> 等已被 slug 规则去除或替换，无需再转义；剩余的半角括号用尖括号包裹。
 * shortest / absolute 输出从内容目录根起的完整路径；relative 输出相对路径。
 */
export function formatLink({ from, to, anchor, text, strategy }: LinkTarget): string {
	const targetSlug = slugOf(to);
	const path = strategy === 'relative' ? relativePath(slugOf(from), targetSlug) : targetSlug;
	const hash = anchor ? `#${anchor}` : '';
	return `[${escapeLinkText(text)}](<${path}${hash}>)`;
}

const LINK_STRATEGIES: LinkStrategy[] = ['shortest', 'absolute', 'relative'];
/** CrawlLinks 未配置 markdownLinkResolution 时的插件默认值（见 Quartz 5 docs/plugins/CrawlLinks.md） */
const CRAWL_LINKS_DEFAULT: LinkStrategy = 'absolute';

type PluginEntry = { source?: unknown; enabled?: unknown; options?: unknown };

/** 插件 source 可写作 @quartz-community/crawl-links 或 github:quartz-community/crawl-links 等，按末段名称匹配 */
function findPlugin(plugins: PluginEntry[], name: string): PluginEntry | undefined {
	return plugins.find((p) => typeof p.source === 'string' && p.source.replace(/\/+$/, '').split('/').pop() === name);
}

const isEnabled = (p: PluginEntry | undefined) => p !== undefined && p.enabled !== false;

export function readSiteConfig(text: string | undefined, parseYaml: YamlParser): SiteConfigResult {
	if (text === undefined) {
		return { ok: false, reason: 'missing', detail: `仓库中没有 ${QUARTZ_CONFIG_PATH}` };
	}
	let doc: unknown;
	try {
		doc = parseYaml(text);
	} catch (e) {
		return { ok: false, reason: 'invalid', detail: `YAML 解析失败：${e instanceof Error ? e.message : String(e)}` };
	}
	if (typeof doc !== 'object' || doc === null) {
		return { ok: false, reason: 'invalid', detail: '配置文件顶层应为对象' };
	}
	const root = doc as Record<string, unknown>;
	if (!Array.isArray(root.plugins)) {
		return { ok: false, reason: 'invalid', detail: '配置文件缺少 plugins 列表，可能不是 Quartz 5 配置' };
	}
	const plugins = root.plugins.filter((p): p is PluginEntry => typeof p === 'object' && p !== null);

	const crawl = findPlugin(plugins, 'crawl-links');
	const raw = (crawl?.options as Record<string, unknown> | undefined)?.markdownLinkResolution;
	const configured = LINK_STRATEGIES.includes(raw as LinkStrategy) ? (raw as LinkStrategy) : undefined;

	const conf = (typeof root.configuration === 'object' && root.configuration !== null
		? root.configuration
		: {}) as Record<string, unknown>;
	const ignorePatterns = Array.isArray(conf.ignorePatterns)
		? conf.ignorePatterns.filter((p): p is string => typeof p === 'string')
		: [];

	return {
		ok: true,
		info: {
			linkStrategy: configured ?? CRAWL_LINKS_DEFAULT,
			linkStrategyDefaulted: configured === undefined,
			aliasRedirects: isEnabled(findPlugin(plugins, 'alias-redirects')),
			ignorePatterns,
			baseUrl: typeof conf.baseUrl === 'string' ? conf.baseUrl : undefined,
		},
	};
}

export const quartzGenerator: Generator = { slugOf, urlOf, findConflicts, formatLink, readSiteConfig };
