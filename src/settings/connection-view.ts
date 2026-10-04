// 把「测试连接」结果翻译为界面文字（不依赖 obsidian，可单元测试）

import type { ConnectionResult } from '../core/connection';
import type { BackendError } from '../core/backend/types';
import type { SiteConfig } from '../core/types';
import { t } from '../i18n';

/** info：中性说明（既不是检查通过也不是问题，如「写入权限无法检查」） */
export type Level = 'ok' | 'info' | 'warn' | 'error';
export interface Line {
	level: Level;
	text: string;
}

function backendLine(error: BackendError, site: SiteConfig): Line {
	switch (error.kind) {
		case 'auth':
			return { level: 'error', text: t('conn.auth') };
		case 'notFound':
			return { level: 'error', text: t('conn.repoNotFound', { repo: site.repo }) };
		case 'forbidden':
			return { level: 'error', text: t('conn.forbidden', { repo: site.repo }) };
		case 'rateLimit':
			return { level: 'error', text: t('conn.rateLimit') };
		default:
			return { level: 'error', text: t('conn.failed', { message: error.message }) };
	}
}

/** 站点网址与 Quartz baseUrl 是否指向同一处（baseUrl 不含协议） */
function sameSite(siteUrl: string, baseUrl: string): boolean {
	const strip = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
	return strip(siteUrl) === strip(baseUrl);
}

export function describeConnection(result: ConnectionResult, site: SiteConfig): Line[] {
	if (result.stage === 'repo') return [backendLine(result.error, site)];
	if (result.stage === 'branch') {
		return result.error.kind === 'notFound'
			? [{ level: 'error', text: t('conn.branchNotFound', { branch: site.branch, defaultBranch: result.defaultBranch }) }]
			: [backendLine(result.error, site)];
	}

	const lines: Line[] = [{ level: 'ok', text: t('conn.ok', { repo: site.repo, branch: site.branch }) }];
	const dir = site.contentDir || t('conn.repoRoot');
	lines.push(
		result.contentDirExists
			? { level: 'ok', text: t('conn.contentDir', { dir, count: result.fileCount }) }
			: { level: 'warn', text: t('conn.contentDirMissing', { dir }) },
	);

	const { config } = result;
	if (!config.ok) {
		lines.push(
			config.reason === 'missing'
				? { level: 'warn', text: t('conn.configMissing') }
				: { level: 'warn', text: t('conn.configInvalid', { detail: config.detail }) },
		);
	} else {
		const { info } = config;
		lines.push({
			level: 'ok',
			text: t(info.linkStrategyDefaulted ? 'conn.strategyDefault' : 'conn.strategy', { strategy: info.linkStrategy }),
		});
		lines.push(
			info.aliasRedirects
				? { level: 'ok', text: t('conn.aliasOn') }
				: { level: 'warn', text: t('conn.aliasOff') },
		);
		if (info.baseUrl && site.siteUrl && !sameSite(site.siteUrl, info.baseUrl)) {
			lines.push({ level: 'warn', text: t('conn.baseUrlMismatch', { baseUrl: info.baseUrl, siteUrl: site.siteUrl }) });
		}
	}
	// 只读检查无法验证写权限（fine-grained token 的权限不在响应中体现）
	lines.push({ level: 'info', text: t('conn.writeNote') });
	return lines;
}
