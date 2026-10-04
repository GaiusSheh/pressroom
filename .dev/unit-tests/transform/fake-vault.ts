// 测试辅助：内存版 VaultAccess。笔记文本由调用方持有（可在测试中修改后重新读取）
// loadEmbed 的范围规则模拟 Obsidian resolveSubpath：
//   #标题 → 从标题行到下一个同级或更高级标题之前；#^块 → 含 ^id 的段落（前后以空行为界）
import type { EmbedSource, VaultAccess } from '../../../src/core/note';
import { makeNote } from './make-note';

export function fakeVault(notes: Record<string, string>, binaries: Record<string, Uint8Array> = {}) {
	const all = () => [...Object.keys(notes), ...Object.keys(binaries)];
	const note = (p: string) => {
		const text = notes[p];
		if (text === undefined) throw new Error(`fake vault: 没有笔记 ${p}`);
		return makeNote(p, text);
	};
	const vault: VaultAccess = {
		resolve: (target) =>
			all().find((f) => f === target || f === `${target}.md` || f.endsWith(`/${target}`) || f.endsWith(`/${target}.md`)),
		readBinary: async (p) => {
			const b = binaries[p];
			if (!b) throw new Error(`fake vault: 没有附件 ${p}`);
			return b;
		},
		loadEmbed: async (p, subpath): Promise<EmbedSource | undefined> => {
			if (notes[p] === undefined) return undefined;
			const n = note(p);
			const text = n.text;
			if (!subpath) return { note: n, start: n.frontmatter?.bodyStart ?? 0, end: text.length };
			if (subpath.startsWith('^')) {
				const at = text.indexOf(` ${subpath}`);
				if (at < 0) return undefined;
				const start = text.lastIndexOf('\n\n', at) + 2 || 0;
				const endBlank = text.indexOf('\n\n', at);
				return { note: n, start: start === 1 ? 0 : start, end: endBlank < 0 ? text.length : endBlank };
			}
			const headings = [...text.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((m) => ({ level: m[1]!.length, title: m[2]!, at: m.index }));
			const i = headings.findIndex((h) => h.title === subpath);
			if (i < 0) return undefined;
			const h = headings[i]!;
			const next = headings.slice(i + 1).find((x) => x.level <= h.level);
			return { note: n, start: h.at, end: next ? next.at : text.length };
		},
	};
	return { vault, note };
}
