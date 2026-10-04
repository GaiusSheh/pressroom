// 笔记解析结果与 vault 访问接口。链接 / 嵌入的位置由平台层从 Obsidian metadataCache 取得，
// core 只按位置替换文本，不自己解析 Markdown（避免误改代码块中的 [[...]]）

/** 正文中的一处链接或嵌入 */
export interface NoteRef {
	/** 在 text 中的起止偏移（覆盖整段链接语法，如 [[a|b]]） */
	start: number;
	end: number;
	/** 是否为嵌入（![[...]] 或 ![](...)） */
	embed: boolean;
	/** 链接目标（不含 #子路径），如 笔记/示例 或 图 1.png */
	target: string;
	/** # 之后的标题或 ^块 id，不含 # */
	subpath?: string;
	/** Obsidian 显示的文字（有别名时为别名，否则为链接原文） */
	display: string;
	/** 用户是否显式写了显示文字（[[a|b]] 或 [b](a)） */
	customDisplay: boolean;
}

export interface ParsedNote {
	vaultPath: string;
	text: string;
	/** frontmatter：data 为解析后的对象，bodyStart 为正文开始的偏移（frontmatter 结束 --- 之后） */
	frontmatter?: { data: Record<string, unknown>; bodyStart: number };
	/** 按 start 升序，互不重叠 */
	refs: NoteRef[];
}

/** 被嵌入的内容：整篇笔记 + 要展开的正文范围（[start, end)） */
export interface EmbedSource {
	note: ParsedNote;
	start: number;
	end: number;
}

/** core 需要的 vault 能力，由平台层实现 */
export interface VaultAccess {
	/** 解析链接目标为 vault 文件路径；无法解析返回 undefined */
	resolve(target: string, fromPath: string): string | undefined;
	readBinary(path: string): Promise<Uint8Array>;
	/**
	 * 读取被嵌入的笔记与要展开的范围：无 subpath 为整篇正文（不含 frontmatter），
	 * subpath 为标题或 ^块 id（不含 #）时为对应段落；笔记或子路径不存在返回 undefined
	 */
	loadEmbed(vaultPath: string, subpath?: string): Promise<EmbedSource | undefined>;
}

/** 路径是否位于排除文件夹内（文件夹本身或其子路径；Private2/ 不算 Private/） */
export function isExcluded(vaultPath: string, folders: string[]): boolean {
	return folders.some((f) => vaultPath === f || vaultPath.startsWith(`${f}/`));
}

export function isMarkdown(path: string): boolean {
	return path.toLowerCase().endsWith('.md');
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

export function isImage(path: string): boolean {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return path.includes('.') && IMAGE_EXT.includes(ext);
}

/** 文件名（含扩展名） */
export function basename(path: string): string {
	return path.split('/').pop() ?? path;
}

/** 文件名（不含扩展名） */
export function stem(path: string): string {
	const name = basename(path);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}
