const vscode = require("vscode");
const cheerio = require("cheerio");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const OPEN_ENTITY_DOCS_COMMAND_ID = "tdlibDocs.openEntityDocs";
const OPEN_FUNCTIONS_INDEX_COMMAND_ID = "tdlibDocs.openFunctionsIndex";
const OPEN_CLASSES_INDEX_COMMAND_ID = "tdlibDocs.openClassesIndex";
const OPEN_DOCS_OVERVIEW_COMMAND_ID = "tdlibDocs.openDocsOverview";
const OPEN_TDLIB_OVERVIEW_COMMAND_ID = "tdlibDocs.openTdlibOverview";

const TDLIB_OVERVIEW_URL = "https://core.telegram.org/tdlib/";
const BASE_DOCS_URL = new URL(
  "docs/",
  TDLIB_OVERVIEW_URL
).toString();
const FUNCTIONS_INDEX_URL = new URL(
  "classtd_1_1td__api_1_1_function.html",
  BASE_DOCS_URL
).toString();
const CLASSES_INDEX_URL = new URL(
  "classes.html",
  BASE_DOCS_URL
).toString();


const MAX_DESCRIPTION_FETCH_CONCURRENCY = 8;

let entityIndexPromise = undefined;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const openEntityDocsDisposable = vscode.commands.registerCommand(
    OPEN_ENTITY_DOCS_COMMAND_ID,
    async (rawCandidate) => {
      await openTdlibEntityDocs(rawCandidate);
    }
  );
  const openFunctionsIndexDisposable = vscode.commands.registerCommand(
    OPEN_FUNCTIONS_INDEX_COMMAND_ID,
    async () => {
      await openUrlInIntegratedBrowser(FUNCTIONS_INDEX_URL);
    }
  );
  const openClassesIndexDisposable = vscode.commands.registerCommand(
    OPEN_CLASSES_INDEX_COMMAND_ID,
    async () => {
      await openUrlInIntegratedBrowser(CLASSES_INDEX_URL);
    }
  );
  const openDocsOverviewDisposable = vscode.commands.registerCommand(
    OPEN_DOCS_OVERVIEW_COMMAND_ID,
    async () => {
      await openUrlInIntegratedBrowser(BASE_DOCS_URL);
    }
  );
  const openTdlibOverviewDisposable = vscode.commands.registerCommand(
    OPEN_TDLIB_OVERVIEW_COMMAND_ID,
    async () => {
      await openUrlInIntegratedBrowser(TDLIB_OVERVIEW_URL);
    }
  );
  context.subscriptions.push(
    openEntityDocsDisposable,
    openFunctionsIndexDisposable,
    openClassesIndexDisposable,
    openDocsOverviewDisposable,
    openTdlibOverviewDisposable
  );
}

/**
 * @returns {void}
 */
function deactivate() {}

/**
 * @param {unknown} rawCandidate
 * @returns {Promise<void>}
 */
async function openTdlibEntityDocs(rawCandidate) {
  try {
    const entityIndex = await getEntityIndex();

    if (entityIndex.targets.length === 0) {
      await vscode.window.showErrorMessage("No TDLib entity targets were found.");
      return;
    }

    const rawInput = typeof rawCandidate === "string" ? rawCandidate : getSelectedText();
    const normalizedInput = normalizeEntityName(rawInput);

    const directTarget = normalizedInput
      ? entityIndex.targetByNormalizedName.get(normalizedInput)
      : undefined;

    if (directTarget) {
      await openUrlInIntegratedBrowser(directTarget.url);
      return;
    }

    const pickedTarget = await pickEntityTarget(entityIndex.targets, normalizedInput);

    if (!pickedTarget) {
      return;
    }

    await openUrlInIntegratedBrowser(pickedTarget.url);
  } catch (error) {
    await vscode.window.showErrorMessage(`TDLib Docs failed: ${getErrorMessage(error)}`);
  }
}

/**
 * @returns {Promise<TdlibEntityIndex>}
 */
async function getEntityIndex() {
  if (!entityIndexPromise) {
    entityIndexPromise = loadEntityIndex();
  }

  try {
    return await entityIndexPromise;
  } catch (error) {
    entityIndexPromise = undefined;
    throw error;
  }
}

/**
 * @returns {Promise<TdlibEntityIndex>}
 */
async function loadEntityIndex() {
  const html = await fetchText(CLASSES_INDEX_URL);
  const $ = cheerio.load(html);

  const table = $("body div.contents table.classindex").first();

  if (table.length === 0) {
    throw new Error("Could not find the TDLib classes index table.");
  }

  const rows = table.children("tbody").children("tr").add(table.children("tr"));

  if (rows.length === 0) {
    throw new Error("Could not find any rows in the TDLib classes index table.");
  }

  const targets = [];
  const targetByNormalizedName = new Map();
  
  rows.each((_, row) => {
    const anchor = $(row)
        .children("td")
        .find("a.el")
        .first();

    if (anchor.length === 0) {
      return;
    }

    const name = normalizeWhitespace(anchor.text());
    const href = anchor.attr("href");

    if (!name || !href) {
      return;
    }

    const normalizedName = normalizeEntityName(name);

    if (!normalizedName) {
      return;
    }

    if (targetByNormalizedName.has(normalizedName)) {
      const existingTarget = targetByNormalizedName.get(normalizedName);

      throw new Error(
        `Duplicate normalized TDLib entity name "${normalizedName}" for ` +
          `"${existingTarget.name}" and "${name}".`
      );
    }

    const target = {
      name,
      normalizedName,
      href,
      url: new URL(href, BASE_DOCS_URL).toString(),
      description: undefined,
      descriptionLoaded: false,
    };

    targets.push(target);
    targetByNormalizedName.set(normalizedName, target);
  });

  targets.sort((left, right) => left.name.localeCompare(right.name));

  return {
    targets,
    targetByNormalizedName,
  };
}

/**
 * @param {Array<TdlibEntityTarget>} targets
 * @param {string} initialValue
 * @returns {Promise<TdlibEntityTarget | undefined>}
 */
function pickEntityTarget(targets, initialValue) {
  const quickPick = vscode.window.createQuickPick();

  quickPick.title = "Open TDLib entity documentation";
  quickPick.placeholder = "Type to filter TDLib entity names";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.items = createQuickPickItems(targets);
  quickPick.value = initialValue;
  quickPick.busy = true;

  let isClosed = false;

  const descriptionLoadingPromise = loadDescriptionsIntoQuickPick(
    targets,
    quickPick,
    () => isClosed
  );

  return new Promise((resolve) => {
    quickPick.onDidAccept(async () => {
      const selectedItem = quickPick.selectedItems[0];

      if (!selectedItem) {
        await vscode.window.showWarningMessage("Choose one TDLib function from the list.");
        return;
      }

      isClosed = true;
      quickPick.hide();
      resolve(selectedItem.target);
    });

    quickPick.onDidHide(() => {
      isClosed = true;
      quickPick.dispose();
      resolve(undefined);
    });

    descriptionLoadingPromise.finally(() => {
      if (!isClosed) {
        quickPick.busy = false;
      }
    });

    quickPick.show();
  });
}

/**
 * @param {Array<TdlibEntityTarget>} targets
 * @param {vscode.QuickPick<TdlibQuickPickItem>} quickPick
 * @param {() => boolean} isClosed
 * @returns {Promise<void>}
 */
async function loadDescriptionsIntoQuickPick(targets, quickPick, isClosed) {
  let nextIndex = 0;
  let completedSinceLastRefresh = 0;

  async function worker() {
    while (!isClosed()) {
      const target = targets[nextIndex];
      nextIndex += 1;

      if (!target) {
        return;
      }

      if (!target.descriptionLoaded) {
        await loadTargetDescription(target);
      }

      completedSinceLastRefresh += 1;

      if (!isClosed() && completedSinceLastRefresh >= 20) {
        completedSinceLastRefresh = 0;
        quickPick.items = createQuickPickItems(targets);
      }
    }
  }

  const workers = [];

  for (let i = 0; i < MAX_DESCRIPTION_FETCH_CONCURRENCY; i += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  if (!isClosed()) {
    quickPick.items = createQuickPickItems(targets);
  }
}

/**
 * @param {TdlibEntityTarget} target
 * @returns {Promise<void>}
 */
async function loadTargetDescription(target) {
  try {
    const html = await fetchText(target.url);
    const $ = cheerio.load(html);

    const firstParagraphText = normalizeWhitespace(
      $("body div.contents div.textblock > p").first().text()
    );

    target.description = firstParagraphText || undefined;
  } catch {
    target.description = undefined;
  } finally {
    target.descriptionLoaded = true;
  }
}

/**
 * @param {Array<TdlibEntityTarget>} targets
 * @returns {Array<TdlibQuickPickItem>}
 */
function createQuickPickItems(targets) {
  return targets.map((target) => ({
    label: target.name,
    description: target.description,
    detail: target.url,
    target,
  }));
}

/**
 * @returns {string}
 */
function getSelectedText() {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.selection.isEmpty) {
    return "";
  }

  return editor.document.getText(editor.selection);
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
async function openUrlInIntegratedBrowser(url) {
  const commands = await vscode.commands.getCommands(true);

  if (commands.includes("workbench.action.browser.open")) {
    await vscode.commands.executeCommand("workbench.action.browser.open", url);
    return;
  }

  if (commands.includes("simpleBrowser.api.open")) {
    await vscode.commands.executeCommand("simpleBrowser.api.open", url);
    return;
  }

  await vscode.window.showErrorMessage(
    "No VS Code integrated browser command is available in this VS Code version."
  );
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;

    const request = client.get(
      parsedUrl,
      {
        headers: {
          "User-Agent": "VSCode TDLib Docs Opener",
          "Accept": "text/html,application/xhtml+xml",
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          const redirectedUrl = new URL(response.headers.location, parsedUrl).toString();
          response.resume();
          resolve(fetchText(redirectedUrl));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`HTTP ${statusCode} for ${url}`));
          return;
        }

        response.setEncoding("utf8");

        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          resolve(body);
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(30_000, () => {
      request.destroy(new Error(`Request timed out for ${url}`));
    });
  });
}

/**
 * Normalizes both user-provided input and real TDLib entity names for matching.
 *
 * Examples:
 *   "sendMessage"    -> "sendmessage"
 *   "send_message"   -> "sendmessage"
 *   " SEND_MESSAGE " -> "sendmessage"
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEntityName(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("_", "")
    .toLowerCase();
}

/**
 * Normalizes general extracted text.
 *
 * This is used for HTML text content and descriptions, not for entity-name matching.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

module.exports = {
  activate,
  deactivate,
};

/**
 * @typedef {object} TdlibEntityIndex
 * @property {Array<TdlibEntityTarget>} targets
 * @property {Map<string, TdlibEntityTarget>} targetByNormalizedName
 */

/**
 * @typedef {object} TdlibEntityTarget
 * @property {string} name
 * @property {string} normalizedName
 * @property {string} href
 * @property {string} url
 * @property {string | undefined} description
 * @property {boolean} descriptionLoaded
 */

/**
 * @typedef {vscode.QuickPickItem & { target: TdlibEntityTarget }} TdlibQuickPickItem
 */
