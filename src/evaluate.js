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
    .option(
      '--output <file>',
      'output file for results',
      'evaluate-results.json'
    )
    .option('--resume', 'resume a previous run')
    .arguments('<url-list> <mode>')
    .action((urlList_, mode_) => {
      urlList = urlList_;
      mode = mode_;
    });
  program.parse(process.argv);

  const outputFile = program.output;

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
  let results = {};
  if (program.resume) {
    console.log(`Resuming previous run from results in ${outputFile}`);
    results = JSON.parse(fs.readFileSync(outputFile));
  }
  let processed = Object.keys(results).length;

  console.log(
    `Testing ${urls.length} URLs with ${mode}. Output file: ${outputFile}`
  );

  for (let url of urls) {
    if (url in results) {
      // URL duplicated or tested in a previous run.
      continue;
    }

    console.debug(`Testing ${url}`);
    try {
      const result = await tester.runTest(url, mode);
      results[url] = result;
    } catch (err) {
      console.error(`Failed to test ${url}:`, err.message);
      results[url] = {
        error: err.message,
      };
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
