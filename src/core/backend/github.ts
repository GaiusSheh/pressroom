// GitHub 后端：Git Data API（blob → tree → commit → 更新 ref），一次操作一次提交，不建分支、不开 PR
// 依据：.dev/docs/others/phase0-findings.md §0-5

import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from '../hash';
import {
	type Backend,
	BackendError,
	type BackendErrorKind,
	type Change,
	type CommitResult,
	type Head,
	type HttpFn,
	type HttpResponse,
	type TreeEntry,
} from './types';

export interface GitHubOptions {
	/** owner/repo */
	repo: string;
	branch: string;
	token: string;
	http: HttpFn;
	/** 非 fast-forward 时的最大重试次数（不含首次） */
	maxRetries?: number;
	apiBase?: string;
}

type Json = Record<string, unknown>;

function asObject(value: unknown, what: string): Json {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new BackendError('unexpected', `${what}：期望 JSON 对象，实际为 ${JSON.stringify(value)?.slice(0, 200)}`);
	}
	return value as Json;
}

function asString(obj: Json, key: string, what: string): string {
	const v = obj[key];
	if (typeof v !== 'string') throw new BackendError('unexpected', `${what}：字段 ${key} 应为字符串，实际为 ${typeof v}`);
	return v;
}

/** 对路径逐段编码（保留 /），用于 contents API 的 URL */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class GitHubBackend implements Backend {
	private readonly base: string;
	private readonly maxRetries: number;

	constructor(private readonly opts: GitHubOptions) {
		if (!/^[^/\s]+\/[^/\s]+$/.test(opts.repo)) {
			throw new BackendError('invalid', `仓库应为 owner/repo，实际为 "${opts.repo}"`);
		}
		this.base = `${opts.apiBase ?? 'https://api.github.com'}/repos/${opts.repo}`;
		this.maxRetries = opts.maxRetries ?? 3;
	}

	/** 仓库本身是否可访问（区分「仓库不存在 / 无权」与「分支不存在」） */
	async getRepo(): Promise<{ defaultBranch: string; private: boolean }> {
		const res = await this.request('GET', '', undefined, '读取仓库信息');
		const obj = asObject(res.json, '读取仓库信息');
		return { defaultBranch: asString(obj, 'default_branch', '读取仓库信息'), private: obj.private === true };
	}

	async getHead(): Promise<Head> {
		const what = `读取分支 ${this.opts.branch}`;
		const ref = asObject((await this.request('GET', `/git/ref/heads/${encodePath(this.opts.branch)}`, undefined, what)).json, what);
		const commitSha = asString(asObject(ref.object, what), 'sha', what);
		const commit = asObject((await this.request('GET', `/git/commits/${commitSha}`, undefined, what)).json, what);
		return { commitSha, treeSha: asString(asObject(commit.tree, what), 'sha', what) };
	}

	async getTree(treeSha: string): Promise<TreeEntry[]> {
		const what = '读取文件树';
		const obj = asObject((await this.request('GET', `/git/trees/${treeSha}?recursive=1`, undefined, what)).json, what);
		if (obj.truncated === true) {
			// GitHub 单次 recursive 上限约 10 万条 / 7 MB；v1 不做分段读取
			throw new BackendError('unexpected', `${what}：仓库文件过多，GitHub 返回的文件树被截断（truncated），暂不支持`);
		}
		if (!Array.isArray(obj.tree)) throw new BackendError('unexpected', `${what}：缺少 tree 数组`);
		return obj.tree
			.map((e) => asObject(e, what))
			.filter((e) => e.type === 'blob')
			.map((e) => ({ path: asString(e, 'path', what), sha: asString(e, 'sha', what), size: Number(e.size ?? 0) }));
	}

	async readText(path: string): Promise<string | undefined> {
		const what = `读取 ${path}`;
		const res = await this.request(
			'GET',
			`/contents/${encodePath(path)}?ref=${encodeURIComponent(this.opts.branch)}`,
			undefined,
			what,
			[404],
		);
		if (res.status === 404) return undefined;
		const obj = asObject(res.json, what);
		if (obj.type !== 'file') throw new BackendError('unexpected', `${what}：不是文件（type=${String(obj.type)}）`);
		// 超过 1 MB 时 contents API 不返回内容（encoding 为 none），改从 blob 读取
		const bytes =
			obj.encoding === 'base64' ? base64ToBytes(asString(obj, 'content', what)) : await this.readBlob(asString(obj, 'sha', what));
		return utf8Decode(bytes);
	}

	async readBlob(sha: string): Promise<Uint8Array> {
		const what = `读取 blob ${sha}`;
		const obj = asObject((await this.request('GET', `/git/blobs/${sha}`, undefined, what)).json, what);
		if (obj.encoding !== 'base64') throw new BackendError('unexpected', `${what}：encoding 应为 base64，实际为 ${String(obj.encoding)}`);
		return base64ToBytes(asString(obj, 'content', what));
	}

	async commit(message: string, build: (head: Head) => Change[] | Promise<Change[]>): Promise<CommitResult | undefined> {
		for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
			const head = await this.getHead();
			const changes = await build(head);
			if (changes.length === 0) return undefined;
			const commitSha = await this.createCommit(message, head, changes);
			const res = await this.request(
				'PATCH',
				`/git/refs/heads/${encodePath(this.opts.branch)}`,
				{ sha: commitSha, force: false },
				`更新分支 ${this.opts.branch}`,
				[422],
			);
			if (res.status !== 422) return { commitSha, attempts: attempt };
			if (!/fast.?forward/i.test(githubMessage(res))) {
				throw new BackendError('invalid', `更新分支 ${this.opts.branch} 被拒绝：${githubMessage(res)}`, 422);
			}
			// 非 fast-forward：分支在此期间被其他设备或外部推送更新，重新取 head 重建
		}
		throw new BackendError(
			'conflict',
			`更新分支 ${this.opts.branch} 时连续 ${this.maxRetries + 1} 次遇到非 fast-forward（分支持续被其他来源更新），已放弃`,
		);
	}

	private async createCommit(message: string, head: Head, changes: Change[]): Promise<string> {
		const entries = [];
		for (const change of changes) {
			if ('delete' in change) {
				entries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
			} else if ('reuseSha' in change) {
				entries.push({ path: change.path, mode: '100644', type: 'blob', sha: change.reuseSha });
			} else {
				const bytes = typeof change.content === 'string' ? utf8Encode(change.content) : change.content;
				const blob = asObject(
					(await this.request('POST', '/git/blobs', { content: bytesToBase64(bytes), encoding: 'base64' }, `上传 ${change.path}`)).json,
					`上传 ${change.path}`,
				);
				entries.push({ path: change.path, mode: '100644', type: 'blob', sha: asString(blob, 'sha', `上传 ${change.path}`) });
			}
		}
		const tree = asObject(
			(await this.request('POST', '/git/trees', { base_tree: head.treeSha, tree: entries }, '创建文件树')).json,
			'创建文件树',
		);
		const commit = asObject(
			(
				await this.request(
					'POST',
					'/git/commits',
					{ message, tree: asString(tree, 'sha', '创建文件树'), parents: [head.commitSha] },
					'创建提交',
				)
			).json,
			'创建提交',
		);
		return asString(commit, 'sha', '创建提交');
	}

	/** 发请求；2xx 与 allow 中的状态码直接返回，其余抛 BackendError */
	private async request(
		method: 'GET' | 'POST' | 'PATCH',
		path: string,
		body: unknown,
		what: string,
		allow: number[] = [],
	): Promise<HttpResponse> {
		const res = await this.opts.http({
			method,
			url: `${this.base}${path}`,
			headers: {
				Authorization: `Bearer ${this.opts.token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if ((res.status >= 200 && res.status < 300) || allow.includes(res.status)) return res;
		throw new BackendError(errorKind(res), `${what}失败：HTTP ${res.status}，${githubMessage(res)}`, res.status);
	}
}

function githubMessage(res: HttpResponse): string {
	const msg = (res.json as Json | undefined)?.message;
	return typeof msg === 'string' ? msg : '(无错误信息)';
}

function errorKind(res: HttpResponse): BackendErrorKind {
	const { status } = res;
	if (status === 401) return 'auth';
	if (status === 429 || (status === 403 && res.headers['x-ratelimit-remaining'] === '0')) return 'rateLimit';
	if (status === 403) return 'forbidden';
	if (status === 404) return 'notFound';
	if (status >= 500) return 'server';
	return 'invalid';
}
