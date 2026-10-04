// 发布副本的内容转换（纯函数）：frontmatter 白名单、链接改写、附件链接、嵌入笔记展开
// 依据：需求 v1 §7；Phase 2 详细计划 2-2、Phase 3 详细计划 3-2；附件链接与 callout 写法见 phase0-findings.md

import { externalLink, formatLink } from '../generator/quartz';
import type { LinkStrategy } from '../generator/types';
import { type NoteRef, type ParsedNote, basename, isImage, isMarkdown, stem } from '../note';
import { type EmbedMap, MAX_EMBED_DEPTH, embedKey, refsInRange } from './embed';

export interface TransformContext {
	/** 本篇在站内的路径（相对内容目录） */
	sitePath: string;
	strategy: LinkStrategy;
	/** 保留的 frontmatter 属性 */
	whitelist: string[];
	stringifyYaml: (data: Record<string, unknown>) => string;
	/** 链接目标 → vault 路径；无法解析返回 undefined */
	resolve: (target: string, fromPath: string) => string | undefined;
	/** vault 路径是否在排除文件夹中 */
	excluded: (vaultPath: string) => boolean;
	/** vault 笔记在本站的站内路径；未在本站发布返回 undefined */
	publishedPath: (vaultPath: string) => string | undefined;
	/** 附件 vault 路径 → 站内路径（由附件分配步骤给出；未分配视为调用方错误） */
	attachmentPath: (vaultPath: string) => string | undefined;
	/** 预加载的嵌入内容（loadEmbeds）；缺省时嵌入笔记显示为纯文本 */
	embeds?: EmbedMap;
	/**
	 * 目标未在本站发布时，查询它在其他站点的页面网址（需求 §8）。隔离规则由调用方处理：
	 * 本站隔离时不提供本函数；其他隔离站点不参与查询。缺省或返回 undefined → 纯文本
	 */
	crossSiteUrl?: (vaultPath: string) => string | undefined;
	/**
	 * Pressroom 为旧网址写入的 aliases（挪动后重定向，需求 §11）。不受属性白名单限制；
	 * 笔记自带的 aliases 在白名单中时与之合并去重（笔记自带的在前）
	 */
	aliases?: string[];
}

/** 嵌入展开使用的 callout 类型（Quartz 内置，见 findings「Phase 3 callout 验证」） */
export const EMBED_CALLOUT = 'quote';

type RefKind =
	| { kind: 'note'; vaultPath: string }
	| { kind: 'attachment'; vaultPath: string }
	| { kind: 'unresolved' }
	| { kind: 'excluded' };

type ResolveCtx = Pick<TransformContext, 'resolve' | 'excluded'>;

function classify(ref: NoteRef, from: string, ctx: ResolveCtx): RefKind {
	// [[#标题]] 这类指向本篇的链接 target 为空
	const vaultPath = ref.target === '' ? from : ctx.resolve(ref.target, from);
	if (vaultPath === undefined) return { kind: 'unresolved' };
	if (ctx.excluded(vaultPath)) return { kind: 'excluded' };
	return isMarkdown(vaultPath) ? { kind: 'note', vaultPath } : { kind: 'attachment', vaultPath };
}

/**
 * 需要随本篇上传的附件（vault 路径，去重，按出现顺序），包括展开的嵌入内容中的附件；
 * 排除文件夹中的附件不上传
 */
export function collectAttachments(note: ParsedNote, ctx: ResolveCtx & { embeds?: EmbedMap }): string[] {
	const out: string[] = [];
	const walk = (source: ParsedNote, start: number, end: number, chain: string[]) => {
		for (const ref of refsInRange(source, start, end)) {
			const c = classify(ref, source.vaultPath, ctx);
			if (c.kind === 'attachment' && !out.includes(c.vaultPath)) out.push(c.vaultPath);
			if (c.kind === 'note' && ref.embed && !chain.includes(c.vaultPath) && chain.length < MAX_EMBED_DEPTH) {
				const src = ctx.embeds?.get(embedKey(c.vaultPath, ref.subpath));
				if (src) walk(src.note, src.start, src.end, [...chain, c.vaultPath]);
			}
		}
	};
	walk(note, 0, note.text.length, [note.vaultPath]);
	return out;
}

/** Obsidian 的图片尺寸写法 ![[图.png|300]] / |300x200，不是显示文字 */
const isSizeSpec = (s: string) => /^\d+(x\d+)?$/.test(s.trim());

/** 笔记标题：frontmatter title，否则文件名 */
function noteTitle(note: ParsedNote): string {
	const t = note.frontmatter?.data.title;
	return typeof t === 'string' && t.trim() !== '' ? t.trim() : stem(note.vaultPath);
}

/**
 * 嵌入所在行的续行前缀：callout 第 2 行起需要与第 1 行对齐。
 * 行首为空白 / 列表标记 → 用等宽空白；为引用块 > → 原样重复；其余（嵌入在一行文字中间）→ undefined（另起一行）
 */
function continuationPrefix(text: string, at: number): string | undefined {
	const lineStart = text.lastIndexOf('\n', at - 1) + 1;
	const prefix = text.slice(lineStart, at);
	if (/^(\s*>)+\s*$/.test(prefix)) return prefix;
	if (/^\s*([-*+]|\d+[.)])?\s*$/.test(prefix)) return ' '.repeat(prefix.length);
	return undefined;
}

function rewrite(ref: NoteRef, note: ParsedNote, ctx: TransformContext, chain: string[]): string {
	const c = classify(ref, note.vaultPath, ctx);
	// 空显示文字（如 ![](图.png)、[](笔记.md)）视为未写，退回链接目标
	const hasDisplay = ref.display.trim() !== '';
	const plain = hasDisplay ? ref.display : ref.target;
	switch (c.kind) {
		case 'unresolved':
		case 'excluded':
			return plain;
		case 'note': {
			if (ref.embed) return embed(ref, c.vaultPath, note, ctx, chain, hasDisplay);
			const to = c.vaultPath === note.vaultPath && chain.length === 1 ? ctx.sitePath : ctx.publishedPath(c.vaultPath);
			if (to !== undefined) return formatLink({ from: ctx.sitePath, to, anchor: ref.subpath, text: plain, strategy: ctx.strategy });
			// 本站未发布：查其他站点（优先本站，已在上面处理）
			const elsewhere = ctx.crossSiteUrl?.(c.vaultPath);
			return elsewhere === undefined ? plain : externalLink(elsewhere, plain, ref.subpath);
		}
		case 'attachment': {
			const to = ctx.attachmentPath(c.vaultPath);
			if (to === undefined) throw new Error(`附件 ${c.vaultPath} 未分配站内路径（应先调用附件分配）`);
			const custom = ref.customDisplay && hasDisplay && !isSizeSpec(ref.display);
			if (ref.embed && isImage(c.vaultPath)) {
				return `!${formatLink({ from: ctx.sitePath, to, text: custom ? ref.display : stem(c.vaultPath), strategy: ctx.strategy })}`;
			}
			// 非图片的嵌入（PDF 等）与普通附件链接一律输出为链接
			return formatLink({ from: ctx.sitePath, to, text: custom ? ref.display : basename(c.vaultPath), strategy: ctx.strategy });
		}
	}
}

/** 嵌入笔记展开为 callout；循环、超深、未加载时显示为纯文本 */
function embed(ref: NoteRef, target: string, host: ParsedNote, ctx: TransformContext, chain: string[], hasDisplay: boolean): string {
	const fallback = ref.customDisplay && hasDisplay ? ref.display : stem(target);
	const src = ctx.embeds?.get(embedKey(target, ref.subpath));
	if (!src || chain.includes(target) || chain.length > MAX_EMBED_DEPTH) return fallback;

	// 去掉被嵌入内容行尾的块标记 ^id：否则宿主页面会出现与原笔记重复的块 id（宿主自身的块 id 保留）
	const inner = render(src.note, src.start, src.end, ctx, [...chain, target])
		.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, '')
		.replace(/\s+$/, '');
	// 标题：用户写的显示文字；否则笔记标题（标题子路径时附上标题名）。被嵌入笔记在本站发布时标题链接到它
	let title = ref.customDisplay && hasDisplay ? ref.display : noteTitle(src.note);
	if (!(ref.customDisplay && hasDisplay) && ref.subpath && !ref.subpath.startsWith('^')) title += ` > ${ref.subpath}`;
	const publishedAt = ctx.publishedPath(target);
	const titleText =
		publishedAt === undefined
			? title
			: formatLink({ from: ctx.sitePath, to: publishedAt, anchor: ref.subpath, text: title, strategy: ctx.strategy });

	const lines = [`> [!${EMBED_CALLOUT}] ${titleText}`, ...inner.split('\n').map((l) => (l === '' ? '>' : `> ${l}`))];
	const cont = continuationPrefix(host.text, ref.start);
	if (cont === undefined) {
		// 嵌入夹在一行文字中间：callout 必须从行首开始，前后各断开一行
		return `\n${lines.join('\n')}\n`;
	}
	return lines.map((l, i) => (i === 0 ? l : cont + l)).join('\n');
}

/** 输出 note.text 的 [start, end) 区间（只替换落在区间内、位于正文中的引用） */
function render(note: ParsedNote, start: number, end: number, ctx: TransformContext, chain: string[]): string {
	const from = Math.max(start, note.frontmatter?.bodyStart ?? 0);
	let out = '';
	let pos = from;
	for (const ref of refsInRange(note, from, end)) {
		if (ref.start < pos) throw new Error(`笔记 ${note.vaultPath} 的引用位置重叠：${ref.start} < ${pos}`);
		out += note.text.slice(pos, ref.start) + rewrite(ref, note, ctx, chain);
		pos = ref.end;
	}
	return out + note.text.slice(pos, end);
}

/** frontmatter 只保留白名单属性（按原顺序），再加上 Pressroom 的 aliases；无剩余属性时去掉整个 frontmatter */
function frontmatterBlock(note: ParsedNote, ctx: TransformContext): string {
	const data = note.frontmatter?.data ?? {};
	const kept: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (ctx.whitelist.includes(key)) kept[key] = value;
	}
	if (ctx.aliases?.length) {
		const own = kept.aliases;
		// 笔记自带的 aliases 可能是字符串或列表
		const ownList = Array.isArray(own) ? own.map(String) : typeof own === 'string' && own !== '' ? [own] : [];
		kept.aliases = [...new Set([...ownList, ...ctx.aliases])];
	}
	if (Object.keys(kept).length === 0) return '';
	const yaml = ctx.stringifyYaml(kept);
	return `---\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}---\n`;
}

/** 生成发布副本的正文。同一输入多次调用结果逐字节相同 */
export function transformNote(note: ParsedNote, ctx: TransformContext): string {
	return frontmatterBlock(note, ctx) + render(note, 0, note.text.length, ctx, [note.vaultPath]);
}
