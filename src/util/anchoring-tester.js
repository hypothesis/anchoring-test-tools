'use strict';

const puppeteer = require('puppeteer');

// List of console messages from the sidebar or parent frame to ignore.
const IGNORED_CONSOLE_MESSAGES = [
  // Unimportant warnings from PDF.js.
  '#page_of is undefined',
  '#thumb_page_title is undefined',

  // A warning about unknown feature flags in the Hypothesis client. We should
  // fix these.
  'looked up unknown feature',

  // PDF.js version info message.
  /PDF.js: [0-9.]+/,
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @typedef {Result}
 * @prop {number} annotationCount
 * @prop {number} orphanCount
 */

/**
 * Read the counts displayed on the "Annotations" and "Orphans" tabs in the
 * Hypothesis client's sidebar, or `null` if the counts are not visible.
 *
 * This is executed in the context of the Hypothesis client's sidebar. It cannot
 * have external dependencies.
 */
function getAnnotationTabCounts() {
  const tabsEl = document.querySelector('selection-tabs');
  if (!tabsEl) {
    return null;
  }

  const tabs = Array.from(document.querySelectorAll('.selection-tabs > a'));
  if (tabs.length === 0) {
    return null;
  }

  const tabCount = tabEl => {
    const countEl = tabEl.querySelector('.selection-tabs__count');
    if (!countEl) {
      return null;
    }
    return parseInt(countEl.textContent);
  };

  const annTab = tabs.find(tab => tab.textContent.includes('Annotations'));
  const annotationCount = tabCount(annTab);
  if (annotationCount == null) {
    return null;
  }

  const orphansTab = tabs.find(tab => tab.textContent.includes('Orphans'));
  const orphanCount = orphansTab ? tabCount(orphansTab) : 0;

  return {
    annotationCount,
    orphanCount,
  };
}

/**
 * Return the number of annotation highlights that exist in a document.
 *
 * This function is executed in the context of a page displaying content that
 * has been annotated. It cannot have external dependencies.
 */
function countHighlightsInPage() {
  // Fetch a jQuery data property associated with an element. This is
  // equivalent to doing `$(element).data(key)`.
  function getJQueryData(element, key) {
    const jqDataKey = Object.keys(element).find(key =>
      key.startsWith('jQuery')
    );
    if (!jqDataKey) {
      return null;
    }
    const jqData = element[jqDataKey];
    if (!jqData) {
      return null;
    }
    return jqData[key];
  }

  // Get the temporary local ID assigned to the annotation (the "tag") which
  // a highlight is associated with.
  function getAnnotationTag(highlight) {
    const annotation = getJQueryData(highlight, 'annotation');
    return annotation ? annotation.$tag : null;
  }

  // Find all the rendered highlight spans in the DOM. There may be multiple
  // highlight elements per annotation, or none if an annotation was not found.
  const highlights = Array.from(
    document.querySelectorAll('hypothesis-highlight')
  );

  // Get the associated local annotation IDs.
  const tags = highlights.map(getAnnotationTag).filter(tag => tag !== null);
  const uniqueTags = new Set(tags);

  return uniqueTags.size;
}

/**
 * Opens a URL in a browser with Hypothesis active and gathers statistics on
 * the results of anchoring.
 */
class AnchoringTester {
  constructor(config = { timing: true }) {
    /** @type {puppeteer.Browser} */
    this._browser = null;

    this._config = config;

    this._viaBaseUrl = 'https://via.hypothes.is';
  }

  /**
   * Open a URL in a browser with Hypothesis active and gather statistics on
   * anchoring results.
   *
   * Starts the browser if it is not already running.
   *
   * @param {string} url
   * @param {'via'|'via-pdfjs2'} mode - Mode to use to activate Hypothesis
   * @return {Result}
   */
  async runTest(url, mode) {
    const browser = await this._init();

    const proxyUrl = this._getProxyUrl(url, mode);

    // Open a blank page for testing.
    const page = await browser.newPage();

    // Log any unexpected output from the page.
    page.on('console', msg => {
      if (IGNORED_CONSOLE_MESSAGES.some(pattern => msg.text().match(pattern))) {
        return;
      }
      console.log(`console ${msg.type()}: ${msg.text()}`);
    });

    // Navigate to the proxy URL and read the anchoring results as displayed
    // in the sidebar.
    console.log(`Loading proxy URL ${proxyUrl}`);
    await page.goto(proxyUrl);
    const anchorResults = await this._getAnchorResults(page);
    await page.close();

    return anchorResults;
  }

  /**
   * Shut down the browser.
   */
  async close() {
    if (this._browser) {
      await this._browser.close();
    }
  }

  /**
   * Wait for anchoring to complete and return the count of annotations and
   * orphans.
   *
   * @param {puppeteer.Page} page
   */
  async _getAnchorResults(page) {
    const sidebar = await page.waitForSelector(
      'iframe[name="hyp_sidebar_frame"]'
    );
    const sidebarFrame = await sidebar.contentFrame();

    const startTime = Date.now();

    // Maximum amount of time to wait for anchoring to complete.
    const timeout = 30000;

    // Maximum amount of time to wait for anchoring to complete once at least
    // one highlight has appeared in the page.
    //
    // This is shorter to avoid waiting too long once the client has loaded if
    // the eventual number of highlights never matches the number of annotations.
    const highlightChangeTimeout = 5000;

    // Counts displayed on the tabs in the sidebar.
    let tabCounts;

    // Number of annotations which have at least one highlight in the page.
    let highlightCount;

    let prevHighlightCountChangeTime = Date.now();

    while (
      Date.now() - startTime < timeout &&
      // If `annotationCount` is null then the annotation counts have not yet
      // been displayed on the tabs. If there are fewer highlights in the page
      // than annotations then anchoring is still in progress.
      (tabCounts == null || highlightCount < tabCounts.annotationCount)
    ) {
      await delay(50);

      let prevHighlightCount = highlightCount;

      [tabCounts, highlightCount] = await Promise.all([
        sidebarFrame.evaluate(getAnnotationTabCounts),
        page.evaluate(countHighlightsInPage),
      ]);

      if (highlightCount > 0) {
        if (prevHighlightCount !== highlightCount) {
          prevHighlightCountChangeTime = Date.now();
        } else if (
          Date.now() - prevHighlightCountChangeTime >
          highlightChangeTimeout
        ) {
          console.log(
            `Highlight count stopped changing after ${highlightChangeTimeout} ms`
          );
          break;
        }
      }
    }
    const anchorTime = Date.now() - startTime;

    const { annotationCount = null, orphanCount = null } = tabCounts || {};

    if (anchorTime > timeout) {
      console.log(
        `Failed to count annotations in page in ${timeout} ms. Annotation tab: ${annotationCount}. Orphan tab: ${orphanCount}. Highlights: ${highlightCount}`
      );
    } else {
      console.log(
        `Anchoring completed with ${annotationCount} annotations and ${orphanCount} orphans`
      );
    }

    const result = {
      annotationCount,
      highlightCount,
      orphanCount,
    };

    if (this._config.timing) {
      result.anchorTime = anchorTime;
    }

    return result;
  }

  _getProxyUrl(url, mode) {
    let viaUrl = `${this._viaBaseUrl}/${url}`;
    if (mode.split('-').includes('pdfjs2')) {
      const parsedUrl = new URL(viaUrl);
      parsedUrl.searchParams.append('via.features', 'pdfjs2');
      viaUrl = parsedUrl.href;
    }
    return viaUrl;
  }

  async _init() {
    if (this._browser) {
      return this._browser;
    }
    this._browser = await puppeteer.launch();
    return this._browser;
  }
}

module.exports = {
  AnchoringTester,
};
