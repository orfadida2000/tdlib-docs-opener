const vscode = require("vscode");
const cheerio = require("cheerio");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const COMMAND_ID = "tdlibDocs.openFunctionDocs";

const BASE_DOCS_URL = "https://core.telegram.org/tdlib/docs/";
const FUNCTION_CLASS_URL = new URL(
  "classtd_1_1td__api_1_1_function.html",
  BASE_DOCS_URL
).toString();

const MAX_DESCRIPTION_FETCH_CONCURRENCY = 8;

let functionIndexPromise = undefined;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  vscode.window.showInformationMessage("TDLib Docs Opener activated");

  const disposable = vscode.commands.registerCommand(COMMAND_ID, async (rawCandidate) => {
    await openTdlibFunctionDocs(rawCandidate);
  });

  context.subscriptions.push(disposable);
}

/**
 * @returns {void}
 */
function deactivate() {}

/**
 * @param {unknown} rawCandidate
 * @returns {Promise<void>}
 */
async function openTdlibFunctionDocs(rawCandidate) {
  try {
    const functionIndex = await getFunctionIndex();

    if (functionIndex.targets.length === 0) {
      await vscode.window.showErrorMessage("No TDLib function targets were found.");
      return;
    }

    const rawInput = typeof rawCandidate === "string" ? rawCandidate : getSelectedText();
    const normalizedInput = normalizeFunctionName(rawInput);

    const directTarget = normalizedInput
      ? functionIndex.targetByNormalizedName.get(normalizedInput)
      : undefined;

    if (directTarget) {
      await openUrlInIntegratedBrowser(directTarget.url);
      return;
    }

    const pickedTarget = await pickFunctionTarget(functionIndex.targets, normalizedInput);

    if (!pickedTarget) {
      return;
    }

    await openUrlInIntegratedBrowser(pickedTarget.url);
  } catch (error) {
    await vscode.window.showErrorMessage(`TDLib Docs failed: ${getErrorMessage(error)}`);
  }
}

/**
 * @returns {Promise<TdlibFunctionIndex>}
 */
async function getFunctionIndex() {
  if (!functionIndexPromise) {
    functionIndexPromise = loadFunctionIndex();
  }

  try {
    return await functionIndexPromise;
  } catch (error) {
    functionIndexPromise = undefined;
    throw error;
  }
}

/**
 * @returns {Promise<TdlibFunctionIndex>}
 */
async function loadFunctionIndex() {
  const html = await fetchText(FUNCTION_CLASS_URL);
  const $ = cheerio.load(html);

  const inheritedParagraph = $("body div.contents > p")
  .filter((_, element) => normalizeWhitespace($(element).text()).startsWith("Inherited by "))
  .first();

  if (inheritedParagraph.length === 0) {
    throw new Error("Could not find the TDLib 'Inherited by' paragraph.");
  }

  const targets = [];
  const targetByNormalizedName = new Map();

  inheritedParagraph.find("a.el").each((_, anchor) => {
    const name = normalizeWhitespace($(anchor).text());
    const href = $(anchor).attr("href");

    if (!name || !href) {
      return;
    }

    const normalizedName = normalizeFunctionName(name);

    if (!normalizedName) {
      return;
    }

    if (targetByNormalizedName.has(normalizedName)) {
      const existingTarget = targetByNormalizedName.get(normalizedName);

      throw new Error(
        `Duplicate normalized TDLib function name "${normalizedName}" for ` +
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
 * @param {Array<TdlibFunctionTarget>} targets
 * @param {string} initialValue
 * @returns {Promise<TdlibFunctionTarget | undefined>}
 */
function pickFunctionTarget(targets, initialValue) {
  const quickPick = vscode.window.createQuickPick();

  quickPick.title = "Open TDLib function documentation";
  quickPick.placeholder = "Type to filter TDLib function names";
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
 * @param {Array<TdlibFunctionTarget>} targets
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
 * @param {TdlibFunctionTarget} target
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
 * @param {Array<TdlibFunctionTarget>} targets
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
 * Normalizes both user-provided input and real TDLib function names for matching.
 *
 * Examples:
 *   "sendMessage"    -> "sendmessage"
 *   "send_message"   -> "sendmessage"
 *   " SEND_MESSAGE " -> "sendmessage"
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeFunctionName(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("_", "")
    .toLowerCase();
}

/**
 * Normalizes general extracted text.
 *
 * This is used for HTML text content and descriptions, not for function-name matching.
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
 * @typedef {object} TdlibFunctionIndex
 * @property {Array<TdlibFunctionTarget>} targets
 * @property {Map<string, TdlibFunctionTarget>} targetByNormalizedName
 */

/**
 * @typedef {object} TdlibFunctionTarget
 * @property {string} name
 * @property {string} normalizedName
 * @property {string} href
 * @property {string} url
 * @property {string | undefined} description
 * @property {boolean} descriptionLoaded
 */

/**
 * @typedef {vscode.QuickPickItem & { target: TdlibFunctionTarget }} TdlibQuickPickItem
 */
