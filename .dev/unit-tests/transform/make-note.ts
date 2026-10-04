// 测试辅助：用简化的正则从文本构造 ParsedNote（真实插件中由 Obsidian metadataCache 提供）
// 只识别 [[...]]、![[...]]、[..](..)、![..](..)；不识别代码块——需要测试代码块时手工构造 refs
import { parse } from 'yaml';
import type { NoteRef, ParsedNote } from '../../../src/core/note';

const RE = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(!?)\[([^\]]*)\]\(<?([^)>]+)>?\)/g;

export function makeNote(vaultPath: string, text: string): ParsedNote {
	let frontmatter: ParsedNote['frontmatter'];
	let searchFrom = 0;
	const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
	if (fm) {
		frontmatter = { data: (parse(fm[1]!) as Record<string, unknown>) ?? {}, bodyStart: fm[0].length };
		searchFrom = fm[0].length;
	}
	const refs: NoteRef[] = [];
	RE.lastIndex = searchFrom;
	for (let m = RE.exec(text); m; m = RE.exec(text)) {
		const wiki = m[2] !== undefined;
		const link = decodeURI(wiki ? m[2]! : m[6]!);
		const hash = link.indexOf('#');
		const target = hash >= 0 ? link.slice(0, hash) : link;
		const subpath = hash >= 0 ? link.slice(hash + 1) : undefined;
		const alias = wiki ? m[3] : m[5];
		const display = alias ?? link;
		refs.push({
			start: m.index,
			end: m.index + m[0].length,
			embed: (wiki ? m[1] : m[4]) === '!',
			target: wiki ? target : target.replace(/\.md$/, ''),
			subpath,
			display,
			customDisplay: alias !== undefined && alias !== link,
		});
	}
	return { vaultPath, text, frontmatter, refs };
}
