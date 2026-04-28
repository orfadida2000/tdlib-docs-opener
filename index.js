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
const BASE_DOCS_URL = new URL("docs/", TDLIB_OVERVIEW_URL).toString();
const FUNCTIONS_INDEX_URL = new URL(
  "classtd_1_1td__api_1_1_function.html",
  BASE_DOCS_URL
).toString();
const CLASSES_INDEX_URL = new URL("classes.html", BASE_DOCS_URL).toString();
const FILE_MEMBERS_INDEX_URL = new URL("globals.html", BASE_DOCS_URL).toString();

const MAX_DESCRIPTION_FETCH_CONCURRENCY = 8;
const QUICK_PICK_REFRESH_INTERVAL = 20;
const MAX_REDIRECTS = 5;

let entityIndexPromise = undefined;
let activeQuickPickState = undefined;

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

    startDescriptionLoading(entityIndex);

    const rawInput = typeof rawCandidate === "string" ? rawCandidate : getSelectedText();
    const normalizedInput = normalizeEntityName(rawInput);

    const directTarget = normalizedInput
      ? entityIndex.targetByNormalizedName.get(normalizedInput)
      : undefined;

    if (directTarget) {
      await openUrlInIntegratedBrowser(directTarget.url);
      return;
    }

    const pickedTarget = await pickEntityTarget(entityIndex, normalizedInput);

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
  let html = await fetchText(CLASSES_INDEX_URL);
  let $ = cheerio.load(html);

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
    const anchor = $(row).children("td").find("a.el").first();

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

      checkDescription: true,
      description: undefined,
      descriptionLoaded: false,
      descriptionLoading: false,
      descriptionLoadAttempted: false,
    };

    targets.push(target);
    targetByNormalizedName.set(normalizedName, target);
  });

  html = await fetchText(FILE_MEMBERS_INDEX_URL);
  $ = cheerio.load(html);

  const ul = $("body div.contents ul").first();

  if (ul.length === 0) {
    throw new Error("Could not find the TDLib file members index.");
  }

  const lis = ul.children("li");

  if (lis.length === 0) {
    throw new Error("Could not find any list items in the TDLib file members index.");
  }

  lis.each((_, li) => {
    // Example of such list item structure (the parantheses are optional, some items may not have them):
    // <li>
    //   "td_receive() : "
    //   <a class="el" href="td__json__client_8h.html#a62715bea8e41a554d1bac763c187b662">td_json_client.h</a>
    // </li>

    const anchor = $(li).find("a.el").first();

    if (anchor.length === 0) {
      return;
    }

    const li_text = $(li).text();

    const match = li_text.match(/^\s*([^()]+)(?:\(\))?\s*:\s*.*\s*$/);
    const capturedName = match ? match[1] : li_text;

    const name = normalizeWhitespace(capturedName);
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

      checkDescription: false,
      description: undefined,
      descriptionLoaded: false,
      descriptionLoading: false,
      descriptionLoadAttempted: false,
    };

    targets.push(target);
    targetByNormalizedName.set(normalizedName, target);
  });

  targets.sort((left, right) => left.name.localeCompare(right.name));

  const quickPickItems = createQuickPickItems(targets);

  return {
    targets,
    targetByNormalizedName,
    quickPickItems,
    descriptionNextIndex: 0,
    descriptionLoadingPromise: undefined,
  };
}

/**
 * @param {TdlibEntityIndex} entityIndex
 * @returns {void}
 */
function startDescriptionLoading(entityIndex) {
  if (entityIndex.descriptionLoadingPromise) {
    return;
  }

  entityIndex.descriptionLoadingPromise = runDescriptionWorkers(entityIndex).catch((error) => {
    console.error("TDLib Docs background description loading failed:", error);
  });
}

/**
 * @param {TdlibEntityIndex} entityIndex
 * @returns {Promise<void>}
 */
async function runDescriptionWorkers(entityIndex) {
  let completedSinceLastRefresh = 0;

  async function worker() {
    while (true) {
      const target = getNextDescriptionTarget(entityIndex);

      if (!target) {
        return;
      }

      await loadTargetDescription(target);

      completedSinceLastRefresh += 1;

      if (completedSinceLastRefresh >= QUICK_PICK_REFRESH_INTERVAL) {
        completedSinceLastRefresh = 0;
        refreshActiveQuickPick(entityIndex);
      }
    }
  }

  const workerCount = Math.min(MAX_DESCRIPTION_FETCH_CONCURRENCY, entityIndex.targets.length);
  const workers = [];

  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  refreshActiveQuickPick(entityIndex);
}

/**
 * @param {TdlibEntityIndex} entityIndex
 * @returns {TdlibEntityTarget | undefined}
 */
function getNextDescriptionTarget(entityIndex) {
  while (entityIndex.descriptionNextIndex < entityIndex.targets.length) {
    const target = entityIndex.targets[entityIndex.descriptionNextIndex];
    entityIndex.descriptionNextIndex += 1;

    if (!target.descriptionLoadAttempted && !target.descriptionLoading) {
      target.descriptionLoading = true;
      return target;
    }
  }

  return undefined;
}

/**
 * @param {TdlibEntityTarget} target
 * @returns {Promise<void>}
 */
async function loadTargetDescription(target) {
  if (!target.checkDescription) {
    target.description = undefined;
    target.descriptionLoaded = false;
    target.descriptionLoading = false;
    target.descriptionLoadAttempted = true;
    return;
  }

  try {
    const html = await fetchText(target.url);
    const $ = cheerio.load(html);

    const firstParagraphText = normalizeWhitespace(
      $("body div.contents div.textblock > p").first().text()
    );

    target.description = firstParagraphText || undefined;
    target.descriptionLoaded = Boolean(firstParagraphText);
  } catch (error) {
    console.error(`Failed to load description for ${target.name}:`, error);

    target.description = undefined;
    target.descriptionLoaded = false;
  } finally {
    target.descriptionLoading = false;
    target.descriptionLoadAttempted = true;
  }
}

/**
 * @param {TdlibEntityIndex} entityIndex
 * @param {string} initialValue
 * @returns {Promise<TdlibEntityTarget | undefined>}
 */
function pickEntityTarget(entityIndex, initialValue) {
  const quickPick = vscode.window.createQuickPick();

  quickPick.title = "Open TDLib entity documentation";
  quickPick.placeholder = "Type to filter TDLib entity names";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.value = initialValue;

  syncQuickPickItemsFromTargets(entityIndex);

  quickPick.items = [...entityIndex.quickPickItems];
  quickPick.busy = !areAllDescriptionsAttempted(entityIndex);

  activeQuickPickState = {
    quickPick,
    entityIndex,
  };

  return new Promise((resolve) => {
    let didResolve = false;

    function finish(result) {
      if (didResolve) {
        return;
      }

      didResolve = true;

      if (activeQuickPickState?.quickPick === quickPick) {
        activeQuickPickState = undefined;
      }

      quickPick.dispose();
      resolve(result);
    }

    quickPick.onDidAccept(async () => {
      const selectedItem = quickPick.selectedItems[0];

      if (!selectedItem) {
        await vscode.window.showWarningMessage("Choose one TDLib entity from the list.");
        return;
      }

      finish(selectedItem.target);
    });

    quickPick.onDidHide(() => {
      finish(undefined);
    });

    quickPick.show();
  });
}

/**
 * @param {TdlibEntityIndex} entityIndex
 * @returns {void}
 */
function refreshActiveQuickPick(entityIndex) {
  if (!activeQuickPickState) {
    return;
  }

  if (activeQuickPickState.entityIndex !== entityIndex) {
    return;
  }

  syncQuickPickItemsFromTargets(entityIndex);

  activeQuickPickState.quickPick.items = [...entityIndex.quickPickItems];
  activeQuickPickState.quickPick.busy = !areAllDescriptionsAttempted(entityIndex);
}

/**
 * @param {TdlibEntityIndex} entityIndex
 * @returns {void}
 */
function syncQuickPickItemsFromTargets(entityIndex) {
  for (const item of entityIndex.quickPickItems) {
    if (item.detail !== item.target.description) {
      item.detail = item.target.description;
    }
  }
}

/**
 * @param {TdlibEntityIndex} entityIndex
 * @returns {boolean}
 */
function areAllDescriptionsAttempted(entityIndex) {
  return entityIndex.targets.every((target) => target.descriptionLoadAttempted);
}

/**
 * @param {Array<TdlibEntityTarget>} targets
 * @returns {Array<TdlibQuickPickItem>}
 */
function createQuickPickItems(targets) {
  return targets.map((target) => ({
    label: target.name,
    description: target.url,
    detail: target.description,
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
 * @param {number} redirectCount
 * @returns {Promise<string>}
 */
function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;

    const request = client.get(
      parsedUrl,
      {
        headers: {
          "User-Agent": "VSCode TDLib Docs Opener",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          const redirectedUrl = new URL(response.headers.location, parsedUrl).toString();
          response.resume();
          resolve(fetchText(redirectedUrl, redirectCount + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();

          reject(new Error(`HTTP ${statusCode} ${response.statusMessage ?? ""} for ${url}`));
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
 * @property {Array<TdlibQuickPickItem>} quickPickItems
 * @property {number} descriptionNextIndex
 * @property {Promise<void> | undefined} descriptionLoadingPromise
 */

/**
 * @typedef {object} TdlibEntityTarget
 * @property {string} name
 * @property {string} normalizedName
 * @property {string} href
 * @property {string} url
 * @property {string | undefined} description
 * @property {boolean} descriptionLoaded
 * @property {boolean} descriptionLoading
 * @property {boolean} descriptionLoadAttempted
 */

/**
 * @typedef {vscode.QuickPickItem & { target: TdlibEntityTarget }} TdlibQuickPickItem
 */

/**
 * @typedef {object} ActiveQuickPickState
 * @property {vscode.QuickPick<TdlibQuickPickItem>} quickPick
 * @property {TdlibEntityIndex} entityIndex
 */
