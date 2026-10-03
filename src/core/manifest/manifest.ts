// 站点 manifest：每个站点仓库内 .pressroom/manifest.json，仓库即唯一真相源（需求 §9）

import type { Backend, Change } from '../backend/types';
import type { DirMode } from '../types';

export const MANIFEST_PATH = '.pressroom/manifest.json';
export const MANIFEST_VERSION = 1;

export interface NoteRecord {
	/** vault 内路径 */
	vaultPath: string;
	/** 站内路径：相对内容目录，含文件名与扩展名 */
	sitePath: string;
	/** 最近一次发布内容的 git blob SHA（「有修改」判定的基准） */
	blobSha: string;
	/** 最近一次发布时间，ISO 8601 */
	publishedAt: string;
	/** 本篇引用的附件站内路径（附件与文章的引用关系只在此处记录） */
	attachments: string[];
	/** Pressroom 为旧网址写入的 aliases（挪动后重定向） */
	aliases: string[];
}

export interface AttachmentRecord {
	/** 站内路径：相对内容目录，如 assets/图 1.png */
	sitePath: string;
	/** 内容的 git blob SHA（按内容判断是否同一文件） */
	blobSha: string;
}

export interface ManifestV1 {
	version: 1;
	mode: DirMode;
	notes: NoteRecord[];
	attachments: AttachmentRecord[];
}

export type ManifestErrorKind = 'syntax' | 'invalid' | 'tooNew';

export class ManifestError extends Error {
	constructor(
		readonly kind: ManifestErrorKind,
		message: string,
	) {
		super(message);
		this.name = 'ManifestError';
	}
}

export function emptyManifest(mode: DirMode): ManifestV1 {
	return { version: 1, mode, notes: [], attachments: [] };
}

type Obj = Record<string, unknown>;
const SHA_RE = /^[0-9a-f]{40}$/;

/** 站内 / vault 相对路径：非空、无前导斜杠、无反斜杠、无 . 或 .. 段 */
function isRelPath(v: unknown): v is string {
	return (
		typeof v === 'string' &&
		v !== '' &&
		!v.startsWith('/') &&
		!v.includes('\\') &&
		!v.split('/').some((s) => s === '' || s === '.' || s === '..')
	);
}

class Validator {
	fail(path: string, expected: string, actual: unknown): never {
		throw new ManifestError('invalid', `manifest 字段 ${path} 应为${expected}，实际为 ${JSON.stringify(actual)}`);
	}
	obj(v: unknown, path: string): Obj {
		if (typeof v !== 'object' || v === null || Array.isArray(v)) this.fail(path, '对象', v);
		return v as Obj;
	}
	arr(v: unknown, path: string): unknown[] {
		if (!Array.isArray(v)) this.fail(path, '数组', v);
		return v;
	}
	relPath(v: unknown, path: string): string {
		if (!isRelPath(v)) this.fail(path, '相对路径（非空、无前导斜杠、无 . 与 ..）', v);
		return v;
	}
	sha(v: unknown, path: string): string {
		if (typeof v !== 'string' || !SHA_RE.test(v)) this.fail(path, '40 位小写十六进制 SHA', v);
		return v;
	}
	date(v: unknown, path: string): string {
		if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) this.fail(path, 'ISO 8601 时间', v);
		return v;
	}
	unique(values: string[], path: string, what: string): void {
		const seen = new Set<string>();
		for (const v of values) {
			if (seen.has(v)) throw new ManifestError('invalid', `manifest ${path} 中${what}重复：${v}`);
			seen.add(v);
		}
	}
}

/** 解析并校验 manifest；格式错误、结构不符、版本高于本插件支持时抛 ManifestError */
export function parseManifest(text: string): ManifestV1 {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		throw new ManifestError('syntax', `manifest 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
	}
	// 显式标注类型，TypeScript 才会按 fail(): never 收窄后续变量
	const v: Validator = new Validator();
	const root = v.obj(raw, '(根)');
	if (typeof root.version !== 'number' || !Number.isInteger(root.version) || root.version < 1) {
		v.fail('version', '正整数', root.version);
	}
	if (root.version > MANIFEST_VERSION) {
		// 新版本的结构本插件不认识，读写都可能出错
		throw new ManifestError(
			'tooNew',
			`manifest 版本为 ${root.version}，本插件只支持到 ${MANIFEST_VERSION}，请升级 Pressroom`,
		);
	}
	if (root.mode !== 'manual' && root.mode !== 'follow') v.fail('mode', '"manual" 或 "follow"', root.mode);

	const attachments = v.arr(root.attachments, 'attachments').map((a, i) => {
		const p = `attachments[${i}]`;
		const o = v.obj(a, p);
		return { sitePath: v.relPath(o.sitePath, `${p}.sitePath`), blobSha: v.sha(o.blobSha, `${p}.blobSha`) };
	});
	v.unique(attachments.map((a) => a.sitePath), 'attachments', '站内路径');
	const known = new Set(attachments.map((a) => a.sitePath));

	const notes = v.arr(root.notes, 'notes').map((n, i): NoteRecord => {
		const p = `notes[${i}]`;
		const o = v.obj(n, p);
		const noteAttachments = v.arr(o.attachments, `${p}.attachments`).map((s, j) => {
			const path = v.relPath(s, `${p}.attachments[${j}]`);
			if (!known.has(path)) {
				throw new ManifestError('invalid', `manifest ${p}.attachments[${j}] 引用的附件 ${path} 不在 attachments 中`);
			}
			return path;
		});
		return {
			vaultPath: v.relPath(o.vaultPath, `${p}.vaultPath`),
			sitePath: v.relPath(o.sitePath, `${p}.sitePath`),
			blobSha: v.sha(o.blobSha, `${p}.blobSha`),
			publishedAt: v.date(o.publishedAt, `${p}.publishedAt`),
			attachments: noteAttachments,
			aliases: v.arr(o.aliases, `${p}.aliases`).map((s, j) => {
				if (typeof s !== 'string' || s === '') v.fail(`${p}.aliases[${j}]`, '非空字符串', s);
				return s;
			}),
		};
	});
	v.unique(notes.map((n) => n.sitePath), 'notes', '站内路径');
	v.unique(notes.map((n) => n.vaultPath), 'notes', 'vault 路径');

	return { version: 1, mode: root.mode, notes, attachments };
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (xs: string[]) => [...new Set(xs)].sort(byCodePoint);

/**
 * 稳定序列化：固定键顺序、列表按站内路径排序、两空格缩进、末尾换行。
 * 内容相同则输出逐字节相同，blob SHA 不变（避免无实际变化的提交）。
 */
export function serializeManifest(m: ManifestV1): string {
	const out = {
		version: m.version,
		mode: m.mode,
		notes: [...m.notes]
			.sort((a, b) => byCodePoint(a.sitePath, b.sitePath))
			.map((n) => ({
				vaultPath: n.vaultPath,
				sitePath: n.sitePath,
				blobSha: n.blobSha,
				publishedAt: n.publishedAt,
				attachments: sorted(n.attachments),
				aliases: sorted(n.aliases),
			})),
		attachments: [...m.attachments]
			.sort((a, b) => byCodePoint(a.sitePath, b.sitePath))
			.map((a) => ({ sitePath: a.sitePath, blobSha: a.blobSha })),
	};
	return `${JSON.stringify(out, null, 2)}\n`;
}

/** 引用某附件的笔记站内路径 */
export function attachmentRefs(m: ManifestV1, attachmentPath: string): string[] {
	return m.notes.filter((n) => n.attachments.includes(attachmentPath)).map((n) => n.sitePath);
}

/** 从仓库读取 manifest；文件不存在（站点尚未由 Pressroom 发布过）时返回空 manifest */
export async function loadManifest(backend: Backend, defaultMode: DirMode): Promise<ManifestV1> {
	const text = await backend.readText(MANIFEST_PATH);
	return text === undefined ? emptyManifest(defaultMode) : parseManifest(text);
}

/** 生成写回 manifest 的改动；与内容改动放进同一次提交，不单独提交 */
export function manifestChange(m: ManifestV1): Change {
	return { path: MANIFEST_PATH, content: serializeManifest(m) };
}
