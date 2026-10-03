// 存储后端接口。v1 只有 GitHub 实现；HTTP 由平台层注入（Obsidian 中为 requestUrl）

export interface HttpRequest {
	method: 'GET' | 'POST' | 'PATCH';
	url: string;
	headers: Record<string, string>;
	body?: string;
}

export interface HttpResponse {
	status: number;
	/** 响应头，键为小写 */
	headers: Record<string, string>;
	/** 响应体按 JSON 解析的结果；不是 JSON 时为 undefined */
	json: unknown;
}

/** 网络失败（无响应）时应抛错；有响应时无论状态码都返回 */
export type HttpFn = (request: HttpRequest) => Promise<HttpResponse>;

export interface Head {
	commitSha: string;
	treeSha: string;
}

export interface TreeEntry {
	path: string;
	sha: string;
	/** 字节数 */
	size: number;
}

/** 一次提交中的单项改动 */
export type Change =
	| { path: string; content: string | Uint8Array }
	/** 挪动 / 复用：新路径直接指向已有 blob，不重新上传 */
	| { path: string; reuseSha: string }
	| { path: string; delete: true };

export interface CommitResult {
	commitSha: string;
	/** 实际尝试次数（1 = 一次成功） */
	attempts: number;
}

export interface Backend {
	/** 仓库本身是否可访问（用于区分「仓库不存在 / 无权」与「分支不存在」） */
	getRepo(): Promise<{ defaultBranch: string; private: boolean }>;
	/** 分支当前的 commit 与 tree */
	getHead(): Promise<Head>;
	/** 整棵树中的全部文件（recursive） */
	getTree(treeSha: string): Promise<TreeEntry[]>;
	/** 读文本文件；不存在返回 undefined */
	readText(path: string): Promise<string | undefined>;
	readBlob(sha: string): Promise<Uint8Array>;
	/**
	 * 一次提交。build 根据当前 head 生成改动；分支在此期间被别处更新（非 fast-forward）时，
	 * 重新取 head、再次调用 build，有上限地重试。build 返回空数组时不提交并返回 undefined。
	 */
	commit(message: string, build: (head: Head) => Change[] | Promise<Change[]>): Promise<CommitResult | undefined>;
}

export type BackendErrorKind =
	| 'auth' // 401：token 无效或过期
	| 'forbidden' // 403：token 无权限
	| 'rateLimit' // 403/429 且额度用尽
	| 'notFound' // 404：仓库 / 分支 / 文件不存在，或 token 看不到该仓库
	| 'conflict' // 非 fast-forward 重试用尽
	| 'invalid' // 422 等请求被拒
	| 'server' // 5xx
	| 'unexpected'; // 响应格式与预期不符

export class BackendError extends Error {
	constructor(
		readonly kind: BackendErrorKind,
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = 'BackendError';
	}
}
