# Quick Ask

**English** · [简体中文](README_zh.md)

### Ask about the passage, right where you read it.

A focused AI sidebar for your Obsidian notes, papers and images. Explain a term, compare notes, or turn a section into review questions — drag in your material and ask.

[Get started](#get-started) · [User guide](docs/user-guide.md) · [Releases](https://github.com/JM-FRANK/obsidian-quick-ask/releases) · [Help & feedback](https://github.com/JM-FRANK/obsidian-quick-ask/issues)

<p align="center">
  <a href="ui-showcase.png"><img src="ui-showcase.png" width="560" alt="Quick Ask explains a selected term in context, with the original quote above the question." /></a>
</p>

## Why Quick Ask?

- **Less copying, more reading.** Drag a passage or file into the sidebar, or type `[[` to choose a file. Decide exactly which notes the conversation can access.
- **Pick up where you left off.** Conversations stay local. Original selections remain above their questions, with the full quote available on hover.
- **Your models, your way of asking.** Save multiple connections, use Responses or Chat Completions, and switch between Literature Reading, Study Quiz and your own roles for new conversations.
- **Bring more than text.** Drop in an image or paste a screenshot. Enable web search when you need online information.
- **Keep the conversation going.** Added files are tracked for changes; long conversations can compact model context while keeping the full local history.
- **At home in Obsidian.** Theme-aware bubbles, readable reasoning, adjustable text and a resizable input area.

No telemetry or developer-operated backend.

## Selection exploration

This fork adds a selection popup alongside the original sidebar. Select text in a Markdown note and click **Ask for AI** to explain it with the entire source note as context. Answers appear as Markdown and stream when the configured endpoint supports it.

Select text in an answer and choose **继续解释** (Continue explaining), enter a follow-up, or choose one of the model-generated exploration questions. New explanations are appended; columns wrap to a new row when needed. Drag the header to move the popup or drag its bottom-right corner to resize it. Click **保存** (Save) to create a Markdown record in the source note’s folder. [Read the selection exploration guide](docs/selection-exploration.md).

## Get started

Requires **Obsidian 1.13.7+ on desktop** and Node.js with npm to build this branch. The published upstream community plugin does not include these fork features.

1. Clone this fork and build the feature branch:

   ```sh
   git clone https://github.com/Vuiora/obsidian-quick-ask.git
   cd obsidian-quick-ask
   git checkout feature/selection-exploration
   npm ci
   npm run build
   ```

2. Copy the generated `main.js`, `manifest.json`, and `styles.css` from the repository root into `<vault>/.obsidian/plugins/quick-ask/`, creating the directory if needed. Enable or reload **Quick Ask** in Obsidian. Keep any existing `data.json` and session files.
3. Open **Quick Ask → Model connections**, configure your Base URL and named API secret, and select a model and protocol. Select note text and click **Ask for AI**, or use the sidebar.

Connection/model and role changes apply to **new conversations**. Use your own provider API access; model/search fees are separate from the free plugin. Mobile and PDF input are not supported.

[Manual installation and full setup →](docs/user-guide.md#installation)

## Explore

- [User guide](docs/user-guide.md) — model connections, roles, reasoning, images, search, compaction and backups.
- [Provider search setup](docs/native-search.md) — supported endpoints and credentials.
- [Changelog](CHANGELOG.md) — changes included in each version.

## Your data

History is stored locally. Submitting a question sends its selected context to your configured provider; model discovery and enabled search also make network requests. The popup sends the complete source note to your configured provider, along with the selected text and relevant parent answer. Clicking **保存** (Save) creates a new Markdown file in the source note’s folder without overwriting an existing file.

Read the [network, costs and privacy details](docs/user-guide.md#accounts-costs-and-network-use), including what image exports contain and how cached files are retained.

## Help & contribute

Questions, bugs or ideas? [Open an issue](https://github.com/JM-FRANK/obsidian-quick-ask/issues). Include versions and reproduction steps; for layout issues, add your theme and a screenshot. Keep API keys and private notes out of reports.

For local builds and contributions, see the [development guide](docs/user-guide.md#development) and [maintainer workflow](docs/maintaining.md).

## License

Copyright 2026 **FRANK-SMITH** · [Apache License 2.0](LICENSE) · [NOTICE](NOTICE). Dependency licenses are included in `main.js` and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
