import { App, Modal, Setting } from 'obsidian';

export interface ConfirmOptions {
	title: string;
	body: string;
	confirmText: string;
	cancelText: string;
	/** 确认按钮为破坏性操作样式 */
	destructive?: boolean;
}

/** 简单确认弹窗：确认返回 true，取消或关闭返回 false */
export function confirm(app: App, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, options, resolve).open();
	});
}

class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly options: ConfirmOptions,
		private readonly resolve: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, options } = this;
		this.setTitle(options.title);
		contentEl.createEl('p', { text: options.body });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(options.cancelText).onClick(() => this.finish(false)))
			.addButton((b) => {
				b.setButtonText(options.confirmText).onClick(() => this.finish(true));
				if (options.destructive) b.setDestructive().setCta();
				else b.setCta();
			});
	}

	onClose() {
		this.contentEl.empty();
		if (!this.resolved) this.resolve(false);
	}

	private finish(ok: boolean) {
		this.resolved = true;
		this.resolve(ok);
		this.close();
	}
}
