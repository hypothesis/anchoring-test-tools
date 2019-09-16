'use strict';

const { sortKeys } = require('./object');

class CounterSet {
  constructor() {
    this._counters = {};
  }

  increment(name) {
    // eslint-disable-next-line no-prototype-builtins
    if (!this._counters.hasOwnProperty(name)) {
      this._counters[name] = 0;
    }
    this._counters[name] += 1;
  }

  set(name, value) {
    this._counters[name] = value;
  }

  get(name) {
    return this._counters[name] || 0;
  }

  /**
   * Return an object mapping counter names to current values.
   *
   * Keys are sorted alphabetically for consistent output across runs.
   */
  values() {
    return sortKeys(this._counters);
  }
}

module.exports = {
  CounterSet,
};
