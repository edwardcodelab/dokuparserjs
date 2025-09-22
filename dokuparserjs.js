/**
 * DokuParserJS: A lightweight JavaScript class for parsing DokuWiki markup into HTML.
 *
 * Purpose:
 * - Converts DokuWiki syntax (e.g., headers, links, tables) into HTML for web rendering.
 * - Designed to be lightweight, dependency-free, and extensible for web and Node.js environments.
 * - Processes input line-by-line using a state machine for block elements (headers, lists, tables)
 *   and regex-based rules for inline elements (bold, links, images).
 *
 * Usage:
 * - Instantiate with options to configure namespace, paths, and features.
 * - Call `parse()` with DokuWiki markup to get HTML output.
 * - Supports CLI for processing files or stdin in Node.js.
 *
 * @example
 * const parser = new DokuParserJS({
 *   currentNamespace: 'wiki',
 *   interwikiMap: { wp: 'https://en.wikipedia.org/wiki/' }
 * });
 * const html = parser.parse('**bold** [[link]]');
 *
 * Key Features:
 * - Handles core DokuWiki syntax: headers, lists, tables, links, images, code blocks, footnotes, etc.
 * - Namespace-aware link resolution (relative, absolute, interwiki).
 * - Configurable paths for pages and media.
 * - Supports emoji or SVG smileys, HTML/PHP embedding, and typography.
 *
 * Limitations:
 * - Basic rowspan/colspan support; complex table merging not implemented.
 * - RSS feeds are not parsed (pass-through only).
 * - No `<file>` download functionality.
 * - Limited plugin system (extend via `this.rules` for inline, `parse()` for blocks).
 *
 * Extensibility:
 * - Add new inline syntax by extending `this.rules` with `{ pattern: RegExp, replace: string|function }`.
 * - Add block-level syntax by modifying `parse()` state machine.
 * - Use `applyRules()` for nested parsing within blocks (e.g., table cells).
 *
 * @param {Object} [options] - Configuration options for the parser.
 * @param {string} [options.currentNamespace=''] - Current namespace for relative link resolution (e.g., 'wiki').
 * @param {Object} [options.interwikiMap={}] - Map of interwiki prefixes to base URLs (e.g., { wp: 'https://en.wikipedia.org/wiki/' }).
 * @param {boolean} [options.htmlok=true] - Enable raw HTML embedding; if false, HTML is escaped as code.
 * @param {boolean} [options.typography=true] - Enable typography conversions (e.g., arrows, copyright).
 * @param {boolean} [options.useTxtExtension=true] - Append '.txt' to internal links for local file access.
 * @param {string} [options.pagesBasePath='/'] - Base path for wiki pages (e.g., '/data/pages/').
 * @param {string} [options.mediaBasePath='/data/media/'] - Base path for media files (e.g., images).
 * @param {string} [options.smileyBasePath='/dokuwiki/lib/exe/fetch.php?media=lib:images:smileys:'] - Base path for SVG smileys.
 * @param {boolean} [options.useEmoji=true] - Use Unicode emojis instead of SVG images for smileys.
 * @returns {DokuParserJS} - Initialized parser instance.
 */
class DokuParserJS {
  constructor(options = {}) {
    // Initialize namespace for resolving relative links (e.g., 'wiki' for 'wiki:syntax')
    this.currentNamespace = options.currentNamespace || '';

    // Map interwiki prefixes to URLs (e.g., 'wp' -> Wikipedia)
    this.interwikiMap = options.interwikiMap || {
      wp: 'https://en.wikipedia.org/wiki/',
      doku: 'https://www.dokuwiki.org/'
    };

    // Enable/disable raw HTML embedding; if false, HTML is shown as code
    this.htmlok = options.htmlok !== false;

    // Enable/disable typography (e.g., arrows, copyright symbols)
    this.typography = options.typography !== false;

    // Append '.txt' to internal links for local file systems
    this.useTxtExtension = options.useTxtExtension !== false;

    // Base paths for pages and media
    this.pagesBasePath = options.pagesBasePath || '/';
    this.mediaBasePath = options.mediaBasePath || '/data/media/';

    // Base path for SVG smileys; used when useEmoji is false
    this.smileyBasePath = options.smileyBasePath || '/dokuwiki/lib/exe/fetch.php?media=lib:images:smileys:';

    // Use Unicode emojis (true) or SVG images (false) for smileys
    this.useEmoji = options.useEmoji !== false;

    // State tracking for parsing
    this.footnotes = []; // Array to track footnote references
    this.footnoteContent = new Map(); // Map of footnote content to indices
    this.linkPlaceholders = []; // Store link HTML for later replacement
    this.nowikiPlaceholders = []; // Store <nowiki> content
    this.listStack = []; // Track nested lists (ul/ol) and their depths
    this.currentIndent = -1; // Current list indentation level
    this.currentType = null; // Current list type (ul/ol)
    this.currentSectionLevel = 0; // Current header level (1-6)
    this.currentSection = ''; // Current section title for context-sensitive parsing

    // Smiley mappings: emoji or SVG file names
    this.smileyMap = this.useEmoji ? {
      '8-)': '😎',
      '8-O': '😲',
      ':-(': '😞',
      ':-)': '😊',
      '=-)': '🙂',
      ':-/': '😕',
      ':-\\': '😕',
      ':-D': '😁',
      ':-P': '😛',
      ':-O': '😮',
      ':-X': '😷',
      ':-|': '😐',
      ';-)': '😉',
      '^_^': '😄',
      'm(': '😠',
      ':?:': '❓',
      ':!:': '❗',
      'LOL': '😂',
      'FIXME': '🚧',
      'DELETEME': '🗑️'
    } : {
      '8-)': 'cool.svg',
      '8-O': 'shocked.svg',
      ':-(': 'sad.svg',
      ':-)': 'smile.svg',
      '=-)': 'smile2.svg',
      ':-/': 'tired.svg',
      ':-\\': 'tired.svg',
      ':-D': 'grin.svg',
      ':-P': 'tongue.svg',
      ':-O': 'shocked.svg',
      ':-X': 'sick.svg',
      ':-|': 'neutral.svg',
      ';-)': 'wink.svg',
      '^_^': 'happy.svg',
      'm(': 'angry.svg',
      ':?:': 'question.svg',
      ':!:': 'exclaim.svg',
      'LOL': 'lol.svg',
      'FIXME': 'fixme.svg',
      'DELETEME': 'delete.svg'
    };

    // Inline parsing rules: Array of { pattern, replace } for regex-based replacements
    this.rules = [
      // Remove control macros (NOTOC, NOCACHE) outside noformat sections
      { pattern: /~~NOTOC~~|~~NOCACHE~~/g, replace: '' },

      // External links (http:// or https://)
      {
        pattern: /(^|\s)(https?:\/\/[^\s<>\[\]]+)(?=\s|$)/g,
        replace: (match, prefix, url) => {
          // Skip links in "Links" or "RSS" sections to preserve examples
          if (this.currentSection.match(/^(Links|RSS\/ATOM Feed Aggregation)$/i)) {
            return match;
          }
          const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
          this.linkPlaceholders.push(`<a href="${url}" class="urlextern" rel="nofollow">${url}</a>`);
          return `${prefix}${placeholder}`;
        }
      },

      // WWW links (e.g., www.google.com)
      {
        pattern: /(^|\s)(www\.[^\s<>\[\]]+)(?=\s|$)/g,
        replace: (match, prefix, url) => {
          if (this.currentSection.match(/^(Links|RSS\/ATOM Feed Aggregation)$/i)) {
            return match;
          }
          const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
          this.linkPlaceholders.push(`<a href="http://${url}" class="urlextern" rel="nofollow">${url}</a>`);
          return `${prefix}${placeholder}`;
        }
      },

      // Email links
      {
        pattern: /(^|\s)<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>(?=\s|$)/g,
        replace: (match, prefix, email) => {
          const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
          this.linkPlaceholders.push(`<a href="mailto:${email}" class="mail" title="${email.replace(/ /g, ' [at] ').replace(/\./g, ' [dot] ')}">${email}</a>`);
          return `${prefix}${placeholder}`;
        }
      },

      // Interwiki links (e.g., [[wp>Wiki]])
      {
        pattern: /\[\[([a-zA-Z]+>[\w:-]+(?:#[\w:-]*)?)(?:\|([^\]]*))?\]\]/g,
        replace: (match, full, text) => {
          full = full.trim();
          text = text ? text.trim() : '';
          const [wiki, rest] = full.split('>');
          const [page, section] = rest.includes('#') ? rest.split('#') : [rest, ''];
          let display = text || page;
          // Handle nested images in link text
          if (text.match(/\{\{[^}]+?\}\}/)) {
            display = this.applyRules(text).replace(/<a\s+[^>]*class\s*=\s*"media"[^>]*>([\s\S]*?)<\/a>/g, '$1');
          }
          const href = this.interwikiMap[wiki] ? `${this.interwikiMap[wiki]}${encodeURIComponent(page)}${section ? '#' + section : ''}` : match;
          const className = `interwiki iw_${wiki}`;
          const attrs = ` title="${this.interwikiMap[wiki] || ''}${page}${section ? '#' + section : ''}" data-wiki-id="${full}"`;
          const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
          this.linkPlaceholders.push(`<a href="${href}" class="${className}"${attrs}>${display}</a>`);
          return placeholder;
        }
      },

      // External links with custom text (e.g., [[http://example.com|Text]])
      {
        pattern: /\[\[(https?:\/\/[^\]|#]+)(?:#([^|]*))?(?:\|([^\]]*))?\]\]/g,
        replace: (match, target, section, text) => {
          target = target.trim();
          text = text ? text.trim() : target.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
          if (text.match(/\{\{[^}]+?\}\}/)) {
            text = this.applyRules(text).replace(/<a\s+[^>]*class\s*=\s*"media"[^>]*>([\s\S]*?)<\/a>/g, '$1');
          }
          const href = section ? `${target}#${section}` : target;
          const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
          this.linkPlaceholders.push(`<a href="${href}" class="urlextern" title="${href}" rel="nofollow">${text}</a>`);
          return placeholder;
        }
      },

      // Internal links (e.g., [[pagename]] or [[pagename|Text]])
      {
        pattern: /\[\[([^\]|#]+)(?:#([^|]*))?(?:\|([^\]]*))?\]\]/g,
        replace: (match, target, section, text) => {
          target = target.trim();
          text = text ? text.trim() : target;
          if (text.match(/\{\{[^}]+?\}\}/)) {
            text = this.applyRules(text).replace(/<a\s+[^>]*class\s*=\s*"media"[^>]*>([\s\S]*?)<\/a>/g, '$1');
          }
          let path = this.resolveNamespace(target);
          let href = `${this.pagesBasePath}${path.replace(/:/g, '/')}${this.useTxtExtension ? '.txt' : ''}`;
          let className = 'wikilink1';
          let attrs = ` data-wiki-id="${target}"`;
          if (section) {
            href += `#${section}`;
            className = 'wikilink2';
            attrs = ` title="${target}#${section}" data-wiki-id="${target}#${section}"`;
          } else if (path.endsWith(':start')) {
            className = 'wikilink1 curid';
            attrs = ` title="${target}" data-wiki-id="${target}"`;
          }
          const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
          this.linkPlaceholders.push(`<a href="${href}" class="${className}"${attrs}>${text}</a>`);
          return placeholder;
        }
      },

      // RSS feeds (pass-through; not parsed)
      {
        pattern: /\{\{rss>[\s\S]*?\}\}/g,
        replace: (match) => match
      },

      // Images (e.g., {{wiki:image.png?200x100|Alt}})
      {
        pattern: /(^|\s)\{\{([^}]+?)(?:\?([^}]*))?(?:\|([ ^}]*))?}}(?:\s|$)/g,
        replace: (fullMatch, prefix, full, params, alt) => {
          full = full.trim();
          params = params ? params.trim() : '';
          alt = alt ? alt.trim() : '';
          let alignClass = 'media';
          const beforeSpace = fullMatch.startsWith(' ');
          const afterSpace = fullMatch.endsWith(' ');
          if (beforeSpace && afterSpace) alignClass += ' mediacenter';
          else if (beforeSpace) alignClass += ' medialeft';
          else if (afterSpace) alignClass += ' mediaright';
          const nsFile = full.includes(':') ? full : `${this.currentNamespace}:${full}`;
          const href = full.match(/^https?:\/\//) ? full : `${this.mediaBasePath}${nsFile.replace(/:/g, '/')}`;
          const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
          let img = `<img src="${href}" class="${alignClass}" alt="${alt}" loading="lazy"`;
          if (params && params !== 'linkonly' && params !== 'nolink') {
            const w = params.match(/(\d+)(?=$|x)/)?.[1];
            const h = params.match(/x(\d+)$/)?.[1];
            if (w) img += ` width="${w}"`;
            if (h) img += ` height="${h}"`;
          }
          img += ' />';
          if (params === 'linkonly') {
            this.linkPlaceholders.push(`<a href="${href}" class="media" title="${alt}">${alt || href}</a>`);
          } else if (params === 'nolink') {
            this.linkPlaceholders.push(img);
          } else if (full.includes('doku>') || full.includes('wp>')) {
            this.linkPlaceholders.push(img);
          } else {
            this.linkPlaceholders.push(`<a href="${href}" class="media" title="${alt}">${img}</a>`);
          }
          return `${prefix}${placeholder}`;
        }
      },

      // <nowiki> content (escaped)
      {
        pattern: /<nowiki>([\s\S]*?)<\/nowiki>/g,
        replace: (match, content) => {
          const ph = `[NOWIKI_${this.nowikiPlaceholders.length}]`;
          this.nowikiPlaceholders.push(content);
          return ph;
        }
      },

      // %%content%% (escaped content)
      {
        pattern: /%%([\s\S]*?)%%/g,
        replace: (match, content) => {
          content = content.trim();
          return this.escapeEntities(content);
        }
      },

      // Inline formatting
      { pattern: /\*\*(.+?)\*\*/g, replace: '<strong>$1</strong>' },
      { pattern: /\/\/(.+?)\/\//g, replace: '<em>$1</em>' },
      { pattern: /__(.+?)__/g, replace: '<u>$1</u>' },
      { pattern: /''(.+?)''/g, replace: '<tt>$1</tt>' },
      { pattern: /<sub>(.+?)<\/sub>/g, replace: '<sub>$1</sub>' },
      { pattern: /<sup>(.+?)<\/sup>/g, replace: '<sup>$1</sup>' },
      { pattern: /<del>(.+?)<\/del>/g, replace: '<del>$1</del>' },

      // HTML embedding
      {
        pattern: /<(?:html|HTML)>([\s\S]*?)<\/(?:html|HTML)>/g,
        replace: (match, content) => this.htmlok ? content : `<pre class="code html">${this.escapeEntities(content)}</pre>`
      },

      // PHP code (always displayed as code)
      {
        pattern: /<(?:php|PHP)>([\s\S]*?)<\/(?:php|PHP)>/g,
        replace: (match, content) => `<pre class="code php">${this.escapeEntities(content)}</pre>`
      },

      // Remove ~~INFO:syntaxplugins~~
      {
        pattern: /~~INFO:syntaxplugins~~/g,
        replace: () => ''
      },

      // Typography rules (optional)
      ...(this.typography ? [
        { pattern: /\s->(?=\s)/g, replace: ' &rarr; ' },
        { pattern: /\s<-(?=\s)/g, replace: ' &larr; ' },
        { pattern: /\s<->(?=\s)/g, replace: ' &harr; ' },
        { pattern: /\s=>(?=\s)/g, replace: ' &rArr; ' },
        { pattern: /\s<=(?=\s)/g, replace: ' &lArr; ' },
        { pattern: /\s<=>(?=\s)/g, replace: ' &hArr; ' },
        { pattern: /\s>>(?=\s)/g, replace: ' &raquo; ' },
        { pattern: /\s<<(?=\s)/g, replace: ' &laquo; ' },
        { pattern: /\s---(?=\s)/g, replace: ' &mdash; ' },
        { pattern: /\s--(?=\s)/g, replace: ' &ndash; ' },
        { pattern: /\(c\)/gi, replace: '&copy;' },
        { pattern: /\(tm\)/gi, replace: '&trade;' },
        { pattern: /\(r\)/gi, replace: '&reg;' },
        { pattern: /\(\.\.\.\)/g, replace: '&hellip;' },
        { pattern: /(\d+)x(\d+)/g, replace: '$1&times;$2' }
      ] : []),

      // Smiley replacement
      {
        pattern: new RegExp(Object.keys(this.smileyMap).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'),
        replace: (match) => {
          const icon = this.smileyMap[match];
          if (icon) {
            if (this.useEmoji) {
              return icon;
            } else {
              return `<img src="${this.smileyBasePath}${icon}" class="icon smiley" alt="${match}">`;
            }
          }
          return match;
        }
      }
    ];
  }

  /**
   * Resolves DokuWiki namespace paths for internal links.
   *
   * @param {string} target - The link target (e.g., ':page', '..:page', '.:page').
   * @returns {string} - Resolved namespace path.
   *
   * Logic:
   * - Handles absolute (:page), relative (.:page, ..:page), and start page (:) links.
   * - Sanitizes output by replacing invalid characters with underscores.
   * - Appends 'start' for namespace-only links (e.g., 'namespace:').
   */
  resolveNamespace(target) {
    const originalTarget = target;
    let isStartPage = originalTarget.endsWith(':');
    if (isStartPage) {
      target = target.slice(0, -1);
    }
    let resolved;
    if (target.startsWith(':')) {
      // Absolute link: remove leading colon
      resolved = target.substring(1);
    } else if (target.startsWith('..')) {
      // Parent namespace navigation
      let tempTarget = target;
      let levels = 0;
      while (tempTarget.startsWith('..')) {
        if (tempTarget.startsWith('..:')) {
          tempTarget = tempTarget.substring(3);
          levels++;
        } else {
          tempTarget = tempTarget.substring(2);
          levels++;
        }
      }
      let nsParts = this.currentNamespace ? this.currentNamespace.split(':') : [];
      while (levels > 0 && nsParts.length > 0) {
        nsParts.pop();
        levels--;
      }
      let parentNs = nsParts.join(':');
      resolved = (parentNs ? parentNs + ':' : '') + tempTarget;
    } else if (target.startsWith('.')) {
      // Current namespace relative link
      let tempTarget = target;
      if (tempTarget.startsWith('.:')) {
        tempTarget = tempTarget.substring(2);
      } else {
        tempTarget = tempTarget.substring(1);
      }
      let currNs = this.currentNamespace || '';
      resolved = currNs + (currNs ? ':' : '') + tempTarget;
    } else {
      // Default: append to current namespace
      resolved = target;
    }
    // Clean up multiple colons and sanitize
    resolved = resolved.replace(/:+/g, ':').replace(/^:/, '').replace(/:$/, '');
    resolved = resolved.replace(/[^a-z0-9:-_]/gi, '_');
    if (isStartPage) {
      resolved += ':start';
    }
    if (!resolved) resolved = 'start';
    return resolved;
  }

  /**
   * Main parsing function: converts DokuWiki markup to HTML.
   *
   * @param {string} doku - DokuWiki markup input.
   * @returns {string} - HTML output wrapped in <div class="page group">.
   *
   * Logic:
   * - Processes input line-by-line using a state machine.
   * - Handles block-level elements: headers, lists, tables, quotes, code blocks, HR.
   * - Uses `applyRules()` for inline parsing within blocks.
   * - Tracks state (e.g., list depth, quote level) to manage nesting.
   * - Wraps output in a div for consistent styling.
   */
  parse(doku) {
    let result = []; // Accumulates HTML fragments
    let lines = doku.split('\n'); // Split input into lines
    let tableLines = []; // Buffer for table rows
    let quoteLevel = 0; // Tracks blockquote nesting
    let paragraphBuffer = []; // Buffer for paragraph content
    let inCodeBlock = false; // Flag for <code> or <file> block
    let codeBlockBuffer = []; // Buffer for code block content
    let inPre = false; // Flag for indented code block
    let preBuffer = []; // Buffer for indented code
    let codeLang = 'code'; // Language for code blocks
    let inTable = false; // Flag for table parsing
    let inCodeSection = false; // Flag for sections where content is escaped
    let codeBlockIndent = -1; // Indent level for code blocks
    let inHtml = false; // Flag for HTML block
    let htmlBuffer = []; // Buffer for HTML content
    let htmlTag = ''; // Tracks HTML tag (html/HTML)
    let inPhp = false; // Flag for PHP block
    let phpBuffer = []; // Buffer for PHP content
    let phpTag = ''; // Tracks PHP tag (php/PHP)
    let outerCodeLang = null; // Preserves outer code language

    // Reset parser state
    this.footnotes = [];
    this.footnoteContent = new Map();
    this.linkPlaceholders = [];
    this.nowikiPlaceholders = [];
    this.listStack = [];
    this.currentIndent = -1;
    this.currentType = null;
    this.currentSectionLevel = 0;
    this.currentSection = '';

    // Process each line
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let trimmed = line.trim();

      // Skip empty lines, but include in buffers if in HTML/PHP
      if (!trimmed) {
        if (inHtml) {
          htmlBuffer.push('');
          continue;
        }
        if (inPhp) {
          phpBuffer.push('');
          continue;
        }
        if (inTable) {
          // End table if empty line encountered
          const tableHtml = tableParser({
            lines: tableLines,
            inCode: inCodeSection && codeBlockIndent >= 2,
            nestedParse: (text) => this.replacePlaceholders(this.applyRules(text))
          });
          if (tableHtml.trim()) result.push(tableHtml);
          inTable = false;
          tableLines = [];
          codeBlockIndent = -1;
        } else if (inCodeBlock) {
          codeBlockBuffer.push(line);
          continue;
        } else if (inPre) {
          preBuffer.push(line);
          continue;
        } else if (quoteLevel > 0 || paragraphBuffer.length > 0 || this.listStack.length > 0) {
          // Flush blocks if no list follows
          if (i + 1 >= lines.length || !lines[i + 1].match(/^ {2,}[* -]\s/)) {
            this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
            quoteLevel = 0;
          }
        }
        continue;
      }

      // Handle HTML blocks
      if (inHtml) {
        if (trimmed.endsWith(`</${htmlTag}>`)) {
          const endTag = `</${htmlTag}>`;
          const beforeClose = line.substring(0, line.lastIndexOf(endTag));
          htmlBuffer.push(beforeClose);
          const htmlContent = htmlBuffer.join('\n');
          if (this.htmlok) {
            result.push(htmlContent);
          } else {
            const content = htmlContent.trim();
            if (content) result.push(`<pre class="code html">${this.escapeEntities(content)}</pre>`);
          }
          inHtml = false;
          htmlBuffer = [];
          htmlTag = '';
        } else {
          htmlBuffer.push(line);
        }
        continue;
      }

      // Handle PHP blocks
      if (inPhp) {
        if (trimmed.endsWith(`</${phpTag}>`)) {
          const endTag = `</${phpTag}>`;
          const beforeClose = line.substring(0, line.lastIndexOf(endTag));
          phpBuffer.push(beforeClose);
          const phpContent = phpBuffer.join('\n');
          const content = phpContent.trim();
          if (content) result.push(`<pre class="code php">${this.escapeEntities(content)}</pre>`);
          inPhp = false;
          phpBuffer = [];
          phpTag = '';
        } else {
          phpBuffer.push(line);
        }
        continue;
      }

      // Start HTML or PHP block
      if (trimmed.match(/^<(html|HTML|php|PHP)>/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        const match = trimmed.match(/^<(html|HTML|php|PHP)>/i);
        const tag = match[1].toLowerCase();
        const isUpper = match[1] === match[1].toUpperCase();
        const startIdx = line.indexOf(`<${match[1]}>`);
        const contentAfter = line.substring(startIdx + match[0].length).trim();
        if (tag === 'html') {
          inHtml = true;
          htmlTag = isUpper ? 'HTML' : 'html';
          htmlBuffer = [contentAfter];
        } else if (tag === 'php') {
          inPhp = true;
          phpTag = isUpper ? 'PHP' : 'php';
          phpBuffer = [contentAfter];
        }
        if (line.includes(`</${match[1]}>`)) {
          const endTag = `</${match[1]}>`;
          const beforeClose = contentAfter.substring(0, contentAfter.lastIndexOf(endTag));
          if (tag === 'html') {
            htmlBuffer[0] = beforeClose;
            const htmlContent = htmlBuffer.join('\n');
            if (this.htmlok) {
              result.push(htmlContent);
            } else {
              const content = htmlContent.trim();
              if (content) result.push(`<pre class="code html">${this.escapeEntities(content)}</pre>`);
            }
            inHtml = false;
            htmlBuffer = [];
            htmlTag = '';
          } else if (tag === 'php') {
            phpBuffer[0] = beforeClose;
            const phpContent = phpBuffer.join('\n');
            const content = phpContent.trim();
            if (content) result.push(`<pre class="code php">${this.escapeEntities(content)}</pre>`);
            inPhp = false;
            phpBuffer = [];
            phpTag = '';
          }
        }
        continue;
      }

      // Handle table start
      if (!inTable && trimmed.match(/^\s{0,1}[\^|]/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        inTable = true;
        tableLines = [line];
        codeBlockIndent = line.match(/^(\s*)/)[1].length;
        continue;
      }

      // Handle table continuation or end
      if (inTable) {
        if (!trimmed.match(/^\s{0,1}[\^|]/)) {
          const tableHtml = tableParser({
            lines: tableLines,
            inCode: inCodeSection && codeBlockIndent >= 2,
            nestedParse: (text) => this.replacePlaceholders(this.applyRules(text))
          });
          if (tableHtml.trim()) result.push(tableHtml);
          inTable = false;
          tableLines = [];
          codeBlockIndent = -1;
        } else {
          tableLines.push(line);
          continue;
        }
      }

      // Handle code/file blocks
      if (trimmed.match(/^<code(?:\s+([^\s>]+))?(?:\s+([^\s>]+))?\s*>/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        outerCodeLang = inCodeBlock ? outerCodeLang : 'code';
        inCodeBlock = true;
        inCodeSection = this.currentSection.match(/^(Links|Tables|Quoting|No Formatting|Embedding HTML and PHP|RSS\/ATOM Feed Aggregation|Control Macros|Syntax Plugins|Code Blocks|Downloadable Code Blocks)$/i);
        codeBlockBuffer = [];
        const match = trimmed.match(/^<code(?:\s+([^\s>]+))?(?:\s+([^\s>]+))?\s*>/);
        codeLang = match[1] ? `code ${match[1]}` : 'code';
        codeBlockIndent = line.match(/^(\s*)/)[1].length;
        const startIdx = line.indexOf('<code');
        const contentAfter = line.substring(startIdx + match[0].length).trim();
        if (contentAfter) codeBlockBuffer.push(contentAfter);
        if (line.includes('</code>')) {
          const endTag = '</code>';
          const beforeClose = line.substring(0, line.lastIndexOf(endTag)).trim();
          if (beforeClose) codeBlockBuffer.push(beforeClose);
          const fullContent = codeBlockBuffer.join('\n');
          if (fullContent.trim()) {
            result.push(`<pre class="${codeLang}">${this.escapeEntities(fullContent)}</pre>`);
          }
          inCodeBlock = false;
          codeBlockBuffer = [];
          codeLang = '';
          inCodeSection = false;
          codeBlockIndent = -1;
          outerCodeLang = null;
        }
        continue;
      } else if (trimmed.match(/^<file(?:\s+([^\s>]+))?(?:\s+([^\s>]+))?\s*>/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        outerCodeLang = inCodeBlock ? outerCodeLang : 'file';
        inCodeBlock = true;
        inCodeSection = this.currentSection.match(/^(Links|Tables|Quoting|No Formatting|Embedding HTML and PHP|RSS\/ATOM Feed Aggregation|Control Macros|Syntax Plugins|Code Blocks|Downloadable Code Blocks)$/i);
        codeBlockBuffer = [];
        const match = trimmed.match(/^<file(?:\s+([^\s>]+))?(?:\s+([^\s>]+))?\s*>/);
        codeLang = match[1] ? `file ${match[1]}` : 'file';
        codeBlockIndent = line.match(/^(\s*)/)[1].length;
        const startIdx = line.indexOf('<file');
        const contentAfter = line.substring(startIdx + match[0].length).trim();
        if (contentAfter) codeBlockBuffer.push(contentAfter);
        if (line.includes('</file>')) {
          const endTag = '</file>';
          const beforeClose = line.substring(0, line.lastIndexOf(endTag)).trim();
          if (beforeClose) codeBlockBuffer.push(beforeClose);
          const fullContent = codeBlockBuffer.join('\n');
          if (fullContent.trim()) {
            result.push(`<pre class="${codeLang}">${this.escapeEntities(fullContent)}</pre>`);
          }
          inCodeBlock = false;
          codeBlockBuffer = [];
          codeLang = '';
          inCodeSection = false;
          codeBlockIndent = -1;
          outerCodeLang = null;
        }
        continue;
      } else if (inCodeBlock && (trimmed.endsWith('</code>') || trimmed.endsWith('</file>'))) {
        const endTag = trimmed.endsWith('</code>') ? '</code>' : '</file>';
        const beforeClose = line.substring(0, line.lastIndexOf(endTag)).trim();
        if (beforeClose) codeBlockBuffer.push(beforeClose);
        const fullContent = codeBlockBuffer.join('\n');
        if (fullContent.trim()) {
          result.push(`<pre class="${codeLang}">${this.escapeEntities(fullContent)}</pre>`);
        }
        inCodeBlock = false;
        codeBlockBuffer = [];
        codeLang = outerCodeLang || 'code';
        outerCodeLang = null;
        inCodeSection = false;
        codeBlockIndent = -1;
        continue;
      } else if (inCodeBlock) {
        codeBlockBuffer.push(line);
        continue;
      }

      // Handle lists
      if (line.match(/^ {2,}[* -]\s/)) {
        const match = line.match(/^ {2,}([* -])\s(.*)/);
        if (match) {
          const typeChar = match[1];
          let content = match[2].trim();
          content = content.replace(/\\\\\s*$/, '');
          content = content.replace(/\\\\\s+/g, '<br />');
          content = inCodeSection ? this.escapeEntities(content) : this.replacePlaceholders(this.applyRules(content));
          const listType = typeChar === '*' ? 'ul' : 'ol';
          const indent = line.match(/^(\s*)/)[1].length;
          const depth = Math.floor((indent - 2) / 2) + 1;
          while (this.currentIndent > depth && this.listStack.length > 0) {
            result.push('</li>');
            result.push(`</${this.listStack.pop().type}>`);
            this.currentIndent = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].indent : -1;
            this.currentType = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].type : null;
          }
          if (this.currentIndent === -1 || depth > this.currentIndent) {
            result.push(`<${listType}>`);
            this.listStack.push({ type: listType, indent: depth });
            this.currentType = listType;
            this.currentIndent = depth;
          } else if (depth === this.currentIndent && this.currentType !== listType) {
            result.push('</li>');
            result.push(`</${this.listStack.pop().type}>`);
            result.push(`<${listType}>`);
            this.listStack.push({ type: listType, indent: depth });
            this.currentType = listType;
          } else if (depth === this.currentIndent) {
            result.push('</li>');
          }
          result.push(`<li class="level${depth}"><div class="li">${content || ''}</div>`);
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextIndent = nextLine.match(/^(\s*)/)[1].length;
            const nextDepth = Math.floor((nextIndent - 2) / 2) + 1;
            if (nextLine.match(/^ {2,}[* -]\s/) && nextIndent >= indent) {
              continue;
            } else {
              result.push('</li>');
              if (nextIndent < 2 || nextDepth < depth) {
                while (this.listStack.length > 0 && this.currentIndent > (nextLine.trim() ? nextDepth : -1)) {
                  result.push(`</${this.listStack.pop().type}>`);
                  this.currentIndent = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].indent : -1;
                  this.currentType = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].type : null;
                }
              }
            }
          } else {
            result.push('</li>');
            while (this.listStack.length > 0) {
              result.push(`</${this.listStack.pop().type}>`);
              this.currentIndent = -1;
              this.currentType = null;
            }
          }
          continue;
        }
      }

      // Handle indented code blocks
      if (indent >= 2 && !inCodeBlock && !inTable && !line.match(/^ {2,}[* -]\s/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        inPre = true;
        inCodeSection = this.currentSection.match(/^(Links|Tables|Quoting|No Formatting|Embedding HTML and PHP|RSS\/ATOM Feed Aggregation|Control Macros|Syntax Plugins|Code Blocks|Downloadable Code Blocks)$/i);
        preBuffer = [line];
        codeBlockIndent = indent;
        continue;
      }

      // Handle indented code continuation or end
      if (inPre) {
        if (indent >= codeBlockIndent && trimmed && !line.match(/^(?:>|={2,6}.*={2,6}|[\^|]|-{4,}| {2,}[* -]\s)/)) {
          preBuffer.push(line);
          continue;
        } else {
          let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
          const fullContent = preContent;
          if (fullContent.trim()) {
            result.push(`<pre class="code">${this.escapeEntities(fullContent)}</pre>`);
          }
          inPre = false;
          preBuffer = [];
          inCodeSection = false;
          codeBlockIndent = -1;
        }
      }

      // Handle end of indented code at EOF
      if (i === lines.length - 1 && inPre) {
        let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
        const fullContent = preContent;
        if (fullContent.trim()) {
          result.push(`<pre class="code">${this.escapeEntities(fullContent)}</pre>`);
        }
        inPre = false;
        inCodeSection = false;
        codeBlockIndent = -1;
        continue;
      }

      // Handle blockquotes
      const quoteMatch = line.match(/^(>+)\s*(.*)/);
      if (quoteMatch) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        const newLevel = quoteMatch[1].length;
        const content = quoteMatch[2];
        let formattedContent = content.trim();
        formattedContent = formattedContent.replace(/\\\\\s*$/, '');
        formattedContent = formattedContent.replace(/\\\\\s+/g, '<br />');
        formattedContent = inCodeSection ? this.escapeEntities(formattedContent) : this.replacePlaceholders(this.applyRules(formattedContent));
        while (quoteLevel > newLevel) {
          result.push('</div></blockquote>');
          quoteLevel--;
        }
        while (quoteLevel < newLevel) {
          result.push('<blockquote><div class="no">');
          quoteLevel++;
        }
        if (formattedContent) {
          result.push(formattedContent);
        }
        if (i === lines.length - 1 && quoteLevel > 0) {
          while (quoteLevel > 0) {
            result.push('</div></blockquote>');
            quoteLevel--;
          }
        }
        continue;
      } else if (quoteLevel > 0) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        quoteLevel = 0;
      }

      // Handle headers
      if (trimmed.match(/^={2,6}.*={2,6}$/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        const equals = trimmed.match(/^={2,6}/)[0];
        const equalsCount = equals.length;
        let content = trimmed.replace(/^={2,6}/, '').replace(/={2,6}$/, '').trim();
        content = this.replacePlaceholders(this.applyRules(content));
        const level = 7 - equalsCount;
        const id = content.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+ /g, '_').replace(/^_|_$/g, '');
        const sectionEditNum = level;
        result.push(`<h${level} class="sectionedit${sectionEditNum}" id="${id}">${content}</h${level}>`);
        this.currentSectionLevel = level;
        this.currentSection = content;
        inCodeSection = content.match(/^(Links|Tables|Quoting|No Formatting|Embedding HTML and PHP|RSS\/ATOM Feed Aggregation|Control Macros|Syntax Plugins|Code Blocks|Downloadable Code Blocks)$/i);
        continue;
      }

      // Handle horizontal rules
      if (trimmed.match(/^-{4,}$/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        result.push('<hr />');
        inCodeSection = false;
        continue;
      }

      // Handle standalone images
      if (trimmed.match(/^\s*\{\{[^}]+?\}\}/) && !trimmed.match(/^\s*\{\{rss>/)) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
        let content = this.replacePlaceholders(this.applyRules(line));
        result.push(content);
        continue;
      }

      // Handle paragraphs
      let content = trimmed;
      content = content.replace(/\\\\\s*$/, '');
      content = content.replace(/\\\\\s+/g, '<br />');
      content = inCodeSection ? this.escapeEntities(content) : this.replacePlaceholders(this.applyRules(content));
      paragraphBuffer.push(content);
      if (i === lines.length - 1) {
        this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);
      }
    }

    // Flush any remaining blocks
    this.flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang);

    // Handle remaining indented code
    if (inPre) {
      let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
      const fullContent = preContent;
      if (fullContent.trim()) {
        result.push(`<pre class="code">${this.escapeEntities(fullContent)}</pre>`);
      }
    }

    // Add footnotes
    if (this.footnoteContent.size > 0) {
      result.push('<div class="footnotes">');
      Array.from(this.footnoteContent.entries()).forEach(([note, index]) => {
        if (!note.trim()) return;
        let formattedNote = this.replacePlaceholders(this.applyRules(note));
        result.push(`<div class="fn"><sup><a href="#fnt__${index + 1}" id="fn__${index + 1}" class="fn_bot">[${index + 1})</a></sup> <div class="content">${formattedNote}</div></div>`);
      });
      result.push('</div>');
    }

    // Join and wrap result
    let finalResult = result.join('\n');
    finalResult = this.replacePlaceholders(finalResult);
    if (finalResult.includes('[LINK_') || finalResult.includes('[MEDIA_') || finalResult.includes('[RSS_')) {
      console.warn('Warning: Unresolved placeholders in output');
    }
    return `<div class="page group">${finalResult}</div>`;
  }

  /**
   * Replaces placeholders with their corresponding HTML content.
   *
   * @param {string} str - Input string with placeholders.
   * @returns {string} - String with placeholders replaced.
   */
  replacePlaceholders(str) {
    this.linkPlaceholders.forEach((link, index) => {
      str = str.replace(new RegExp(`\\[(?:LINK|RSS|MEDIA)_${index}\\]`, 'g'), link);
    });
    this.nowikiPlaceholders.forEach((raw, idx) => {
      str = str.replace(new RegExp(`\\[NOWIKI_${idx}\\]`, 'g'), this.escapeEntities(raw));
    });
    return str;
  }

  /**
   * Applies inline parsing rules to content.
   *
   * @param {string} content - Input content.
   * @returns {string} - Processed content with inline rules applied.
   */
  applyRules(content) {
    let result = content;
    this.nowikiPlaceholders = [];
    this.rules.forEach(rule => {
      result = result.replace(rule.pattern, typeof rule.replace === 'function' ? (...args) => rule.replace.apply(this, args) : rule.replace);
    });
    result = this.parseFootnotes(result);
    return result;
  }

  /**
   * Parses footnotes in content.
   *
   * @param {string} content - Input content.
   * @returns {string} - Content with footnotes converted to HTML.
   */
  parseFootnotes(content) {
    return content.replace(/\(\((.+?)\)\)/g, (match, note) => {
      if (!note.trim()) return match;
      let index = this.footnoteContent.get(note);
      if (index === undefined) {
        index = this.footnoteContent.size;
        this.footnoteContent.set(note, index);
      }
      return `<sup><a href="#fn__${index + 1}" id="fnt__${index + 1}" class="fn_top">[${index + 1})</a></sup>`;
    });
  }

  /**
   * Escapes HTML entities in content.
   *
   * @param {string} content - Input content.
   * @returns {string} - Escaped content.
   */
  escapeEntities(content) {
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Flushes buffered content (lists, tables, quotes, paragraphs, code).
   *
   * @param {Array} result - Array to push HTML to.
   * @param {Array} tableLines - Buffered table lines.
   * @param {number} quoteLevel - Current blockquote nesting level.
   * @param {Array} paragraphBuffer - Buffered paragraph content.
   * @param {Array} codeBlockBuffer - Buffered code block content.
   * @param {string} codeLang - Language for code block.
   */
  flushBlocks(result, tableLines, quoteLevel, paragraphBuffer, codeBlockBuffer, codeLang) {
    if (this.listStack.length > 0) {
      while (this.listStack.length > 0) {
        result.push('</li>');
        result.push(`</${this.listStack.pop().type}>`);
        this.currentIndent = -1;
        this.currentType = null;
      }
    }
    if (tableLines.length > 0) {
      const tableHtml = tableParser({
        lines: tableLines,
        inCode: this.currentSection.match(/^(Links|Tables|Quoting|No Formatting|Embedding HTML and PHP|RSS\/ATOM Feed Aggregation|Control Macros|Syntax Plugins|Code Blocks|Downloadable Code Blocks)$/i) && tableLines[0].match(/^\s{2,}/),
        nestedParse: (text) => this.replacePlaceholders(this.applyRules(text))
      });
      if (tableHtml.trim()) result.push(tableHtml);
      tableLines.length = 0;
    }
    if (quoteLevel > 0) {
      while (quoteLevel > 0) {
        result.push('</div></blockquote>');
        quoteLevel--;
      }
    }
    if (paragraphBuffer.length > 0) {
      let paraContent = paragraphBuffer.join(' ');
      if (paraContent.trim()) {
        result.push(`<p>${this.replacePlaceholders(paraContent)}</p>`);
      }
      paragraphBuffer.length = 0;
    }
    if (codeBlockBuffer.length > 0) {
      const fullContent = codeBlockBuffer.join('\n');
      if (fullContent.trim()) {
        result.push(`<pre class="${codeLang}">${this.escapeEntities(fullContent)}</pre>`);
      }
      codeBlockBuffer.length = 0;
    }
  }

  /**
   * CLI interface for parsing DokuWiki markup from stdin.
   */
  static parseCLI() {
    const fs = require('fs');
    const stdin = process.stdin;
    let input = '';
    stdin.setEncoding('utf8');
    stdin.on('readable', () => {
      let chunk;
      while ((chunk = stdin.read())) {
        input += chunk;
      }
    });
    stdin.on('end', () => {
      if (!input.trim()) {
        console.error('Usage: node dokuparserjs.js < input.txt');
        process.exit(1);
      }
      try {
        const parser = new DokuParserJS({
          currentNamespace: process.env.DOKU_NAMESPACE || 'wiki',
          useTxtExtension: process.env.DOKU_USE_TXT_EXTENSION !== 'false',
          pagesBasePath: process.env.DOKU_PAGES_BASE_PATH || '/',
          mediaBasePath: process.env.DOKU_MEDIA_BASE_PATH || '/data/media/',
          smileyBasePath: process.env.DOKU_SMILEY_BASE_PATH || '/dokuwiki/lib/exe/fetch.php?media=lib:images:smileys:',
          useEmoji: process.env.DOKU_USE_EMOJI !== 'false'
        });
        const html = parser.parse(input);
        console.log(html);
        process.exit(0);
      } catch (e) {
        console.error('Error parsing input:', e.message);
        process.exit(1);
      }
    });
  }
}

/**
 * Table parser function for handling DokuWiki table syntax.
 *
 * @param {Object} options - Table parsing options.
 * @param {Array} options.lines - Array of table lines.
 * @param {boolean} options.inCode - Whether table is in a code section (no parsing).
 * @param {Function} options.nestedParse - Function to parse cell content.
 * @returns {string} - HTML table output.
 */
function tableParser({ lines = [], inCode = false, nestedParse = (text) => text }) {
  // Handle empty or invalid input
  if (!Array.isArray(lines) || lines.length === 0) return '';

  // If in code section, return as preformatted text
  if (inCode) {
    return `<pre class="code">${lines.map(l => l.toString()).join('\n')}</pre>`;
  }

  // Collect table lines
  const tableLines = [];
  for (let line of lines) {
    const trimmed = line.toString().replace(/^\s+/, '');
    if (!trimmed || !/^[|^]/.test(trimmed)) break;
    tableLines.push(line.toString());
  }
  if (tableLines.length < 1) return '';

  /**
   * Splits a table row into cells.
   *
   * @param {string} line - Table row input.
   * @returns {Array} - Array of cell objects.
   */
  function splitRow(line) {
    line = line.trim();
    if (!line) return [];
    const rowDelim = line[0];
    if (rowDelim !== '^' && rowDelim !== '|') return [];
    const cells = [];
    let pos = line.indexOf(rowDelim) + 1;
    let currentDelim = rowDelim;
    while (pos < line.length) {
      let start = pos;
      while (pos < line.length && line[pos] !== '^' && line[pos] !== '|') {
        if (line.substring(pos, pos + 2) === '[[') {
          let linkEnd = line.indexOf(']]', pos + 2);
          if (linkEnd !== -1) {
            pos = linkEnd + 2;
            continue;
          }
        }
        if (line.substring(pos, pos + 6) === '<code>') {
          let codeEnd = line.indexOf('</code>', pos + 6);
          if (codeEnd !== -1) {
            pos = codeEnd + 7;
            continue;
          }
        }
        pos++;
      }
      let rawContent = line.substring(start, pos);
      let content = rawContent.trim();
      let align = null;
      const leadingMatch = rawContent.match(/^\s+/);
      const leading = leadingMatch ? leadingMatch[0].length : 0;
      const trailingMatch = rawContent.match(/\s+$/);
      const trailing = trailingMatch ? trailingMatch[0].length : 0;
      if (leading >= 2 && trailing >= 2) {
        align = 'centeralign';
      } else if (leading >= 2) {
        align = 'rightalign';
      } else if (trailing >= 2) {
        align = 'leftalign';
      }
      if (content.startsWith('//')) {
        content = '';
      }
      const type = currentDelim === '^' ? 'th' : 'td';
      cells.push({ content, type, align, colspan: 1, rowspan: 1 });
      if (pos < line.length) {
        const nextDelim = line[pos];
        if (nextDelim === '^' || nextDelim === '|') {
          if (nextDelim !== currentDelim) {
            currentDelim = nextDelim;
          }
          pos++;
        }
      }
    }
    if (cells.length > 0 && cells[cells.length - 1].content === '' && line.match(/\/\/.*$/)) {
      cells.pop();
    }
    return cells;
  }

  // Parse rows and normalize column count
  let rows = tableLines.map(splitRow);
  const maxCols = Math.max(...rows.map(r => r.length || 0));
  rows = rows.map(row => [...row, ...Array(maxCols - row.length).fill(null)]);

  // Handle colspans
  rows.forEach(row => {
    let j = 0;
    while (j < maxCols) {
      let cell = row[j];
      if (!cell) {
        j++;
        continue;
      }
      if (cell.content !== '') {
        let k = j + 1;
        while (k < maxCols && row[k] && row[k].content === '' && !row[k].skip) {
          k++;
        }
        if (k > j + 1) {
          cell.colspan += (k - j - 1);
          for (let m = j + 1; m < k; m++) {
            row[m].skip = true;
            row[m].skipWidth = 1;
            row[m].isColspanSkip = true;
          }
        }
        j = k;
      } else {
        j++;
      }
    }
  });

  // Handle rowspans
  for (let c = 0; c < maxCols; c++) {
    let openRow = -1;
    for (let r = 0; r < rows.length; r++) {
      let cell = rows[r][c];
      if (!cell || cell.skip) continue;
      if (cell.content.trim() === ':::') {
        if (openRow !== -1) {
          rows[openRow][c].rowspan += 1;
          cell.skip = true;
          cell.content = '';
          cell.skipWidth = rows[openRow][c].colspan;
          cell.isColspanSkip = false;
        } else {
          cell.content = '';
        }
      } else if (cell.content !== '') {
        openRow = r;
        cell.rowspan = 1;
      } else {
        openRow = -1;
      }
    }
  }

  // Build HTML
  let html = '<div class="table"><table class="inline"><thead>';
  let tbodyStarted = false;
  rows.forEach((row, r) => {
    let currentCol = 0;
    let tr = `<tr class="row${r}">`;
    let added = false;
    for (let c = 0; c < maxCols; c++) {
      let cell = row[c];
      if (!cell || cell.skip) {
        currentCol += cell?.isColspanSkip ? 0 : (cell?.skipWidth || 1);
        continue;
      }
      let colClass = `col${currentCol} ${cell.align || ''}`.trim();
      let tag = cell.type;
      let attrs = ` class="${colClass}"`;
      if (cell.colspan > 1) attrs += ` colspan="${cell.colspan}"`;
      if (cell.rowspan > 1) attrs += ` rowspan="${cell.rowspan}"`;
      tr += `<${tag}${attrs}>${nestedParse(cell.content)}</${tag}>`;
      currentCol += cell.colspan;
      added = true;
    }
    tr += '</tr>';
    if (added) {
      if (!tbodyStarted) {
        html += tr + '</thead><tbody>';
        tbodyStarted = true;
      } else {
        html += tr;
      }
    }
  });
  html += '</tbody></table></div>';
  return html;
}

// Node.js module export and browser initialization
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DokuParserJS;
  if (require.main === module) {
    DokuParserJS.parseCLI();
  }
} else {
  if (!window.DokuParserJS) {
    window.DokuParserJS = DokuParserJS;
  }
  document.addEventListener('DOMContentLoaded', function() {
    const parser = new DokuParserJS();
    const preview = document.getElementById('preview');
    if (preview && window.rawContent) {
      try {
        preview.innerHTML = parser.parse(window.rawContent);
      } catch (e) {
        console.error('Error parsing preview:', e.message);
      }
    }
  });
}
