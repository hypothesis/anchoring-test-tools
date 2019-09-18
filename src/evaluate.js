'use strict';

const fs = require('fs');

const program = require('commander');

const { AnchoringTester } = require('./util/anchoring-tester');
const { exitWithError } = require('./util/cli');
const { sortKeys } = require('./util/object');

/**
 * Read the list of document URLs to test.
 *
 * @param {string} path
 */
function readUrlList(path) {
  const isComment = line =>
    line.trim().length === 0 || line.trim().startsWith('#');
  return fs
    .readFileSync(path)
    .toString()
    .split('\n')
    .filter(line => !isComment(line));
}

/**
 * Entry point for `bin/evaluate`.
 */
async function main() {
  let urlList;
  let mode;

  program
    .version('1.0.0')
    .description(
      'Load URLs with Hypothesis active and count anchored/orphaned annotations'
    )
    .arguments('<url-list> <mode>')
    .action((urlList_, mode_) => {
      urlList = urlList_;
      mode = mode_;
    });
  program.parse(process.argv);

  const outputFile = 'evaluate-results.json';

  // Check args.
  if (!urlList) {
    exitWithError('No URL list specified');
  }

  const isValidMode = mode => ['via', 'via-pdfjs2'].includes(mode);
  if (!isValidMode(mode)) {
    exitWithError(`Unknown mode: ${mode}`);
  }

  // Run anchoring tests.
  const urls = readUrlList(urlList);
  const tester = new AnchoringTester();
  const results = {};
  let processed = 0;
  for (let url of urls) {
    console.debug(`Testing ${url} with ${mode}`);
    try {
      const result = await tester.runTest(url, mode);
      results[url] = result;
    } catch (err) {
      console.error(`Failed to test ${url}:`, err);
    }
    ++processed;
    console.log(`Processed ${processed} of ${urls.length} URLs`);

    // Write current results.
    const sortedResults = sortKeys(results);
    fs.writeFileSync(outputFile, JSON.stringify(sortedResults, null, 2));
  }

  await tester.close();
}

module.exports = {
  main,
};
