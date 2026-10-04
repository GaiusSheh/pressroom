// 发布副本的内容转换（纯函数）：frontmatter 白名单、链接改写、附件链接
// 依据：需求 v1 §7；Phase 2 详细计划 2-2；附件链接格式见 phase0-findings.md「Phase 2 附件链接验证」

import { formatLink } from '../generator/quartz';
import type { LinkStrategy } from '../generator/types';
import { type NoteRef, type ParsedNote, basename, isImage, isMarkdown, stem } from '../note';

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
}

type RefKind =
	| { kind: 'note'; vaultPath: string }
	| { kind: 'attachment'; vaultPath: string }
	| { kind: 'unresolved' }
	| { kind: 'excluded' };

function classify(ref: NoteRef, from: string, ctx: Pick<TransformContext, 'resolve' | 'excluded'>): RefKind {
	// [[#标题]] 这类指向本篇的链接 target 为空
	const vaultPath = ref.target === '' ? from : ctx.resolve(ref.target, from);
	if (vaultPath === undefined) return { kind: 'unresolved' };
	if (ctx.excluded(vaultPath)) return { kind: 'excluded' };
	return isMarkdown(vaultPath) ? { kind: 'note', vaultPath } : { kind: 'attachment', vaultPath };
}

/** 需要随本篇上传的附件（vault 路径，去重，按出现顺序）；排除文件夹中的附件不上传 */
export function collectAttachments(note: ParsedNote, ctx: Pick<TransformContext, 'resolve' | 'excluded'>): string[] {
	const out: string[] = [];
	for (const ref of note.refs) {
		const c = classify(ref, note.vaultPath, ctx);
		if (c.kind === 'attachment' && !out.includes(c.vaultPath)) out.push(c.vaultPath);
	}
	return out;
}

/** Obsidian 的图片尺寸写法 ![[图.png|300]] / |300x200，不是显示文字 */
const isSizeSpec = (s: string) => /^\d+(x\d+)?$/.test(s.trim());

function rewrite(ref: NoteRef, note: ParsedNote, ctx: TransformContext): string {
	const c = classify(ref, note.vaultPath, ctx);
	// 空显示文字（如 ![](图.png)、[](笔记.md)）视为未写，退回链接目标
	const hasDisplay = ref.display.trim() !== '';
	const plain = hasDisplay ? ref.display : ref.target;
	switch (c.kind) {
		case 'unresolved':
		case 'excluded':
			return plain;
		case 'note': {
			// 嵌入笔记 Phase 2 临时变为纯文本（Phase 3 改为展开）
			if (ref.embed) return ref.customDisplay && hasDisplay ? plain : stem(c.vaultPath);
			const to = c.vaultPath === note.vaultPath ? ctx.sitePath : ctx.publishedPath(c.vaultPath);
			if (to === undefined) return plain;
			return formatLink({ from: ctx.sitePath, to, anchor: ref.subpath, text: plain, strategy: ctx.strategy });
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

/** frontmatter 只保留白名单属性（按原顺序）；无剩余属性时去掉整个 frontmatter */
function frontmatterBlock(note: ParsedNote, ctx: TransformContext): string {
	const data = note.frontmatter?.data;
	if (!data) return '';
	const kept: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (ctx.whitelist.includes(key)) kept[key] = value;
	}
	if (Object.keys(kept).length === 0) return '';
	const yaml = ctx.stringifyYaml(kept);
	return `---\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}---\n`;
}

/** 生成发布副本的正文。同一输入多次调用结果逐字节相同 */
export function transformNote(note: ParsedNote, ctx: TransformContext): string {
	const bodyStart = note.frontmatter?.bodyStart ?? 0;
	let out = '';
	let pos = bodyStart;
	for (const ref of note.refs) {
		if (ref.start < bodyStart) continue; // frontmatter 内的引用不处理（属性按白名单整体保留或去除）
		if (ref.start < pos) throw new Error(`笔记 ${note.vaultPath} 的引用位置重叠：${ref.start} < ${pos}`);
		out += note.text.slice(pos, ref.start) + rewrite(ref, note, ctx);
		pos = ref.end;
	}
	out += note.text.slice(pos);
	return frontmatterBlock(note, ctx) + out;
}
