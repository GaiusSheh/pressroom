// 哈希与编码工具（Web Crypto，Obsidian 与 Node 22 均可用）

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8Encode(text: string): Uint8Array {
	return encoder.encode(text);
}

/** UTF-8 解码；字节不是合法 UTF-8 时抛错 */
export function utf8Decode(bytes: Uint8Array): string {
	return decoder.decode(bytes);
}

/** git blob SHA-1：sha1("blob <字节长度>\0" + 内容)，与 GitHub 返回的 blob sha 一致 */
export async function gitBlobSha(content: Uint8Array | string): Promise<string> {
	const body = typeof content === 'string' ? utf8Encode(content) : content;
	const header = utf8Encode(`blob ${body.length}\0`);
	const data = new Uint8Array(header.length + body.length);
	data.set(header, 0);
	data.set(body, header.length);
	const digest = await crypto.subtle.digest('SHA-1', data);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	// 分块拼接，避免大文件时 String.fromCharCode 参数过多
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

/** base64 解码；GitHub 返回的 base64 带换行，先去除空白 */
export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64.replace(/\s/g, ''));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
