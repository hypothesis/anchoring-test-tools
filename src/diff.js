'use strict';

const fs = require('fs');

const program = require('commander');
const jsonDiff = require('json-diff');

function filterKeys(obj, filterFn) {
  const result = {};
  for (let key in obj) {
    if (!filterFn(key)) {
      continue;
    }
    result[key] = obj[key];
  }
  return result;
}

/**
 * Filter results from `bin/evaluate` to remove keys which are not expected
 * to be consistent across runs.
 */
function filterResults(evaluateResultsJson) {
  const result = {};
  for (let url of Object.keys(evaluateResultsJson)) {
    result[url] = filterKeys(
      evaluateResultsJson[url],
      key => !key.match(/[a-z]+Time/)
    );
  }
  return result;
}

function main() {
  let file1;
  let file2;

  program
    .version('1.0.0')
    .description('compare the output from two runs of `bin/evaluate`')
    .option(
      '--ignore-missing',
      'only consider URLs successfully fetched in both result sets'
    )
    .arguments('<file-1> <file-2>')
    .action((file1_, file2_) => {
      file1 = file1_;
      file2 = file2_;
    });
  program.parse(process.argv);

  // Read testing results and remove timing fields.
  const input1 = JSON.parse(fs.readFileSync(file1));
  const input2 = JSON.parse(fs.readFileSync(file2));

  if (program.ignoreMissing) {
    const urls = new Set([...Object.keys(input1), ...Object.keys(input2)]);
    const hasResult = (results, url) =>
      results[url] && typeof results[url].annotationCount === 'number';
    for (let url of urls) {
      if (!hasResult(input1, url) || !hasResult(input2, url)) {
        delete input1[url];
        delete input2[url];
      }
    }
  }

  const results1 = filterResults(input1);
  const results2 = filterResults(input2);

  // Output a structural diff of the filtered results.
  console.log(jsonDiff.diffString(results1, results2));

  // Calculate and display statistics for both sets of results.
  const fieldSum = (results, field) =>
    Object.keys(results).reduce(
      (total, url) => (results[url][field] || 0) + total,
      0
    );

  const calcStats = results => ({
    urls: Object.keys(results).length,

    // Sum total values in various fields.
    totalOrphans: fieldSum(results, 'orphanCount'),
    totalAnnotations: fieldSum(results, 'annotationCount'),
    totalHighlights: fieldSum(results, 'highlightCount'),

    // Count URLs where we failed to read an annotation count from the tabs in
    // the sidebar.
    errors: Object.keys(results).reduce(
      (total, url) =>
        typeof results[url].annotationCount !== 'number' ? total + 1 : total,
      0
    ),
  });

  const results1Totals = calcStats(results1);
  const results2Totals = calcStats(results2);

  console.log(`Totals for ${file1}:`, results1Totals);
  console.log(`Totals for ${file2}:`, results2Totals);
}

module.exports = { main };
