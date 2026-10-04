// 把发布过程中的各类错误翻译为界面文字（不依赖 obsidian，可单元测试）

import { BackendError } from '../core/backend/types';
import { ManifestError } from '../core/manifest/manifest';
import { PublishConflictError } from '../core/publish';
import { t } from '../i18n';

export function describeError(e: unknown, repo: string): string {
	if (e instanceof PublishConflictError) {
		const others = e.conflicts.map((c) => (c.owner.kind === 'file' ? c.owner.path : c.owner.alias)).join('、');
		return t('error.conflict', { path: e.sitePath, other: others });
	}
	if (e instanceof BackendError) {
		switch (e.kind) {
			case 'auth':
				return t('conn.auth');
			case 'notFound':
				return t('conn.repoNotFound', { repo });
			case 'forbidden':
				return t('conn.forbidden', { repo });
			case 'rateLimit':
				return t('conn.rateLimit');
			case 'conflict':
				return t('error.branchBusy');
			default:
				return t('conn.failed', { message: e.message });
		}
	}
	if (e instanceof ManifestError) {
		return e.kind === 'tooNew' ? t('error.manifestTooNew') : t('error.manifestInvalid', { message: e.message });
	}
	return t('error.generic', { message: e instanceof Error ? e.message : String(e) });
}
