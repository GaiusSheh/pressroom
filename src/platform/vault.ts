import { type App, type CachedMetadata, TFile, getFrontMatterInfo, parseLinktext, parseYaml } from 'obsidian';
import type { NoteRef, ParsedNote, VaultAccess } from '../core/note';

/** 用 metadataCache 构造 ParsedNote。缓存与正文不一致（索引尚未更新）时等待一次 changed 事件后重试 */
export async function parseNote(app: App, file: TFile): Promise<ParsedNote> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const text = await app.vault.read(file);
		const cache = app.metadataCache.getFileCache(file);
		const parsed = cache ? tryBuild(file.path, text, cache) : undefined;
		if (parsed) return parsed;
		await waitForIndex(app, file);
	}
	throw new Error(`笔记 ${file.path} 的索引尚未更新（metadataCache 与正文不一致），请稍后重试`);
}

/** 缓存中每条链接在正文对应位置的原文必须一致，否则返回 undefined（缓存过期） */
function tryBuild(vaultPath: string, text: string, cache: CachedMetadata): ParsedNote | undefined {
	const refs: NoteRef[] = [];
	const items = [
		...(cache.links ?? []).map((l) => ({ item: l, embed: false })),
		...(cache.embeds ?? []).map((e) => ({ item: e, embed: true })),
	];
	for (const { item, embed } of items) {
		const { start, end } = item.position;
		if (text.slice(start.offset, end.offset) !== item.original) return undefined;
		// 外部链接不处理（metadataCache 通常不收录，这里防御）
		if (/^[a-z][a-z0-9+.-]*:/i.test(item.link)) continue;
		const { path, subpath } = parseLinktext(item.link);
		const display = item.displayText ?? item.link;
		refs.push({
			start: start.offset,
			end: end.offset,
			embed,
			target: path,
			subpath: subpath ? subpath.replace(/^#/, '') : undefined,
			display,
			customDisplay: display !== item.link,
		});
	}
	refs.sort((a, b) => a.start - b.start);

	const info = getFrontMatterInfo(text);
	let frontmatter: ParsedNote['frontmatter'];
	if (info.exists) {
		const data: unknown = cache.frontmatter ?? parseYaml(info.frontmatter);
		// contentStart 可能停在结束 --- 之后的换行符前，跳过它，正文从下一行开始
		const c = info.contentStart;
		const bodyStart = text.startsWith('\r\n', c) ? c + 2 : text.startsWith('\n', c) ? c + 1 : c;
		frontmatter = {
			data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {},
			bodyStart,
		};
	}
	return { vaultPath, text, frontmatter, refs };
}

function waitForIndex(app: App, file: TFile, timeoutMs = 3000): Promise<void> {
	return new Promise((resolve) => {
		const timer = window.setTimeout(done, timeoutMs);
		const ref = app.metadataCache.on('changed', (changed) => {
			if (changed.path === file.path) done();
		});
		function done() {
			window.clearTimeout(timer);
			app.metadataCache.offref(ref);
			resolve();
		}
	});
}

export function obsidianVault(app: App): VaultAccess {
	return {
		resolve: (target, fromPath) => app.metadataCache.getFirstLinkpathDest(target, fromPath)?.path,
		readBinary: async (path) => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`附件不存在：${path}`);
			return new Uint8Array(await app.vault.readBinary(file));
		},
	};
}
