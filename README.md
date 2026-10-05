# Pressroom

[中文说明](README.zh.md)

Publish individual Obsidian notes to one or more [Quartz 5](https://quartz.jzhao.xyz/) sites hosted in GitHub repositories. Right-click a note, pick a site, and about a minute later it is on the web.

- **One note at a time.** Only notes you publish go online. Everything else stays in your vault.
- **Your notes are never modified.** Pressroom adds no frontmatter or markers to your notes. The published copy is generated separately.
- **Several sites.** Publish the same note to one site, several sites, or all of them.
- **Management panel.** See what is published where, what has changed, and update, move or remove pages in bulk.

Pressroom is desktop-only and works with Quartz 5 sites stored in GitHub repositories.

## Before you start

1. **A Quartz 5 site in a GitHub repository**, already deployed (for example with GitHub Pages or Cloudflare Pages) and reachable at its own URL.
2. **A GitHub token.** A [fine-grained token](https://github.com/settings/personal-access-tokens) with **Contents: Read and write** on your site repositories is enough. Pressroom stores it in Obsidian's secret storage, not in plugin data.
3. **Keep your site repositories private** (recommended). Pressroom keeps a list of published notes in each repository (`.pressroom/manifest.json`), including where each note lives in your vault. If the repository is public, others can see your vault's folder names.

## Installation

Once Pressroom is listed in Obsidian's community plugins, search for **Pressroom** under *Settings → Community plugins → Browse*.

Until then, download `main.js`, `manifest.json` and `styles.css` from the latest release on this repository's Releases page, put them in `<your vault>/.obsidian/plugins/pressroom/`, and enable Pressroom under *Settings → Community plugins*.

## Settings

### Publishing

| Setting | What it does |
|---|---|
| GitHub token | The token from above. |
| Excluded folders | Notes in these folders are never published and never pulled in by links, for example `Private`. One folder per line. |
| Links to unpublished notes | What to do by default when a note links to a note that is not on the site yet: turn the link into plain text, also publish the linked notes (one level), or follow links all the way. Only used on sites in *Follow vault* mode. |
| Published properties | Only these frontmatter properties are kept in the published copy (default: `title`, `tags`, `date`, `description`). Everything else, such as private notes to yourself, is removed. |

### Sites

Click **Add site** and fill in:

| Field | Notes |
|---|---|
| Name | Shown in menus, for example "Site A". |
| Repository | `owner/repo`. |
| Branch | Usually `main`. Each repository branch can be used by only one site (different branches of the same repository are fine). |
| Content folder | The folder Quartz builds from, usually `content`. |
| Site URL | For example `https://example.pages.dev`. Used to build links. |
| Folder mode | See below. |
| Isolate this site | Links from this site to notes on your other sites become plain text, so visitors cannot tell the sites belong to the same person. |
| Test connection | Checks the token, repository, branch and Quartz configuration without writing anything. |

**Folder mode** decides where a note goes on the site:

- **Manual** (default): the first time you publish a note, you choose its folder and name on the site. The vault structure does not matter.
- **Follow vault**: the site mirrors your vault. A note at `Reading/Some book.md` is published at the same place, and you never fill in a location.

The folder mode is saved in the site repository, so it stays the same on all your devices.

## Everyday use

Right-click a note in the file explorer (or use the command palette):

| Menu item | What it does |
|---|---|
| **Pressroom: Publish…** | Publishes the note, or updates it if it is already published. |
| **Pressroom: Unpublish…** | Removes the page from the site. Your note is not touched. |
| **Pressroom: Copy link…** | Copies the page's URL. |
| **Pressroom: Open page…** | Opens the page in your browser. |

A site list then appears, with the note's status on each site:

| Status | Meaning |
|---|---|
| ✓ Synced | The site has the same content as your vault. |
| ● Modified | You changed the note; the site still has the old version. |
| ↪ Moved | *Follow vault* sites only: you renamed or moved the note in the vault, and the page is still at the old place. |
| Not published | The note is not on this site. |

The last entry, **All sites**, publishes to, unpublishes from, or copies links for every site at once. With only one site, the list is skipped.

### Publishing for the first time

- **Manual sites** show a location dialog: choose a folder and name (the **Fill in vault location** button copies them from the vault). The URL preview updates as you type. If the URL would clash with an existing page (Quartz treats `A B` and `a-b` as the same URL), you cannot publish until you pick another name.
- **Follow vault sites** need no location. If the note links to notes that are not on the site yet, Pressroom asks whether to turn those links into plain text or publish the linked notes too, and lets you untick any of them.

### What happens to the content

- **Links** (`[[Another note]]`): become a link on the same site if that note is published there; otherwise a link to the other site where it is published (plain text if either site is isolated); otherwise plain text.
- **Images and attachments** are uploaded with the note. A file used by several notes is stored once.
- **Embeds** (`![[Some note]]`) are expanded into the page inside a titled quote box, similar to how Obsidian shows them.
- **Backlink reminders.** After you publish a note, if other published notes link to it (and showed that link as plain text), the notice offers to update them so the links start working. When you unpublish, links to it are turned back into plain text by default, so no dead links are left behind.

## Renaming and moving

- When you rename or move a published note in your vault, Pressroom records the new location and saves it to each site repository within a few seconds (or later, if you are offline).
- On a *Follow vault* site the note then shows **↪ Moved**. Publish it again and the page moves to the new place. **The old URL redirects to the new page**, so links people saved keep working. This uses Quartz's alias redirects, which are on by default.
- On a *Manual* site the page stays where it is; move it from the management panel if you want.

## Management panel

Click the newspaper icon in the left ribbon, or run **Pressroom: Open management panel**.

- One tab per site, showing the site's folder tree with every note published by Pressroom: its name on the site, where it is in your vault, and its status. With many notes, statuses fill in one by one.
- An extra status, **✗ Source deleted**, means the page is still on the site but the note is gone from your vault.

The **…** button on each note offers: update, move or rename on the site (manual sites only; the old URL redirects), unpublish, copy link, open page, and open in vault.

Buttons at the top work on the whole site (the number shows how many notes are affected):

| Button | What it does | Sites |
|---|---|---|
| Sync all | Updates modified notes and moves moved notes to their vault location. | Follow vault |
| Update all | Updates content only; moved notes stay where they are. | All |
| Rearrange | Moves notes to their vault location without publishing new content. | Follow vault (not for sites using relative links) |
| Clean up deleted | Removes pages whose source note was deleted. | All |

Every bulk action shows the list first and asks for confirmation, then makes a single commit.

## Several notes at once

Select several notes in the file explorer with **Shift**-click, right-click, and choose **Publish N notes…** or **Unpublish N notes…**. On manual sites, notes that are not published yet are skipped (each needs its location chosen once), and the result says how many.

## Good to know

- The site updates about a minute after publishing, while Quartz rebuilds it.
- Each action is a single commit in your site repository, however many notes it touches.
- Everything Pressroom needs to know is stored in the site repository, so you can continue on another device after adding the same sites there.
- Pages that were already in the repository before Pressroom (for example published by another tool) are left alone; Pressroom only uses them to avoid URL clashes.

## Development

Run npm in PowerShell on Windows (npm install scripts fail under Git Bash).

```powershell
npm install
npm run dev     # watch build
npm run build   # type check + production build
npm test        # unit tests
npm run lint
```

- Source: `src/`. Core logic lives in `src/core/` and does not depend on the `obsidian` package, so it can be unit-tested in Node.
- Unit tests: `.dev/unit-tests/` (vitest).
- Test vault: `.dev/unit-tests/test-vault/`. Put `PRESSROOM_VAULT=<absolute vault path>` in a root `.env.local` and builds are copied into that vault's plugin folder.

## License

MIT
