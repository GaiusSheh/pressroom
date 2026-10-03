// 英文字典：所有界面文字的键以此为准，zh.ts 必须提供相同的键
export const en = {
	'plugin.name': 'Pressroom',

	'settings.global.heading': 'General',
	'settings.token.name': 'GitHub token',
	'settings.token.desc':
		'Stored in Obsidian\'s secret storage, never in plugin data. A fine-grained token with "Contents: Read and write" on your site repositories is enough.',
	'settings.excluded.name': 'Excluded folders',
	'settings.excluded.desc':
		'Notes in these folders can never be published or pulled in by links. One folder per line.',
	'settings.linkPolicy.name': 'Links to unpublished notes',
	'settings.linkPolicy.desc': 'Default choice in the publish dialog.',
	'settings.linkPolicy.plain': 'Turn into plain text',
	'settings.linkPolicy.one': 'Publish linked notes (one level)',
	'settings.linkPolicy.all': 'Publish linked notes (all levels)',
	'settings.whitelist.name': 'Published properties',
	'settings.whitelist.desc':
		'Only these frontmatter properties are kept in the published copy; all others are removed. Separate with commas.',

	'settings.sites.heading': 'Sites',
	'settings.sites.add': 'Add site',
	'settings.sites.empty': 'No sites yet. Add one to start publishing.',
	'settings.sites.defaultName': 'Site {n}',
	'settings.site.name': 'Name',
	'settings.site.name.desc': 'Shown in menus and tabs.',
	'settings.site.repo': 'Repository',
	'settings.site.repo.desc': 'GitHub repository as owner/repo.',
	'settings.site.branch': 'Branch',
	'settings.site.branch.desc': 'Published notes are committed directly to this branch.',
	'settings.site.contentDir': 'Content folder',
	'settings.site.contentDir.desc':
		'Folder in the repository that Quartz builds from, e.g. content. Leave empty for the repository root.',
	'settings.site.siteUrl': 'Site URL',
	'settings.site.siteUrl.desc': 'Used to build links and open pages, e.g. https://example.pages.dev',
	'settings.site.mode': 'Folder mode',
	'settings.site.mode.desc':
		'Manual: you choose where each note goes on the site. Follow vault: site folders and names always match the vault.',
	'settings.site.mode.manual': 'Manual',
	'settings.site.mode.follow': 'Follow vault',
	'settings.site.isolated': 'Isolate this site',
	'settings.site.isolated.desc':
		'Links to notes published on other sites become plain text, so this site never reveals the others.',
	'settings.site.delete': 'Remove site',
	'settings.site.delete.title': 'Remove "{name}"?',
	'settings.site.delete.body':
		'This only removes the site from Pressroom settings. Nothing in the repository or on the website is changed.',
	'settings.site.removed': 'This site has been removed. Go back to the site list.',
	'settings.site.test': 'Test connection',
	'settings.site.test.desc':
		"Checks the token, repository, branch, content folder and the site's Quartz configuration. Nothing is written.",
	'settings.site.test.button': 'Test',
	'settings.site.test.running': 'Testing…',

	'conn.noToken': 'No GitHub token yet. Set one under General first.',
	'conn.incomplete': 'Fill in the repository and branch first.',
	'conn.auth': 'The token is invalid or has expired.',
	'conn.repoNotFound': 'Repository {repo} was not found, or the token cannot access it.',
	'conn.forbidden': 'The token is not allowed to access {repo}.',
	'conn.rateLimit': 'GitHub rate limit reached. Try again later.',
	'conn.failed': 'Request failed: {message}',
	'conn.network': 'Network error: {message}',
	'conn.branchNotFound': 'Branch {branch} was not found. The default branch is {defaultBranch}.',
	'conn.ok': 'Connected to {repo} on branch {branch}.',
	'conn.repoRoot': '(repository root)',
	'conn.contentDir': 'Content folder {dir}: {count} files.',
	'conn.contentDirMissing': 'Content folder {dir} does not exist yet. It will be created on the first publish.',
	'conn.configMissing': 'No quartz.config.yaml at the repository root. Is this a Quartz 5 site?',
	'conn.configInvalid': 'Could not read quartz.config.yaml: {detail}',
	'conn.strategy': 'Link resolution: {strategy}.',
	'conn.strategyDefault': 'Link resolution: {strategy} (not set in the config, plugin default).',
	'conn.aliasOn': 'Alias redirects are on: old URLs keep working after a note is moved.',
	'conn.aliasOff': 'Alias redirects are off: old URLs will break after a note is moved.',
	'conn.baseUrlMismatch': 'Quartz baseUrl is {baseUrl}, but the site URL here is {siteUrl}.',
	'conn.writeNote': 'Write permission cannot be checked without writing; it is verified on the first publish.',

	'common.cancel': 'Cancel',
	'common.remove': 'Remove',

	'error.required': 'This field is required.',
	'error.repo': 'Use the form owner/repo.',
	'error.branch': 'This is not a valid branch name.',
	'error.contentDir': 'Use a folder path inside the repository, without . or .. segments.',
	'error.url': 'Enter a full URL starting with https://',
	'error.nameDuplicate': 'Another site already uses this name.',

	'notice.published': 'Published to {site}. The site will update in about a minute.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
