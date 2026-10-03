import { en, type MessageKey, type Messages } from './en';
import { zh } from './zh';

// 本模块不依赖 obsidian：语言代码由插件入口通过 getLanguage() 取得后传入

export type Lang = 'en' | 'zh';
export type { MessageKey };

const dictionaries: Record<Lang, Messages> = { en, zh };

/** Obsidian 语言代码以 zh 开头（zh、zh-TW 等）用中文，其余用英文 */
export function resolveLang(code: string): Lang {
	return code.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export type Vars = Record<string, string | number>;

/** 生成翻译函数；文字中的 {name} 用 vars.name 替换，缺少参数时抛错 */
export function createTranslator(lang: Lang) {
	const dict = dictionaries[lang];
	return (key: MessageKey, vars?: Vars): string =>
		dict[key].replace(/\{(\w+)\}/g, (_, name: string) => {
			const value = vars?.[name];
			if (value === undefined) {
				throw new Error(`i18n 键 "${key}" 需要参数 "${name}"，实际未提供`);
			}
			return String(value);
		});
}

let current = createTranslator('en');

/** 插件加载时调用一次 */
export function setLanguage(lang: Lang): void {
	current = createTranslator(lang);
}

/** 按当前语言翻译 */
export function t(key: MessageKey, vars?: Vars): string {
	return current(key, vars);
}
