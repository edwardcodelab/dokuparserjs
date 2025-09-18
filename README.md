
# DokuParserJS

A lightweight JavaScript parser for converting DokuWiki markup to HTML, designed for accurate rendering in web applications with modular rules for easy extension. Supports running locally without a DokuWiki server using a simple Python HTTP server.

## Features

- **Core Syntax**: Parses DokuWiki markup, including:
  - Headers (`h1-h6`), nested lists (`ul/ol`), inline formatting (bold, italic, underline, monospace, sub/superscript, strikethrough).
  - Links (internal, external, interwiki, email), images (alignment, size, alt text), tables (headers, basic rowspan/colspan).
  - Code/pre blocks, nested blockquotes, footnotes, horizontal rules, and emoticons.
- **Namespace Links**: Resolves relative (`./`, `..`, `~`), absolute (`:ns`), and start page (`:`) links against `currentNamespace`.
- **Configurable Paths**: Supports local paths (`/data/pages/`, `/data/media/`) or DokuWiki paths (`/doku.php?id=`, `/lib/exe/fetch.php?media=`).
- **Search Functionality**: `main.html` includes a search bar that matches `.txt` files and directories recursively, displaying only file names (e.g., `syntax.txt`) in results to save space.
- **Interactive Interface**: `main.html` offers a dark-themed sidebar with a directory tree, search results, and clickable links to render `.txt` pages dynamically.
- **Environments**: Runs in browser (global `DokuParserJS`) or Node (module/CLI).
- **Performance**: Parses ~5KB markup in ~100-200ms in browser/Node.

## Installation

1. **Clone the Repository**:
   ```bash
   git clone <repo>
   cd dokuwiki-parser
   ```

2. **Directory Structure**:
   ```
   dokuwiki-parser/
   ├── data/
   │   ├── media/
   │   │   └── wiki/
   │   │       └── dokuwiki-128.png
   │   ├── pages/
   │   │   ├── playground/
   │   │   │   └── playground.txt
   │   │   └── wiki/
   │   │       └── syntax.txt
   ├── main.html
   ├── example.html
   ├── dokuparserjs.js
   ```

3. **Copy Your Data**:
   - Place DokuWiki `.txt` files in `data/pages/` (e.g., `data/pages/wiki/syntax.txt`).
   - Place media files (e.g., images) in `data/media/` (e.g., `data/media/wiki/dokuwiki-128.png`).
   - Maintain namespace structure (e.g., `data/pages/playground/` for `playground:playground`).

4. **Serve Locally**:
   - Start a Python HTTP server:
     ```bash
     python3 -m http.server 8080 --directory . --bind 0.0.0.0
     ```
   - Open `http://localhost:8080/main.html` in a browser to view the file explorer and render pages.

## Usage

### API
Create a parser instance with configurable options and parse markup:

```javascript
const parser = new DokuParserJS({
  currentNamespace: 'wiki', // Current namespace for link resolution
  interwikiMap: { wp: 'https://en.wikipedia.org/wiki/', doku: 'https://www.dokuwiki.org/' }, // Interwiki URL mappings
  mediaBasePath: '/data/media/', // Base path for media files (local mode)
  pagesBasePath: '/data/pages/', // Base path for pages (local mode)
  useTxtExtension: true, // Append .txt to internal links
  useDokuWikiPaths: false, // Use DokuWiki paths (/doku.php, /lib/exe/fetch.php)
  htmlok: true, // Enable HTML embedding
  typography: true // Enable typography conversions
});
const html = parser.parse('**bold** [[wiki:syntax|Syntax Page]]');
// Returns: <p><strong>bold</strong> <a href="/data/pages/wiki/syntax.txt" class="wikilink1" ...>Syntax Page</a></p>
```

### CLI
Parse markup from a file or stdin:

```bash
echo "**bold** [[page]]" | node dokuparserjs.js
```

With environment variables for configuration:

```bash
DOKU_NAMESPACE=wiki DOKU_MEDIA_BASE_PATH=/data/media/ DOKU_PAGES_BASE_PATH=/data/pages/ DOKU_USE_TXT_EXTENSION=true cat data/pages/wiki/syntax.txt | node dokuparserjs.js > output.html
```

### Web Interface
- **main.html**: Displays a file explorer in a dark sidebar (`data/pages/`), with a search bar above the directory tree. Search results show only `.txt` file names (e.g., `syntax.txt`) and directory paths (e.g., `wiki/`). Click files or internal links to render parsed content in a scrollable content area.
- **example.html**: Allows inputting DokuWiki markup in a text area or selecting `.txt` files to render.

## Examples

### 1. Core Syntax: Headers, Lists, Inline
**Input** (`data/pages/wiki/syntax.txt`):
```
====== H6 Header ======
* Bold **text**
* Italic //text//
  * Nested list
> Quote with <u>underline</u>
```

**Output**:
```html
<div class="page group">
  <div class="section_highlight_wrapper">
    <h6 class="sectionedit1" id="h6_header">H6 Header</h6>
    <div class="level6">
      <ul>
        <li class="level1"><div class="li">Bold <strong>text</strong></div></li>
        <li class="level1"><div class="li">Italic <em>text</em></div></li>
        <li class="level2"><div class="li">Nested list</div></li>
      </ul>
      <blockquote><div class="no">Quote with <u>underline</u></div></blockquote>
    </div>
  </div>
</div>
```

### 2. Links: Namespace-Aware
**Input** (with `currentNamespace='wiki'`, `pagesBasePath='/data/pages/'`, `useTxtExtension=true`):
```
[[..:playground|Playground]]
[[.:syntax|Syntax Page]]
[[:|Start Page]]
[[wp>Wiki|Wikipedia]]
```

**Output**:
```html
<p>
  <a href="/data/pages/playground.txt" class="wikilink1" data-wiki-id="..:playground">Playground</a>
  <a href="/data/pages/wiki/syntax.txt" class="wikilink1" data-wiki-id=".:syntax">Syntax Page</a>
  <a href="/data/pages/wiki/start.txt" class="wikilink1 curid" data-wiki-id=":">Start Page</a>
  <a href="https://en.wikipedia.org/wiki/Wiki" class="interwiki iw_wp" title="https://en.wikipedia.org/wiki/Wiki" data-wiki-id="wp:Wiki">Wikipedia</a>
</p>
```

### 3. Images
**Input** (with `mediaBasePath='/data/media/'`):
```
{{wiki:dokuwiki-128.png?200x100|Logo}}
```

**Output**:
```html
<p>
  <a href="/data/media/wiki/dokuwiki-128.png" class="media">
    <img src="/data/media/wiki/dokuwiki-128.png" width="200" height="100" alt="Logo" class="mediacenter" loading="lazy">
  </a>
</p>
```

### 4. Search Interface
- **Search "syntax"**: Shows `syntax.txt` in `#search-results`.
- **Search "playground"**: Shows `playground.txt` and `playground/` in `#search-results`.
- **Clicking Results**: Renders the selected `.txt` file, updating the toolbar title and highlighting the active page.

## Limitations
- Basic rowspan/colspan support; complex table merging not supported.
- RSS parsing is mocked with placeholder output.
- No `<file>` download functionality.
- Limited plugin system (extend via `this.rules`).

## License
GNU GPL
