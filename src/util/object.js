'use strict';

/**
 * Return a shallow copy of an object with the keys sorted.
 */
function sortKeys(object) {
  const sorted = {};
  Object.keys(object).sort().forEach(key => {
    sorted[key] = object[key];
  });
  return sorted;
}

module.exports = {
  sortKeys,
};
