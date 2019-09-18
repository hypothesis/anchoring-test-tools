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
    .arguments('<file-1> <file-2>')
    .action((file1_, file2_) => {
      file1 = file1_;
      file2 = file2_;
    });
  program.parse(process.argv);

  const results1 = filterResults(JSON.parse(fs.readFileSync(file1)));
  const results2 = filterResults(JSON.parse(fs.readFileSync(file2)));
  console.log(jsonDiff.diffString(results1, results2));
}

module.exports = { main };
