// 设置项校验与规整（纯函数，不依赖 obsidian）。返回 { value } 表示通过，{ error } 为 i18n 键

import type { MessageKey } from '../i18n';

export type Checked =
	| { value: string; error?: undefined }
	| { value?: undefined; error: MessageKey; vars?: Record<string, string | number> };

export function checkRequired(raw: string): Checked {
	const value = raw.trim();
	return value ? { value } : { error: 'error.required' };
}

/** GitHub 仓库：owner/repo，owner 与 repo 只含字母数字、-、_、. */
export function checkRepo(raw: string): Checked {
	const value = raw.trim().replace(/\.git$/, '');
	return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value) ? { value } : { error: 'error.repo' };
}

/** 分支名：非空，不含空白与 git 禁用字符 */
export function checkBranch(raw: string): Checked {
	const value = raw.trim();
	if (!value) return { error: 'error.required' };
	return /[\s~^:?*[\\]|\.\.|^\/|\/$/.test(value) ? { error: 'error.branch' } : { value };
}

/** 内容目录：去首尾斜杠与空白，统一为 /；允许为空（仓库根即内容目录） */
export function checkContentDir(raw: string): Checked {
	const value = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	return value.split('/').some((seg) => seg === '..' || seg === '.')
		? { error: 'error.contentDir' }
		: { value };
}

/** 站点网址：http(s) 完整网址，去末尾斜杠 */
export function checkSiteUrl(raw: string): Checked {
	const value = raw.trim().replace(/\/+$/, '');
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'error.url' };
		return { value };
	} catch {
		return { error: 'error.url' };
	}
}

/** 站点名称：非空，且不与其他站点重名（比较时忽略大小写与首尾空白） */
export function checkSiteName(raw: string, otherNames: string[]): Checked {
	const required = checkRequired(raw);
	if (required.error) return required;
	const lower = required.value.toLowerCase();
	return otherNames.some((n) => n.trim().toLowerCase() === lower)
		? { error: 'error.nameDuplicate' }
		: required;
}

/**
 * 每个站点必须有独立的「仓库 + 分支」：manifest 存在分支根目录，同一分支的两个站点会共用发布记录、互相误判
 * （2026-10-04 用户决定：禁止同仓库同分支，同仓库不同分支允许）。仓库名比较忽略大小写（GitHub 不区分）
 */
export function findRepoBranchClash<T extends { id: string; name: string; repo: string; branch: string }>(
	site: { id: string; repo: string; branch: string },
	sites: T[],
): T | undefined {
	const repo = site.repo.trim().toLowerCase();
	const branch = site.branch.trim();
	if (!repo || !branch) return undefined;
	return sites.find((s) => s.id !== site.id && s.repo.trim().toLowerCase() === repo && s.branch.trim() === branch);
}

/** 多行或逗号分隔的列表 → 去空白、去空项、去重 */
export function parseList(raw: string): string[] {
	const items = raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
	return [...new Set(items)];
}

/** 排除文件夹：在 parseList 基础上去首尾斜杠 */
export function parseFolders(raw: string): string[] {
	return [...new Set(parseList(raw).map((f) => f.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean))];
}
