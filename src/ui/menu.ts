import { TFile } from 'obsidian';
import type PressroomPlugin from '../main';
import { type MessageKey, t } from '../i18n';
import type { PressroomActions } from './actions';
import { PanelModal } from './panel/panel-modal';

type Action = 'publish' | 'unpublish' | 'copyLink' | 'openPage';

const ACTIONS: { action: Action; menu: MessageKey; command: MessageKey; icon: string }[] = [
	{ action: 'publish', menu: 'menu.publish', command: 'cmd.publish', icon: 'upload' },
	{ action: 'unpublish', menu: 'menu.unpublish', command: 'cmd.unpublish', icon: 'trash-2' },
	{ action: 'copyLink', menu: 'menu.copyLink', command: 'cmd.copyLink', icon: 'link' },
	{ action: 'openPage', menu: 'menu.openPage', command: 'cmd.openPage', icon: 'globe' },
];

/** 右键菜单（单个 Markdown 文件，排除文件夹中不显示；多选）、管理面板入口与命令面板命令 */
export function registerMenus(plugin: PressroomPlugin, actions: PressroomActions): void {
	const run = (action: Action, file: TFile) => void actions[action](file);

	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || !actions.canHandle(file)) return;
			for (const a of ACTIONS) {
				menu.addItem((item) =>
					item
						.setTitle(t(a.menu))
						.setIcon(a.icon)
						.setSection('pressroom')
						.onClick(() => run(a.action, file)),
				);
			}
		}),
	);

	// 文件列表多选（需求 §4）：多个文件时 Obsidian 触发 files-menu 而不是 file-menu
	plugin.registerEvent(
		plugin.app.workspace.on('files-menu', (menu, files) => {
			const notes = files.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
			if (notes.length === 0) return;
			menu.addItem((item) =>
				item
					.setTitle(t('menu.publishMany', { n: notes.length }))
					.setIcon('upload')
					.setSection('pressroom')
					.onClick(() => void actions.publishMany(notes)),
			);
			menu.addItem((item) =>
				item
					.setTitle(t('menu.unpublishMany', { n: notes.length }))
					.setIcon('trash-2')
					.setSection('pressroom')
					.onClick(() => void actions.unpublishMany(notes)),
			);
		}),
	);

	// 管理面板（需求 §6）：左侧 ribbon 图标与命令
	const openPanel = () => new PanelModal(plugin.app, plugin).open();
	plugin.addRibbonIcon('newspaper', t('panel.open'), openPanel);
	plugin.addCommand({ id: 'open-panel', name: t('cmd.openPanel'), callback: openPanel });

	for (const a of ACTIONS) {
		plugin.addCommand({
			id: a.action,
			name: t(a.command),
			checkCallback: (checking) => {
				const file = plugin.app.workspace.getActiveFile();
				if (!file || !actions.canHandle(file)) return false;
				if (!checking) run(a.action, file);
				return true;
			},
		});
	}
}
