import { App, Modal, Setting } from 'obsidian';

export interface ConfirmOptions {
	title: string;
	body: string;
	confirmText: string;
	cancelText: string;
	/** 确认按钮为破坏性操作样式 */
	destructive?: boolean;
	/** 附带的一个勾选项（如撤稿时「一并更新引用它的笔记」） */
	option?: { label: string; desc?: string; checked: boolean };
	/** 可展开的清单（如切换模式时受影响的笔记） */
	details?: { summary: string; items: string[] };
}

export interface ConfirmResult {
	ok: boolean;
	/** 勾选项的最终状态（无勾选项时为 false） */
	checked: boolean;
}

/** 确认弹窗：返回是否确认与勾选项状态；取消或关闭视为未确认 */
export function confirmWithOption(app: App, options: ConfirmOptions): Promise<ConfirmResult> {
	return new Promise((resolve) => {
		new ConfirmModal(app, options, resolve).open();
	});
}

/** 简单确认弹窗：确认返回 true，取消或关闭返回 false */
export async function confirm(app: App, options: ConfirmOptions): Promise<boolean> {
	return (await confirmWithOption(app, options)).ok;
}

class ConfirmModal extends Modal {
	private resolved = false;
	private checked: boolean;

	constructor(
		app: App,
		private readonly options: ConfirmOptions,
		private readonly resolve: (result: ConfirmResult) => void,
	) {
		super(app);
		this.checked = options.option?.checked ?? false;
	}

	onOpen() {
		const { contentEl, options } = this;
		this.setTitle(options.title);
		contentEl.createEl('p', { text: options.body });
		if (options.details) {
			const details = contentEl.createEl('details', { cls: 'pressroom-confirm-details' });
			details.createEl('summary', { text: options.details.summary });
			const list = details.createEl('ul');
			for (const item of options.details.items) list.createEl('li', { text: item });
		}
		if (options.option) {
			const opt = new Setting(contentEl).setName(options.option.label).addToggle((tg) =>
				tg.setValue(this.checked).onChange((v) => {
					this.checked = v;
				}),
			);
			if (options.option.desc) opt.setDesc(options.option.desc);
		}
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
		if (!this.resolved) this.resolve({ ok: false, checked: this.checked });
	}

	private finish(ok: boolean) {
		this.resolved = true;
		this.resolve({ ok, checked: this.checked });
		this.close();
	}
}
