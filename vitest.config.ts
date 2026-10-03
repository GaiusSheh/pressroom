import { defineConfig } from 'vitest/config';

// 正式单元测试放在 .dev/unit-tests/（全局规则），只测不依赖 obsidian 的模块
export default defineConfig({
	test: {
		include: ['.dev/unit-tests/**/*.test.ts'],
		exclude: ['.dev/unit-tests/test-vault/**', 'node_modules/**'],
		environment: 'node',
	},
});
