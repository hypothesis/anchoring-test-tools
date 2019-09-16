This is a collection of tools for evaluating Hypothesis annotation _anchoring_
using real annotations created by Hypothesis users in public groups.

_anchoring_ is the process of matching a serialized description of a region
of a document stored with an annotation to the corresponding part of the
loaded HTML or PDF document.

It is used to check for improvements or regressions
in real-world test cases when making changes to anchoring logic, document
viewers (eg. PDF.js) or other aspects of Hypothesis.

## Usage

Clone this repository and then install dependencies with:

```sh
npm install
```

After installing dependencies, you can run the individual tools in the `bin/`
directory:

### `bin/fetch-annotated-pdf-urls`

Fetches URLs of PDFs which have public annotations in Hypothesis.

```
bin/fetch-annotated-pdf-urls [flags]
```

By default, the tool iterates over recent public annotations in
reverse-chronological order and finds HTTP(S) URLs with a minimum number of
public annotations where the path ends in ".pdf" and the URL is publicly
accessible and returns a file with the correct MIME type for a PDF.

The URLs are written to a `url-list.txt` text file.

Testing whether a URL is accessible is slow, so a cache of this information is
created in `url-info-cache.json` to speed up repeated searches.

### `bin/evaluate`

Tests anchoring using Hypothesis on a list of URLs.

```
bin/evaluate [flags] <url-list> <mode>
```

Where `<url-list>` identifies which documents to test, `<mode>` specifies
how to load each URL in the document set with the Hypothesis client active.

The output will be a JSON file that maps URLs to statistics about the number
of annotations that successfully anchor or fail to anchor ("orphans").

#### URL lists

The `<url-list>` argument should be the path of a text file containing
a list of URLs, one per line. Blank lines and lines beginning with '#' are
ignored.

#### Mode strings

Available `<mode>` argument values are:

`via` - Use https://via.hypothes.is/
`via-pdfjs2` - Same as `via` but with the `via.features=pdfjs2` query param added

#### Flags

There are currently no flags supported.

## Related projects

See also @judell's [h_puppeteer](https://github.com/judell/h_puppeteer) project.
