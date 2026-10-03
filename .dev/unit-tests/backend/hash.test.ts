import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, gitBlobSha, utf8Decode, utf8Encode } from '../../../src/core/hash';

/** 期望值由 git 本身计算 */
const gitHashObject = (bytes: Uint8Array) =>
	execFileSync('git', ['hash-object', '--stdin'], { input: bytes }).toString().trim();

describe('gitBlobSha 与 git hash-object 一致', () => {
	const samples: [string, Uint8Array][] = [
		['空内容', new Uint8Array()],
		['中文 LF', utf8Encode('---\ntitle: 中文\n---\n\n正文，含全角标点。\n')],
		['CRLF', utf8Encode('line1\r\nline2\r\n')],
		['二进制', new Uint8Array(randomBytes(4096))],
		['emoji', utf8Encode('🌱 garden\n')],
	];
	it.each(samples)('%s', async (_, bytes) => {
		expect(await gitBlobSha(bytes)).toBe(gitHashObject(bytes));
	});

	it('字符串参数按 UTF-8 编码', async () => {
		expect(await gitBlobSha('中文\n')).toBe(gitHashObject(utf8Encode('中文\n')));
	});
});

describe('base64', () => {
	it('大于分块大小的二进制往返一致', () => {
		const bytes = new Uint8Array(randomBytes(100_000));
		expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
	});

	it('与 Node Buffer 编码一致，且容忍 GitHub 返回的换行', () => {
		const bytes = utf8Encode('中文 content');
		const b64 = Buffer.from(bytes).toString('base64');
		expect(bytesToBase64(bytes)).toBe(b64);
		expect(base64ToBytes(b64.replace(/(.{4})/g, '$1\n'))).toEqual(bytes);
	});
});

describe('utf8Decode', () => {
	it('非法 UTF-8 抛错而不是静默替换', () => {
		expect(() => utf8Decode(new Uint8Array([0xff, 0xfe]))).toThrow();
	});
});
