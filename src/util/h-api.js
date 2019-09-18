'use strict';

const https = require('https');

const fetch = require('node-fetch');

let links = null;

// Use a custom agent to enable Keep-Alive support.
const agent = new https.Agent({ keepAlive: true });

const API_ROOT = 'https://hypothes.is/api/';

async function getRouteMetadata(route) {
  if (!links) {
    // eslint-disable-next-line
    links = (await (await fetch(API_ROOT)).json()).links;
  }
  const routeMeta = route.split('.').reduce((links, token) => {
    if (!links) {
      return null;
    }
    return links[token];
  }, links);
  if (!routeMeta || !routeMeta.desc) {
    throw new Error(`No such API route: ${route}`);
  }
  return routeMeta;
}

/**
 * Make a request to the Hypothesis API.
 *
 * @param {string} route - Dotted route path (eg. "search", "annotation.read")
 * @param {params} params - Query params.
 * @return {Result} Result of the API call
 */
async function request(route, params = {}) {
  const { method, url } = await getRouteMetadata(route);
  const requestUrl = new URL(url);
  Object.keys(params).forEach(param => {
    requestUrl.searchParams.append(param, params[param]);
  });

  const result = await fetch(requestUrl.href, { agent, method });
  if (result.status < 200 || result.status >= 500) {
    throw new Error('Request failed');
  }

  return {
    status: result.status,
    data: await result.json(),
  };
}

module.exports = {
  request,
};
