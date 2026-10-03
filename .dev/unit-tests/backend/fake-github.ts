// 内存版 GitHub Git Data API，供单元测试使用。只实现 GitHubBackend 用到的接口与行为
import { base64ToBytes, bytesToBase64, gitBlobSha, utf8Encode } from '../../../src/core/hash';
import type { HttpFn, HttpRequest, HttpResponse } from '../../../src/core/backend/types';

type Tree = Map<string, string>; // path → blob sha

export class FakeGitHub {
	readonly blobs = new Map<string, Uint8Array>();
	readonly trees = new Map<string, Tree>();
	readonly commits = new Map<string, { tree: string; parents: string[]; message: string }>();
	readonly log: string[] = [];
	ref: string;
	token = 'good-token';
	branch = 'main';
	/** PATCH ref 之前调用（模拟其他设备在此期间推送） */
	beforePatch?: () => Promise<void> | void;
	private seq = 0;

	private constructor(initialCommit: string) {
		this.ref = initialCommit;
	}

	/** 以给定文件创建仓库（一个初始提交） */
	static async create(files: Record<string, string | Uint8Array> = {}): Promise<FakeGitHub> {
		const fake = new FakeGitHub('');
		const tree: Tree = new Map();
		for (const [path, content] of Object.entries(files)) tree.set(path, await fake.putBlob(content));
		fake.ref = fake.putCommit(fake.putTree(tree), [], 'init');
		return fake;
	}

	readonly http: HttpFn = async (req) => {
		this.log.push(`${req.method} ${req.url.replace(/^.*\/repos\/[^/]+\/[^/]+/, '')}`);
		if (req.headers.Authorization !== `Bearer ${this.token}`) return res(401, { message: 'Bad credentials' });
		return this.route(req);
	};

	/** 当前分支上的文件内容（测试断言用） */
	headFiles(): Map<string, Uint8Array> {
		const tree = this.trees.get(this.commits.get(this.ref)!.tree)!;
		return new Map([...tree].map(([p, sha]) => [p, this.blobs.get(sha)!]));
	}

	/** 模拟外部推送：在当前分支上直接追加一个提交 */
	async externalPush(path: string, content: string): Promise<void> {
		const tree = new Map(this.trees.get(this.commits.get(this.ref)!.tree));
		tree.set(path, await this.putBlob(content));
		this.ref = this.putCommit(this.putTree(tree), [this.ref], 'external');
	}

	private async putBlob(content: string | Uint8Array): Promise<string> {
		const bytes = typeof content === 'string' ? utf8Encode(content) : content;
		const sha = await gitBlobSha(bytes);
		this.blobs.set(sha, bytes);
		return sha;
	}

	private putTree(tree: Tree): string {
		const sha = `tree${++this.seq}`;
		this.trees.set(sha, tree);
		return sha;
	}

	private putCommit(tree: string, parents: string[], message: string): string {
		const sha = `commit${++this.seq}`;
		this.commits.set(sha, { tree, parents, message });
		return sha;
	}

	private async route(req: HttpRequest): Promise<HttpResponse> {
		const url = new URL(req.url);
		const path = decodeURIComponent(url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ''));
		const body = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
		const branchRef = `/git/ref/heads/${this.branch}`;

		if (req.method === 'GET' && path === '') return res(200, { default_branch: this.branch, private: true });
		if (req.method === 'GET' && path.startsWith('/git/ref/heads/')) {
			return path === branchRef ? res(200, { object: { sha: this.ref } }) : res(404, { message: 'Not Found' });
		}
		if (req.method === 'GET' && path.startsWith('/git/commits/')) {
			const c = this.commits.get(path.slice('/git/commits/'.length));
			return c ? res(200, { tree: { sha: c.tree } }) : res(404, { message: 'Not Found' });
		}
		if (req.method === 'GET' && path.startsWith('/git/trees/')) {
			const tree = this.trees.get(path.slice('/git/trees/'.length));
			if (!tree) return res(404, { message: 'Not Found' });
			const entries = [...tree].map(([p, sha]) => ({ path: p, type: 'blob', sha, size: this.blobs.get(sha)!.length }));
			return res(200, { tree: entries, truncated: false });
		}
		if (req.method === 'GET' && path.startsWith('/git/blobs/')) {
			const bytes = this.blobs.get(path.slice('/git/blobs/'.length));
			return bytes ? res(200, { content: bytesToBase64(bytes), encoding: 'base64' }) : res(404, { message: 'Not Found' });
		}
		if (req.method === 'GET' && path.startsWith('/contents/')) {
			const file = path.slice('/contents/'.length);
			const sha = this.trees.get(this.commits.get(this.ref)!.tree)!.get(file);
			return sha
				? res(200, { type: 'file', encoding: 'base64', content: bytesToBase64(this.blobs.get(sha)!), sha })
				: res(404, { message: 'Not Found' });
		}
		if (req.method === 'POST' && path === '/git/blobs') {
			if (body.encoding !== 'base64') return res(422, { message: 'encoding must be base64 in this fake' });
			return res(201, { sha: await this.putBlob(base64ToBytes(String(body.content))) });
		}
		if (req.method === 'POST' && path === '/git/trees') {
			const base = this.trees.get(String(body.base_tree));
			if (!base) return res(422, { message: 'Invalid base_tree' });
			const tree = new Map(base);
			for (const e of body.tree as { path: string; sha: string | null }[]) {
				if (e.sha === null) {
					if (!tree.has(e.path)) return res(422, { message: `Could not delete ${e.path}` });
					tree.delete(e.path);
				} else {
					if (!this.blobs.has(e.sha)) return res(422, { message: `Invalid sha ${e.sha}` });
					tree.set(e.path, e.sha);
				}
			}
			return res(201, { sha: this.putTree(tree) });
		}
		if (req.method === 'POST' && path === '/git/commits') {
			const parents = body.parents as string[];
			return res(201, { sha: this.putCommit(String(body.tree), parents, String(body.message)) });
		}
		if (req.method === 'PATCH' && path === `/git/refs/heads/${this.branch}`) {
			await this.beforePatch?.();
			const commit = this.commits.get(String(body.sha));
			if (!commit) return res(422, { message: 'Object does not exist' });
			if (!commit.parents.includes(this.ref)) return res(422, { message: 'Update is not a fast forward' });
			this.ref = String(body.sha);
			return res(200, { object: { sha: this.ref } });
		}
		return res(404, { message: `fake: 未实现 ${req.method} ${path}` });
	}
}

function res(status: number, json: unknown, headers: Record<string, string> = {}): HttpResponse {
	return { status, json, headers };
}
