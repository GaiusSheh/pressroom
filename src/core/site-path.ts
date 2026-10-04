// 首次发布位置弹窗中的站内路径拼接与校验（纯函数）

/** 站内目录 + 名称 → 站内路径（相对内容目录，含 .md） */
export function joinSitePath(dir: string, name: string): string {
	const d = dir.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	return `${d ? `${d}/` : ''}${name.trim()}.md`;
}

/** 名称：非空，不含 / 与 \ */
export function isValidName(name: string): boolean {
	return name.trim() !== '' && !/[/\\]/.test(name);
}

/** 目录：可为空（站点根），不含 . 或 .. 段，不含连续斜杠造成的空段 */
export function isValidDir(dir: string): boolean {
	const d = dir.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	return d === '' || !d.split('/').some((s) => s === '' || s === '.' || s === '..');
}
