# Changelog

All notable changes to this extension will be documented in this file.

## [1.2.0] - 2026-04-27

### Added

- Added `TDLib Docs: Open Classes Index`.
- Added direct-open commands for common TDLib documentation pages:
  - `https://core.telegram.org/tdlib/docs/classes.html`

### Changed
- Renamed `TDLib Docs: Open Docs Index` to `TDLib Docs: Open Documentation Overview`, and updated the command id accordingly from `tdlibDocs.openDocsIndex` to `tdlibDocs.openDocsOverview`.
- Renamed `TDLib Docs: Open Functions Documentation` to `TDLib Docs: Open Entity Documentation`, and updated the command id accordingly from `tdlibDocs.openFunctionDocs` to `tdlibDocs.openEntityDocs`.
- The `TDLib Docs: Open Entity Documentation` command now supports opening the documentation for a selected entity (function or class) in the editor, instead of only functions, and the index source it uses for fetching the list of entities has changed from `https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1_function.html` to `https://core.telegram.org/tdlib/docs/classes.html`.
- The `TDLib Docs: Open Entity Documentation` command now also supports opening the documentation for a selected TDLib file member (taken from either `td_json_client.h` or `td_log.h`), it uses a different parsing strategy for fetching the list of file members (and their metadata), and it also uses a different index source which is `https://core.telegram.org/tdlib/docs/globals.html`.
- Updated the README to document all the changes above.

## [1.1.0] - 2026-04-25

### Added

- Added `TDLib Docs: Open Functions Index`.
- Added `TDLib Docs: Open Docs Index`.
- Added `TDLib Docs: Open TDLib Overview`.
- Added direct-open commands for common TDLib documentation pages:
  - `https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1_function.html`
  - `https://core.telegram.org/tdlib/docs/`
  - `https://core.telegram.org/tdlib/`

### Changed

- Updated the README to document all available TDLib documentation commands.

## [1.0.0] - 2026-04-24

### Added

- Added the `TDLib Docs: Open Function Documentation` command.
- Added support for opening TDLib function documentation inside a VS Code tab.
- Added parsing of TDLib function names from the `td_api::Function` documentation page.
- Added direct matching from selected editor text to TDLib function names.
- Added normalized matching:
  - trims leading/trailing whitespace
  - ignores case
  - removes underscores
- Added QuickPick fallback when selected text is empty or does not match a TDLib function.
- Added filterable QuickPick list of valid TDLib function names.
- Added per-function description extraction from the first paragraph of each TDLib function page.
- Added in-memory caching for:
  - the TDLib function list
  - loaded function descriptions
- Added fast direct lookup using a normalized-name `Map`.
- Added defensive detection for duplicate normalized TDLib function names.
- Added fallback from VS Code integrated browser command to Simple Browser command when available.
- Added a GitHub repository for source control and issue tracking.

### Notes

- This extension is currently intended for local/private VSIX installation.
- The cache is session-only and resets when the VS Code extension host restarts.
- Normalized matching is used only for lookup; opened URLs always come from parsed TDLib documentation anchors.
