import { requestUrl } from 'obsidian';
import type { HttpFn } from '../core/backend/types';

/** 用 Obsidian requestUrl（无 CORS 限制）实现 HttpFn；状态码由调用方判断 */
export const obsidianHttp: HttpFn = async ({ method, url, headers, body }) => {
	const res = await requestUrl({ url, method, headers, body, throw: false });
	let json: unknown;
	try {
		json = res.json;
	} catch {
		json = undefined;
	}
	const lower: Record<string, string> = {};
	for (const [k, v] of Object.entries(res.headers)) lower[k.toLowerCase()] = v;
	return { status: res.status, headers: lower, json };
};
