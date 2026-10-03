import { describe, expect, it } from 'vitest';
import { findConflicts } from '../../../src/core/generator/quartz';
import type { SlugOwner } from '../../../src/core/generator/types';

const file = (path: string): SlugOwner => ({ kind: 'file', path });
const alias = (a: string, ownerPath: string): SlugOwner => ({ kind: 'alias', alias: a, ownerPath });

describe('findConflicts', () => {
	it('空格与连字符', () => {
		const result = findConflicts('A B.md', [file('a-b.md'), file('other.md')]);
		expect(result).toEqual([{ slug: 'a-b', owner: file('a-b.md') }]);
	});

	it('大小写不同', () => {
		expect(findConflicts('笔记/Note.md', [file('笔记/note.md')])).toHaveLength(1);
	});

	it('文件夹同名笔记与 index.md', () => {
		expect(findConflicts('笔记/笔记.md', [file('笔记/index.md')])).toHaveLength(1);
		expect(findConflicts('笔记/index.md', [file('笔记/笔记.md')])).toHaveLength(1);
	});

	it('笔记与同名文件夹的 index 不冲突（folder 与 folder/index 是两个网址）', () => {
		expect(findConflicts('笔记.md', [file('笔记/index.md')])).toEqual([]);
	});

	it('与其他笔记写入的 alias 冲突', () => {
		const result = findConflicts('old/旧 位置.md', [alias('old/旧 位置', 'moved.md')]);
		expect(result).toEqual([{ slug: 'old/旧-位置', owner: alias('old/旧 位置', 'moved.md') }]);
	});

	it('附件：大小写与空格按 slug 比较，扩展名大小写区分', () => {
		expect(findConflicts('assets/My Image.png', [file('assets/my image.png')])).toHaveLength(1);
		expect(findConflicts('assets/img.png', [file('assets/IMG.PNG')])).toEqual([]);
	});

	it('笔记与同名附件不冲突（扩展名不同）', () => {
		expect(findConflicts('assets/a.md', [file('assets/a.png')])).toEqual([]);
	});

	it('exclude：被移动笔记的当前文件与它自己的 alias 不算冲突', () => {
		const owners = [file('笔记/a.md'), alias('笔记/旧 a', '笔记/a.md'), file('笔记/b.md')];
		expect(findConflicts('笔记/a.md', owners, '笔记/a.md')).toEqual([]);
		expect(findConflicts('笔记/旧 a.md', owners, '笔记/a.md')).toEqual([]);
		expect(findConflicts('笔记/b.md', owners, '笔记/a.md')).toHaveLength(1);
	});

	it('多个冲突全部返回', () => {
		expect(findConflicts('A B.md', [file('a-b.md'), file('a b.md'), alias('A-B', 'x.md')])).toHaveLength(3);
	});
});
