// Quartz configuration.ignorePatterns 匹配（Quartz 用 globby 以内容目录为根扫描，ignore 为 glob 模式）
// 路径本身或其任一上级目录命中模式即视为被忽略（被忽略的目录不会被遍历）

function globToRegExp(pattern: string): RegExp {
	let re = '';
	const p = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
	for (let i = 0; i < p.length; i++) {
		const ch = p[i]!;
		if (ch === '*') {
			if (p[i + 1] === '*') {
				re += '.*';
				i++;
				if (p[i + 1] === '/') i++; // **/ 也匹配零层目录
			} else {
				re += '[^/]*';
			}
		} else if (ch === '?') {
			re += '[^/]';
		} else {
			re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`);
}

/** 返回第一个命中的模式；未命中返回 undefined。path 为相对内容目录的路径 */
export function matchIgnorePattern(path: string, patterns: string[]): string | undefined {
	const segments = path.split('/');
	const candidates = segments.map((_, i) => segments.slice(0, i + 1).join('/'));
	for (const pattern of patterns) {
		const re = globToRegExp(pattern);
		if (candidates.some((c) => re.test(c))) return pattern;
	}
	return undefined;
}
