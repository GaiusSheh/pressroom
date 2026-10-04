// 附件站内路径分配（需求 v1 §7）：统一放在内容目录下 assets/，保留原文件名；
// 按内容 SHA 判断是否同一文件（同内容只存一份），按 slug 判断是否同名（同名不同内容加后缀）

import type { TreeEntry } from './backend/types';
import { slugOf } from './generator/quartz';
import type { AttachmentRecord, ManifestV1 } from './manifest/manifest';
import { basename } from './note';

export const ASSETS_DIR = 'assets';

export interface AttachmentInput {
	vaultPath: string;
	/** 内容的 git blob SHA */
	sha: string;
}

export interface Allocation {
	/** vault 路径 → 站内路径（相对内容目录） */
	paths: Map<string, string>;
	/** 需要上传的新文件（站内路径 → 对应的 vault 路径） */
	uploads: { sitePath: string; vaultPath: string }[];
	/** 需要登记到 manifest 的附件记录（新上传的，以及站上已有但 manifest 未登记的同内容文件） */
	newRecords: AttachmentRecord[];
}

/** name.ext → name-n.ext；无扩展名时 name-n */
function withSuffix(fileName: string, n: number): string {
	const dot = fileName.lastIndexOf('.');
	return dot > 0 ? `${fileName.slice(0, dot)}-${n}${fileName.slice(dot)}` : `${fileName}-${n}`;
}

/**
 * @param siteFiles 站点内容目录中的全部文件（路径相对内容目录），含非 Pressroom 管理的文件
 */
export function allocateAttachments(inputs: AttachmentInput[], manifest: ManifestV1, siteFiles: TreeEntry[]): Allocation {
	const paths = new Map<string, string>();
	const uploads: Allocation['uploads'] = [];
	const newRecords: AttachmentRecord[] = [];

	// 按 SHA 查找可复用的文件：manifest 登记的附件优先，其次是 assets/ 下已存在的文件
	const bySha = new Map<string, string>();
	for (const f of siteFiles) {
		if (f.path.startsWith(`${ASSETS_DIR}/`) && !bySha.has(f.sha)) bySha.set(f.sha, f.path);
	}
	for (const a of manifest.attachments) bySha.set(a.blobSha, a.sitePath);
	const recorded = new Set(manifest.attachments.map((a) => a.sitePath));

	// 已占用的 slug：站点全部文件 + 本批新分配
	const taken = new Set(siteFiles.map((f) => slugOf(f.path)));

	for (const input of inputs) {
		if (paths.has(input.vaultPath)) continue;
		const reuse = bySha.get(input.sha);
		if (reuse !== undefined) {
			paths.set(input.vaultPath, reuse);
			if (!recorded.has(reuse)) {
				newRecords.push({ sitePath: reuse, blobSha: input.sha });
				recorded.add(reuse);
			}
			continue;
		}
		const name = basename(input.vaultPath);
		let candidate = `${ASSETS_DIR}/${name}`;
		for (let n = 2; taken.has(slugOf(candidate)); n++) {
			candidate = `${ASSETS_DIR}/${withSuffix(name, n)}`;
		}
		taken.add(slugOf(candidate));
		bySha.set(input.sha, candidate);
		recorded.add(candidate);
		paths.set(input.vaultPath, candidate);
		uploads.push({ sitePath: candidate, vaultPath: input.vaultPath });
		newRecords.push({ sitePath: candidate, blobSha: input.sha });
	}
	return { paths, uploads, newRecords };
}
