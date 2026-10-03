// 设置页「测试连接」的检查流程（纯逻辑；文字由界面层按结果翻译）

import { type Backend, BackendError } from './backend/types';
import { QUARTZ_CONFIG_PATH, readSiteConfig } from './generator/quartz';
import type { SiteConfigResult, YamlParser } from './generator/types';

export type ConnectionResult =
	/** 仓库不可访问：token 无效、无权限、仓库不存在等 */
	| { stage: 'repo'; error: BackendError }
	/** 仓库可访问但分支读取失败（通常是分支不存在） */
	| { stage: 'branch'; error: BackendError; defaultBranch: string }
	/** 连接成功；内容目录与站点配置的检查结果 */
	| { stage: 'done'; defaultBranch: string; contentDirExists: boolean; fileCount: number; config: SiteConfigResult };

/** 非 BackendError（如网络断开）原样抛出，由调用方提示 */
function asBackendError(e: unknown): BackendError {
	if (e instanceof BackendError) return e;
	throw e;
}

export async function testConnection(
	backend: Backend,
	contentDir: string,
	parseYaml: YamlParser,
): Promise<ConnectionResult> {
	let defaultBranch: string;
	try {
		defaultBranch = (await backend.getRepo()).defaultBranch;
	} catch (e) {
		return { stage: 'repo', error: asBackendError(e) };
	}

	let treeSha: string;
	try {
		treeSha = (await backend.getHead()).treeSha;
	} catch (e) {
		return { stage: 'branch', error: asBackendError(e), defaultBranch };
	}

	const files = await backend.getTree(treeSha);
	const prefix = contentDir ? `${contentDir}/` : '';
	const contentFiles = files.filter((f) => f.path.startsWith(prefix));
	const config = readSiteConfig(await backend.readText(QUARTZ_CONFIG_PATH), parseYaml);

	return {
		stage: 'done',
		defaultBranch,
		contentDirExists: contentDir === '' || contentFiles.length > 0,
		fileCount: contentFiles.length,
		config,
	};
}
