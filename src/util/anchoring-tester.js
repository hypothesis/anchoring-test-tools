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

/**
 * @typedef {Result}
 * @prop {number} annotationCount
 * @prop {number} orphanCount
 */

/**
 * Read the counts displayed on the "Annotations" and "Orphans" tabs in the
 * Hypothesis client's sidebar, or `null` if the counts are not visible.
 *
 * This is executed in the context of the Hypothesis client's sidebar.
 */
function getAnnotationAndOrphanCounts() {
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
 * Opens a URL in a browser with Hypothesis active and gathers statistics on
 * the results of anchoring.
 */
class AnchoringTester {
  constructor() {
    /** @type {puppeteer.Browser} */
    this._browser = null;

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

  async _getAnchorResults(page) {
    const sidebar = await page.waitForSelector(
      'iframe[name="hyp_sidebar_frame"]'
    );
    const sidebarFrame = await sidebar.contentFrame();

    const resultsHandle = await sidebarFrame.waitForFunction(
      getAnnotationAndOrphanCounts,
      {
        polling: 50,

        // Maximum amount of time to wait for PDF to load, sidebar to appear
        // and annotation/orphan counts to be displayed at the top of the
        // sidebar.
        timeout: 20000,
      }
    );
    const resultsValue = await resultsHandle.jsonValue();
    const { annotationCount, orphanCount } = resultsValue;
    return {
      annotationCount,
      orphanCount,
    };
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
