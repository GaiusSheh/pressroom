import { Plugin, getLanguage } from 'obsidian';
import { resolveLang, setLanguage } from './i18n';
import { type PressroomSettings, normalizeSettings } from './settings/settings';
import { PressroomSettingTab } from './settings/tab';

export default class PressroomPlugin extends Plugin {
	settings!: PressroomSettings;

	async onload() {
		setLanguage(resolveLang(getLanguage()));
		await this.loadSettings();
		this.addSettingTab(new PressroomSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		const { settings, warnings } = normalizeSettings(await this.loadData());
		for (const w of warnings) console.warn(`[Pressroom] ${w}`);
		this.settings = settings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** 从 Obsidian 密钥库取 token；未设置返回 undefined */
	getToken(): string | undefined {
		const id = this.settings.tokenSecretId;
		return (id && this.app.secretStorage.getSecret(id)) || undefined;
	}
}
