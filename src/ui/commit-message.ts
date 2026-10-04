// 提交信息（不依赖 obsidian，可单元测试）。只含站内路径，不含 vault 路径（需求 §8）

import type { BatchSummary } from '../core/publish';
import { t } from '../i18n';

export function commitMessage(s: BatchSummary): string {
	const total = s.published.length + s.updated.length + s.unpublished.length;
	// 只涉及一篇：沿用 Phase 2 的单篇格式
	if (total === 1) {
		if (s.published.length) return t('commit.published', { path: s.published[0]! });
		if (s.updated.length) return t('commit.updated', { path: s.updated[0]! });
		return t('commit.unpublished', { path: s.unpublished[0]! });
	}
	const sep = t('common.listSep');
	const parts: string[] = [];
	if (s.published.length) parts.push(t('commit.part.published', { paths: s.published.join(sep) }));
	if (s.updated.length) parts.push(t('commit.part.updated', { paths: s.updated.join(sep) }));
	if (s.unpublished.length) parts.push(t('commit.part.unpublished', { paths: s.unpublished.join(sep) }));
	return t('commit.many', { parts: parts.join(t('commit.part.sep')) });
}
