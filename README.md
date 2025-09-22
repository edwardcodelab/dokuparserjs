
# DokuParserJS
A lightweight JavaScript parser for converting DokuWiki markup to HTML, designed for accurate rendering in web applications with modular rules for easy extension. Supports running locally without a DokuWiki server using a simple Python HTTP server.

## Features
- **Core Syntax**: Parses DokuWiki markup, including:
  - Headers (`h1-h6`), nested lists (`ul/ol`), inline formatting (bold, italic, underline, monospace, sub/superscript, strikethrough).
  - Links (internal, external, interwiki, email), images (alignment, size, alt text), tables (headers, basic rowspan/colspan).
  - Code/pre blocks, nested blockquotes, footnotes, horizontal rules.
- **Emoticons**: Converts emoticons to Unicode emojis by default (e.g., `:-)` to 😊), with fallback to SVG images if `useEmoji: false`.
- **Table of Contents (TOC)**: Generates a styled TOC for pages with >3 headings, controlled by `toc` option (default: `false`). Enabled in `main.html` for pages like `dokuwiki.txt` and `tables_test.txt`, disabled by `~~NOTOC~~` (e.g., in `syntax.txt`).
- **Namespace Links**: Resolves relative (`./`, `..`, `~`), absolute (`:ns`), and start page (`:`) links against `currentNamespace`.
- **Configurable Paths**: Supports local paths (`/data/pages/`, `/data/media/`) or DokuWiki paths (`/doku.php?id=`, `/lib/exe/fetch.php?media=`).
- **Search Functionality**: `main.html` includes a search bar that matches `.txt` files and directories recursively, displaying only file names (e.g., `syntax.txt`) in results to save space.
- **Interactive Interface**: `main.html` offers a dark-themed sidebar with a directory tree, search results, and clickable links to render `.txt` pages dynamically. Fixed `ul is not defined` error ensures reliable file tree rendering.
- **Environments**: Runs in browser (global `DokuParserJS`) or Node.js (module/CLI).
- **Performance**: Parses ~5KB markup in ~100-200ms in browser/Node.js.

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
   │   │       ├── syntax.txt
   │   │       └── dokuwiki.txt
   ├── main.html
   ├── example.html
   ├── dokuparserjs.js
   ```

3. **Copy Your Data**:
   - Place DokuWiki `.txt` files in `data/pages/` (e.g., `data/pages/wiki/syntax.txt`, `data/pages/wiki/dokuwiki.txt`).
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
  useEmoji: true, // Use Unicode emojis (default: true)
  htmlok: true, // Enable HTML embedding
  typography: true, // Enable typography conversions
  toc: true // Generate TOC for >3 headings (default: false)
});
const html = parser.parse('**bold** [[wiki:syntax|Syntax Page]] :-)');
// Returns: <div class="page group"><p><strong>bold</strong> <a href="/data/pages/wiki/syntax.txt" class="wikilink1" ...>Syntax Page</a> 😊</p></div>
```

### CLI
Parse markup from a file or stdin:
```bash
echo "**bold** [[page]] :-)" | node dokuparserjs.js

or

node dokiparserjs.js < page.txt
```
With environment variables for configuration:
```bash
DOKU_NAMESPACE=wiki DOKU_MEDIA_BASE_PATH=/data/media/ DOKU_PAGES_BASE_PATH=/data/pages/ DOKU_USE_TXT_EXTENSION=true DOKU_USE_EMOJI=true DOKU_TOC=true cat data/pages/wiki/dokuwiki.txt | node dokuparserjs.js > output.html
```

### Web Interface Example
- **main.html**: a dokuwiki page reader
- **example.html**: Allows inputting DokuWiki markup in a text area or selecting `.txt` files to render.

## Examples

### 1. Core Syntax with TOC
**Input** (`data/pages/wiki/dokuwiki.txt`):
``` 
====== DokuWiki ======
DokuWiki is a simple to use and highly versatile Open Source [[wp>wiki|wiki]] software...
===== Download =====
DokuWiki is available at https://download.dokuwiki.org/
===== Read More =====
All documentation and additional information...
```

**Output** (with `toc: true`):
```html
<div class="page group">
  <div class="toc">
    <div class="tocheader">Table of Contents</div>
    <ul>
      <li class="level1"><a href="#dokuwiki">DokuWiki</a></li>
      <li class="level2"><a href="#download">Download</a></li>
      <li class="level2"><a href="#read_more">Read More</a></li>
      <!-- ... other headings (total 8) ... -->
    </ul>
  </div>
  <h1 class="sectionedit1" id="dokuwiki">DokuWiki</h1>
  <p>DokuWiki is a simple to use and highly versatile Open Source <a href="https://en.wikipedia.org/wiki/wiki" class="interwiki iw_wp" ...>wiki</a> software...</p>
  <h2 class="sectionedit2" id="download">Download</h2>
  <p><a href="https://download.dokuwiki.org/" class="urlextern" rel="nofollow">https://download.dokuwiki.org/</a></p>
  <h2 class="sectionedit2" id="read_more">Read More</h2>
  <p>All documentation and additional information...</p>
  <!-- ... rest of content ... -->
</div>
```

### 2. Core Syntax with No TOC
**Input** (`data/pages/wiki/syntax.txt`):
``` 
====== Formatting Syntax ======
DokuWiki supports **bold**, //italic//...
===== Basic Text Formatting =====
...
~~NOTOC~~
```

**Output** (no TOC due to `~~NOTOC~~` despite `toc: true`):
```html
<div class="page group">
  <h1 class="sectionedit1" id="formatting_syntax">Formatting Syntax</h1>
  <p>DokuWiki supports <strong>bold</strong>, <em>italic</em>...</p>
  <h2 class="sectionedit2" id="basic_text_formatting">Basic Text Formatting</h2>
  <!-- ... rest of content ... -->
</div>
```

### 3. Tables with TOC
**Input** (`data/pages/wiki/tables_test.txt`):
``` 
====== Table Syntax Tests ======
===== Basic Table =====
^ Header 1 ^ Header 2 ^ Header 3 ^
| Row 1 Col 1 | Row 1 Col 2 | Row 1 Col 3 |
===== Table with Colspans =====
...
```

**Output** (with `toc: true`):
```html
<div class="page group">
  <div class="toc">
    <div class="tocheader">Table of Contents</div>
    <ul>
      <li class="level1"><a href="#table_syntax_tests">Table Syntax Tests</a></li>
      <li class="level2"><a href="#basic_table">Basic Table</a></li>
      <li class="level2"><a href="#table_with_colspans">Table with Colspans</a></li>
      <!-- ... other headings (total 9) ... -->
    </ul>
  </div>
  <h1 class="sectionedit1" id="table_syntax_tests">Table Syntax Tests</h1>
  <h2 class="sectionedit2" id="basic_table">Basic Table</h2>
  <div class="table"><table class="inline"><thead><tr class="row0"><th class="col0">Header 1</th><th class="col1">Header 2</th><th class="col2">Header 3</th></tr></thead><tbody><tr class="row1"><td class="col0">Row 1 Col 1</td><td class="col1">Row 1 Col 2</td><td class="col2">Row 1 Col 3</td></tr>...</tbody></table></div>
  <h2 class="sectionedit2" id="table_with_colspans">Table with Colspans</h2>
  <!-- ... rest of content ... -->
</div>
```

### 4. Links: Namespace-Aware
**Input**:
``` 
[[..:playground|Playground]]
[[.:syntax|Syntax Page]]
[[:|Start Page]]
[[wp>Wiki|Wikipedia]]
```

**Output** (with `currentNamespace='wiki'`, `pagesBasePath='/data/pages/'`, `useTxtExtension=true`):
```html
<div class="page group">
  <p>
    <a href="/data/pages/playground.txt" class="wikilink1" data-wiki-id="..:playground">Playground</a>
    <a href="/data/pages/wiki/syntax.txt" class="wikilink1" data-wiki-id=".:syntax">Syntax Page</a>
    <a href="/data/pages/wiki/start.txt" class="wikilink1 curid" data-wiki-id=":">Start Page</a>
    <a href="https://en.wikipedia.org/wiki/Wiki" class="interwiki iw_wp" title="https://en.wikipedia.org/wiki/Wiki" data-wiki-id="wp>Wiki">Wikipedia</a>
  </p>
</div>
```

### 5. Images with Emoji
**Input** (with `mediaBasePath='/data/media/'`, `useEmoji: true`):
``` 
{{wiki:dokuwiki-128.png?200x100|Logo}} :-)
```

**Output**:
```html
<div class="page group">
  <p>
    <a href="/data/media/wiki/dokuwiki-128.png" class="media">
      <img src="/data/media/wiki/dokuwiki-128.png" width="200" height="100" alt="Logo" class="mediacenter" loading="lazy">
    </a> 😊
  </p>
</div>
```


## Limitations
- Basic rowspan/colspan support; complex table merging not supported.


## License
GNU GPL
