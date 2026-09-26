# Store page templates

The Steam Workshop and KDE Store descriptions are generated from these files (spec 006 FR-012a) by
`yarn release texts` / `yarn release assets`, checked by `yarn verify store-texts`, and pasted by hand
(see [docs/releasing.md](../releasing.md)).

- `layout.md` — the order of the page: pictures and the two language blocks `{en}` and `{ru}`.
- `description.en.md`, `description.ru.md` — the text of each language.

Allowed Markdown: `###` headings, `-` bullets, paragraphs, `**bold**`, `*italic*`, `` `code` ``,
`[text](url)`, and picture lines `![alt](../img/<file>)` pointing into `docs/img/` (linked at the
release tag on raw.githubusercontent.com). Placeholders on their own line are filled from
`src/adapters/shared/strings.ts`, so they stay the same as in the packages:

| Placeholder | Text |
| --- | --- |
| `{pitch}` | `package_description` |
| `{files}` | `help_files` |
| `{host_setup}` | Steam: `help_wallpaper_engine`; KDE: `help_kde` and `store_kde_requirements` |
| `{privacy}` | `help_privacy` |
| `{links}` | `store_links` |
| `{other_store}` | `store_on_kde_store` / `store_on_workshop`, left out while that store page is not set |
| `{feedback}` | `store_feedback`, in bold |

Both languages together must stay within 8000 bytes of BBCode (Russian takes two bytes a letter);
`yarn verify store-texts` prints the headroom.
