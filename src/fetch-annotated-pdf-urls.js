'use strict';

/* global Map */

const fs = require('fs');
const https = require('https');

const program = require('commander');
const fetch = require('node-fetch');

const hApi = require('./util/h-api');
const { CounterSet } = require('./util/stats');

// Use custom agent to enable Keep-Alive.
const agent = new https.Agent({ keepAlive: true });

const defaultCounters = new CounterSet();

function getMimeType(response) {
  const contentType = response.headers.get('Content-Type');
  if (!contentType) {
    return 'unknown';
  }
  const mimeType = contentType.split(';')[0];
  if (!mimeType) {
    return 'unknown';
  }
  return mimeType;
}

/**
 * Return true if a URL can be fetched (returns HTTP 200) and the content is a PDF.
 */
async function isPubliclyAccessiblePdf(url, counters = defaultCounters) {
  const timeout = 3000;

  let response;
  try {
    counters.increment('fetch-pdf/urls-tested');
    response = await fetch(url, { agent, timeout });
  } catch (err) {
    counters.increment('fetch-pdf/timeout');
    return false;
  }
  if (response.redirected) {
    counters.increment('fetch-pdf/url-redirected');
  }
  if (!response.ok) {
    counters.increment('fetch-pdf/not-ok-response');
    return false;
  }

  const mimeType = getMimeType(response);
  counters.increment(`fetch-pdf/mime-type/${mimeType}`);
  if (mimeType !== 'application/pdf') {
    return false;
  }
  return true;
}

/**
 * Read cached information about annotated URLs.
 *
 * The cache is stored in `URL_INFO_CACHE_PATH`.
 */
function readUrlInfoCache(cachePath) {
  const accessiblePdfCache = new Map();
  try {
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath).toString();
      const json = JSON.parse(data);
      Object.entries(json).forEach(([url, info]) => {
        if (info.isPubliclyAccessiblePdf) {
          accessiblePdfCache.set(url, info.isPubliclyAccessiblePdf);
        }
      });
    }
  } catch (err) {
    console.warn('Failed to read URL info cache: ', err);
  }

  return { accessiblePdfCache };
}

/**
 * Create or replace a cache of information about annotated URLs.
 */
function writeUrlInfoCache(cachePath, { accessiblePdfCache }) {
  const data = {};
  for (let [url, isPubliclyAccessiblePdf] of accessiblePdfCache) {
    data[url] = { isPubliclyAccessiblePdf };
  }
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
}

async function main() {
  program.version('1.0.0');
  program.parse(process.argv);

  // Map of URI to number of annotations.
  let annotationCounts = new Map();
  let searchAfter = '';
  const sortField = 'created';

  // File to write the list of qualifying URLs to.
  const outputFile = 'url-list.txt';

  // File where candidate URL fetch results are cached.
  const cacheFile = 'url-info-cache.json';

  // Path to write counters to as fetch progresses.
  const statsFile = 'url-fetch-stats.json';

  // Minimum number of annotations a URL must have before it is included in the
  // result set.
  let minAnnotations = 10;

  // Maximum number of URLs to return.
  const maxUris = 300;
  let urisWithEnoughAnnotations = [];

  // Number of annotations examined so far.
  let processed = 0;

  // Map of URI to boolean indicating whether URL is a publicly accessible PDF.
  const { accessiblePdfCache } = readUrlInfoCache(cacheFile);
  if (accessiblePdfCache.size > 0) {
    console.log(`Read cached info about ${accessiblePdfCache.size} files`);
  }

  // Search query to use to find candidates.
  const searchQuery = '';

  // Metric counters.
  const counters = new CounterSet();

  console.log(
    `Finding annotated URLs matching "${searchQuery}" and writing to ${outputFile}`
  );

  // Find URLs with enough public annotations.
  while (urisWithEnoughAnnotations.length < maxUris) {
    const { status, data } = await hApi.request('search', {
      q: searchQuery,
      sort: sortField,
      order: 'desc',
      search_after: searchAfter,
      limit: 100,
    });
    if (status >= 400) {
      // We currently abort as soon as the request fails. It might be worth
      // implementing a retry here.
      console.error(`API request failed (${status}):`, data);
      break;
    }
    const { rows } = data;
    if (rows.length === 0) {
      console.log('No more URIs found');
      break;
    }
    processed += rows.length;
    searchAfter = rows[rows.length - 1][sortField];

    for (let row of rows) {
      // Check if this annotation has a URL that is publicly accessible
      // and is a PDF.
      let uri;
      try {
        uri = new URL(row.uri);
      } catch (err) {
        counters.increment('search/invalid-uri');
        console.log(`Failed to parse annotation URI: "${row.uri}"`);
        continue;
      }

      // Skip URLs that we can't fetch. This mainly filters out local files,
      // but API users can submit any URI they like with an annotation.
      if (!uri.protocol.match(/^https?:/)) {
        counters.increment('search/non-http-uri');
        continue;
      }

      // As a heuristic, skip URLs where the path doesn't end with ".pdf" as
      // probably being HTML pages.
      if (!uri.pathname.endsWith('.pdf')) {
        counters.increment('search/filename-without-pdf-extension');
        continue;
      }

      // Do a more expensive test involving fetching the file and inspecting
      // the `Content-Type` header.
      if (!accessiblePdfCache.has(row.uri)) {
        console.log(`Checking if ${row.uri} is accessible and is a PDF`);
        const isAccessible = await isPubliclyAccessiblePdf(row.uri, counters);
        accessiblePdfCache.set(row.uri, isAccessible);
        console.log(`${row.uri} is a public PDF: ${isAccessible}`);
      }
      if (!accessiblePdfCache.get(row.uri)) {
        continue;
      }

      if (!annotationCounts.has(row.uri)) {
        annotationCounts.set(row.uri, 0);
      }
      const count = annotationCounts.get(row.uri);
      annotationCounts.set(row.uri, count + 1);
    }

    urisWithEnoughAnnotations = [];
    for (let [uri, count] of annotationCounts) {
      if (count >= minAnnotations) {
        urisWithEnoughAnnotations.push(uri);
      }
    }

    counters.set(
      'search/urls-with-enough-annotations',
      urisWithEnoughAnnotations.length
    );
    counters.set(
      'search/urls-with-not-enough-annotations',
      annotationCounts.size - urisWithEnoughAnnotations.length
    );

    console.log(
      `Found ${
        urisWithEnoughAnnotations.length
      } PDF URLs with ${minAnnotations} annotations after processing ${processed} annotations`
    );

    // Write out the cache so we can resume searches quickly in future if an
    // interruption happens.
    writeUrlInfoCache(cacheFile, { accessiblePdfCache });

    // Write out current statistics.
    const stats = counters.values();
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));

    // Write out the URLs found so far.
    const resultList = urisWithEnoughAnnotations.slice(0, maxUris);
    fs.writeFileSync(outputFile, resultList.join('\n'));
  }
}

module.exports = {
  main,
};
