# TDLib Docs Opener

A VS Code extension that adds TDLib documentation navigation commands.

The extension provides commands for opening:

- documentation for a specific TDLib entity, based on selected text
- the TDLib functions index page
- the TDLib classes index page
- the TDLib generated documentation overview page
- the main TDLib overview page

For opening the documentation of a TDLib entity, the extension can use the selected text in the active editor as the entity-name candidate.

Pages are opened inside a VS Code tab using VS Code’s integrated browser.

## Commands

The extension contributes these commands:

```text
TDLib Docs: Open Entity Documentation
TDLib Docs: Open Functions Index
TDLib Docs: Open Classes Index
TDLib Docs: Open Documentation Overview
TDLib Docs: Open TDLib Overview
```

Command IDs:

```text
tdlibDocs.openEntityDocs
tdlibDocs.openFunctionsIndex
tdlibDocs.openClassesIndex
tdlibDocs.openDocsOverview
tdlibDocs.openTdlibOverview
```

## Behavior

### Open Entity Documentation

When `TDLib Docs: Open Entity Documentation` runs:

1. The extension fetches the TDLib entity list from:

   ```text
   https://core.telegram.org/tdlib/docs/classes.html
   ```

2. It extracts all entity names from the text of all li elements inside the page that represent TDLib entities.

3. It checks the current selected text against the extracted TDLib entity names.

4. If there is an exact normalized match, it opens the matching documentation page.

5. If there is no match, or if the selected text is empty, it opens a filterable QuickPick list.

6. The user can type inside the QuickPick to filter the valid TDLib entity names.

7. Only one of the predefined TDLib entity names can be selected.

### Open Functions Index

Opens:

```text
https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1_function.html
```
### Open Classes Index

Opens:

```text
https://core.telegram.org/tdlib/docs/classes.html
```

### Open Documentation Overview

Opens:

```text
https://core.telegram.org/tdlib/docs/
```

### Open TDLib Overview

Opens:

```text
https://core.telegram.org/tdlib/
```

## Matching rules

Function-name matching is normalized.

The selected/provided text is normalized by:

- trimming leading and trailing whitespace
- removing underscores
- converting to lowercase

Examples:

```text
sendMessage    -> sendmessage
SEND_MESSAGE   -> sendmessage
 send_message  -> sendmessage
```

So all of these can match the TDLib function:

```text
sendMessage
```

The normalized text is used only for matching.  
The opened URL always comes from the real TDLib documentation anchor.

## Descriptions

When the QuickPick opens, the extension fetches each TDLib function page and extracts the first paragraph inside:

```html
<body>
  <div class="contents">
    <div class="textblock">
      <p>...</p>
    </div>
  </div>
</body>
```

That first paragraph is shown as the QuickPick item description.

Descriptions are cached in memory for the current VS Code extension-host session.

## Caching

The extension uses in-memory caching.

During the same VS Code session:

- the main TDLib function list is fetched once
- each loaded function description is fetched once
- repeated command runs reuse the cached data

The cache resets when:

- VS Code restarts
- the window reloads
- the extension host restarts
- the extension is reinstalled or updated

The direct-open commands do not need the function cache.

## Installation for local development

### Prerequisites

Install Node.js and npm.

This project is intended to be built with Node.js `>=18.17.0`. The recommended version is the one specified in `.nvmrc`.

If you use `nvm`, run:

```bash
nvm use
```

If the required Node version is not installed yet, install it first. For example, if `.nvmrc` contains `24`:

```bash
nvm install 24
nvm use 24
```

Check the active versions:

```bash
node -v
npm -v
```

### Install dependencies

```bash
npm install
```

### Package the extension

```bash
npm run package
```

This creates a `.vsix` file, for example:

```text
tdlib-docs-opener-1.1.0.vsix
```

### Install the extension locally

From Windows PowerShell, install the generated VSIX into the local VS Code UI side:

```powershell
code --install-extension .\tdlib-docs-opener-1.1.0.vsix --force
```

If the VSIX is inside WSL, use a Windows-accessible path, for example:

```powershell
code --install-extension "\\wsl.localhost\Ubuntu\home\user\tools\vscode\tdlib-docs-opener\tdlib-docs-opener-1.1.0.vsix" --force
```

Reload VS Code:

```text
Developer: Reload Window
```
## Testing

Open any file and select text such as:

```text
sendMessage
```

or:

```text
send_message
```

Then run:

```text
TDLib Docs: Open Function Documentation
```

Expected result: the documentation page for `sendMessage` opens inside a VS Code tab.

You can also run:

```text
TDLib Docs: Open Functions Index
TDLib Docs: Open Docs Index
TDLib Docs: Open TDLib Overview
```

to open the corresponding TDLib documentation pages directly.

## Repository

[GitHub repository](https://github.com/orfadida2000/tdlib-docs-opener)

## License

MIT.<br>
See **[LICENSE](LICENSE)** for details.

## Author

- **Name:** Or Fadida
- **Email:** [or@fadida.net](mailto:or@fadida.net)
- **GitHub:** [orfadida2000](https://github.com/orfadida2000)
