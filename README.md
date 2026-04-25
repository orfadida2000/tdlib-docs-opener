# TDLib Docs Opener

A small custom VS Code extension that opens TDLib function documentation from selected text.

The extension reads the selected text in the active editor, tries to match it against the list of TDLib functions documented under `td_api::Function`, and opens the matching documentation page inside a VS Code tab using VS Code’s integrated browser.

## Command

The extension contributes one command:

```text
TDLib Docs: Open Function Documentation
```

Command ID:

```text
tdlibDocs.openFunctionDocs
```

## Behavior

When the command runs:

1. The extension fetches the TDLib function list from:

   ```text
   https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1_function.html
   ```

2. It extracts all function names from the `Inherited by ...` paragraph.

3. It checks the current selected text against the extracted TDLib function names.

4. If there is an exact normalized match, it opens the matching documentation page.

5. If there is no match, or if the selected text is empty, it opens a filterable QuickPick list.

6. The user can type inside the QuickPick to filter the valid TDLib function names.

7. Only one of the predefined TDLib function names can be selected.

## Matching rules

Matching is normalized.

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

## Installation for local development

Install dependencies:

```bash
npm install
```

Package the extension:

```bash
npm run package
```

This creates a `.vsix` file, for example:

```text
tdlib-docs-opener-1.0.0.vsix
```

Install it locally:

```bash
code --install-extension tdlib-docs-opener-1.0.0.vsix --force
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

## Notes

This extension is currently intended for local/private VSIX installation.

If `package.json` uses:

```json
"private": true
```

then npm refuses accidental publication with `npm publish`.

This does not prevent:

- creating a `.vsix`
- installing the extension locally
- using the extension in VS Code

For npm publishing, remove `"private": true` and make sure the package name/version are valid and available.

## Repository

[GitHub repository](https://github.com/orfadida2000/tdlib-docs-opener)

## License

MIT.<br>
See **[LICENSE](LICENSE)** for details.

## Author

- **Name:** Or Fadida
- **Email:** [or@fadida.net](mailto:or@fadida.net)
- **GitHub:** [orfadida2000](https://github.com/orfadida2000)
