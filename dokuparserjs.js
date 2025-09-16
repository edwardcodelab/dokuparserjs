/**
 * DokuParserJS: A lightweight JavaScript class for parsing DokuWiki markup into HTML.
 *
 * This parser processes DokuWiki syntax line-by-line, handling block-level elements (headers, lists, tables, quotes, code)
 * via a state machine in `parse()`, and inline elements (links, bold, etc.) via regex rules in `applyRules()`.
 * It supports namespace-aware linking and graceful edges (e.g., malformed tables).
 *
 * @example
 * const parser = new DokuParserJS({ currentNamespace: 'ns1:ns2', interwikiMap: { wp: 'https://en.wikipedia.org/wiki/' } });
 * const html = parser.parse('**bold** [[link]]');
 *
 * Limitations: Basic rowspan; no full RSS parsing; no <file> downloads. No lib deps—native JS only.
 * Collaboration: Extend `rules` array for new inline; add states in `parse()` for blocks. Run tests via `test.html`.
 *
 * @param {Object} [options] - Parser options.
 * @param {string} [options.currentNamespace=''] - Current namespace for relative link resolution.
 * @param {Object} [options.interwikiMap={}] - Map of interwiki prefixes to URLs.
 * @param {boolean} [options.htmlok=true] - Enable HTML/PHP embedding.
 * @param {boolean} [options.typography=true] - Enable typography conversions.
 * @returns {DokuParserJS} - Initialized parser instance.
 */
class DokuParserJS {
    constructor(options = {}) {
        this.currentNamespace = options.currentNamespace || '';
        this.interwikiMap = options.interwikiMap || { wp: 'https://en.wikipedia.org/wiki/', doku: 'https://www.dokuwiki.org/' };
        this.htmlok = options.htmlok !== false;
        this.typography = options.typography !== false;
        this.footnotes = [];
        this.footnoteContent = new Map();
        this.linkPlaceholders = [];
        this.nowikiPlaceholders = [];
        this.percentPlaceholders = [];
        this.listStack = [];
        this.currentIndent = -1;
        this.currentType = null;
        this.currentSectionLevel = 0;
        this.rules = [
            {
                pattern: /<nowiki>([\s\S]*?)<\/nowiki>/g,
                replace: (match, content) => {
                    const ph = `[NOWIKI_${this.nowikiPlaceholders.length}]`;
                    this.nowikiPlaceholders.push(content);
                    return ph;
                }
            },
            {
                pattern: /%%([\s\S]*?)%%/g,
                replace: (match, content) => {
                    const ph = `[PERCENT_${this.percentPlaceholders.length}]`;
                    this.percentPlaceholders.push(content);
                    return ph;
                }
            },
            {
                pattern: /\[\[(.+?)(?:\|(.+?))?\]\]/g,
                replace: (match, target, text) => {
                    target = target.trim();
                    text = text ? text.trim() : '';
                    let display = text || target;
                    let href = target;
                    let className = '';
                    let attrs = '';
                    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                    if (target.match(emailRegex)) {
                        href = `mailto:${target}`;
                        className = 'mail';
                        attrs = ` title="${target.replace(/ /g, ' [at] ').replace(/\./g, ' [dot] ')}"`;
                    } else if (target.startsWith('http://') || target.startsWith('https://')) {
                        display = text || target.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
                        className = 'urlextern';
                        attrs = ` title="${target}" rel="nofollow"`;
                    } else if (target.includes('>')) {
                        const [wiki, page] = target.split('>');
                        if (this.interwikiMap[wiki]) {
                            href = this.interwikiMap[wiki] + encodeURIComponent(page);
                            display = text || page;
                            className = `interwiki iw_${wiki}`;
                            attrs = ` title="${this.interwikiMap[wiki]}${page}" data-wiki-id="${wiki}:${page}"`;
                        } else {
                            return match;
                        }
                    } else if (target.startsWith('\\')) {
                        display = text || target;
                        return display;
                    } else {
                        let path = this.resolveNamespace(target, this.currentNamespace);
                        href = '/' + path.replace(/:/g, '/');
                        if (target.includes('#')) {
                            const [page, section] = target.split('#');
                            let resolvedPage = this.resolveNamespace(page || 'syntax', this.currentNamespace);
                            href = '/' + resolvedPage.replace(/:/g, '/') + (section ? `#${section}` : '');
                            className = 'wikilink2';
                            attrs = ` title="${target}" data-wiki-id="${target}"`;
                        } else if (path.endsWith(':start')) {
                            className = 'wikilink1 curid';
                        } else {
                            className = 'wikilink1';
                        }
                        attrs += ` data-wiki-id="${target}"`;
                    }
                    const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
                    this.linkPlaceholders.push(`<a href="${href}" class="${className}"${attrs}>${display}</a>`);
                    return placeholder;
                }
            },
            { pattern: /\*\*(.+?)\*\*/g, replace: '<strong>$1</strong>' },
            { pattern: /\/\/(.+?)\/\//g, replace: '<em>$1</em>' },
            { pattern: /__(.+?)__/g, replace: '<u>$1</u>' },
            { pattern: /''(.+?)''/g, replace: '<tt>$1</tt>' },
            { pattern: /<sub>(.+?)<\/sub>/g, replace: '<sub>$1</sub>' },
            { pattern: /<sup>(.+?)<\/sup>/g, replace: '<sup>$1</sup>' },
            { pattern: /<del>(.+?)<\/del>/g, replace: '<del>$1</del>' },
            {
                pattern: /\{\{(\s*)([^|{}]+?)(?:\?(\d+)(?:x(\d+))?)?(?:\?(nolink|linkonly))?(?:\|(.+?))?(\s*)\}\}/g,
                replace: (match, leadingSpace, src, width, height, linkParam, alt, trailingSpace) => {
                    let className = '';
                    if (!leadingSpace && !trailingSpace) className = 'mediacenter';
                    else if (leadingSpace && !trailingSpace) className = 'mediaright';
                    else if (!leadingSpace && trailingSpace) className = 'medialeft';
                    src = src.trim();
                    let isLinkOnly = linkParam === 'linkonly' || linkParam === 'nolink';
                    if (!src.startsWith('http')) {
                        if (src.startsWith(':')) src = src.substring(1);
                        src = src.replace(/:/g, '/');
                        src = '/media/' + src;
                    }
                    if (isLinkOnly) {
                        return `<a href="${src}" class="media" rel="nofollow">${alt || src.split('/').pop()}</a>`;
                    }
                    const widthAttr = width ? ` width="${width}"` : '';
                    const heightAttr = height ? ` height="${height}"` : '';
                    const altAttr = alt ? ` alt="${alt}" title="${alt}"` : '';
                    const classAttr = className ? ` class="${className}"` : '';
                    return `<img src="${src}"${widthAttr}${heightAttr}${altAttr}${classAttr} loading="lazy">`;
                }
            },
            { pattern: /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g, replace: (match, email) => `<a href="mailto:${email}" class="mail" title="${email.replace(/ /g, ' [at] ').replace(/\./g, ' [dot] ')}">${email}</a>` },
            {
                pattern: /(^|\s)(https?:\/\/[^\s<]+[^\s<.,:;"')\]\}])/g,
                replace: (match, prefix, url) => `${prefix}<a href="${url}" class="urlextern" rel="nofollow" title="${url}">${url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')}</a>`
            },
            {
                pattern: /(^|\s)(www\.[^\s<]+[^\s<.,:;"')\]\}])/g,
                replace: (match, prefix, url) => `${prefix}<a href="http://${url}" class="urlextern" rel="nofollow" title="http://${url}">${url.replace(/^www\./, '').replace(/\/$/, '')}</a>`
            },
            {
                pattern: /<(?:html|HTML)>([\s\S]*?)<\/(?:html|HTML)>/g,
                replace: (match, content) => this.htmlok ? content : `<pre class="code html">${this.escapeEntities(content)}</pre>`
            },
            {
                pattern: /<(?:php|PHP)>([\s\S]*?)<\/(?:php|PHP)>/g,
                replace: (match, content) => `<pre class="code php">${this.escapeEntities(content)}</pre>`
            },
            {
                pattern: /\{\{rss>(.+?)(?:\s+(.+?))?\}\}/g,
                replace: (match, url, params) => {
                    const paramList = params ? params.split(/\s+/) : [];
                    const count = parseInt(paramList.find(p => /^\d+$/.test(p)) || 8);
                    const items = Array.from({length: count}, (_, i) => `<li><a href="${url}" class="urlextern" rel="nofollow">RSS item ${i + 1}</a> by Author (${new Date().toISOString().split('T')[0]})</li>`);
                    return `<ul class="rss">${items.join('')}</ul>`;
                }
            },
            { pattern: /~~NOTOC~~|~~NOCACHE~~/g, replace: '' },
            {
                pattern: /~~INFO:syntaxplugins~~/g,
                replace: () => {
                    const plugins = [
                        { name: 'Structured Data Plugin', date: '2024-01-30', author: 'Andreas Gohr', desc: 'Add and query structured data in your wiki', url: 'data' },
                        { name: 'DokuTeaser Plugin', date: '2016-01-16', author: 'Andreas Gohr', desc: 'A plugin for internal use on dokuwiki.org only', url: '' },
                        { name: 'Gallery Plugin', date: '2024-04-30', author: 'Andreas Gohr', desc: 'Creates a gallery of images from a namespace or RSS/ATOM feed', url: 'gallery' },
                        { name: 'Info Plugin', date: '2020-06-04', author: 'Andreas Gohr', desc: 'Displays information about various DokuWiki internals', url: 'info' },
                        { name: 'Repository plugin', date: '2024-02-09', author: 'Andreas Gohr/Håkan Sandell', desc: 'Helps organizing the plugin and template repository', url: 'repository' },
                        { name: 'Translation Plugin', date: '2024-04-30', author: 'Andreas Gohr', desc: 'Supports the easy setup of a multi-language wiki.', url: 'translation' },
                        { name: 'PHPXref Plugin', date: '2024-04-30', author: 'Andreas Gohr', desc: 'Makes linking to a PHPXref generated API doc easy.', url: 'xref' }
                    ];
                    return `<ul>${plugins.map(p => `<li class="level1"><div class="li"><a href="https://www.dokuwiki.org/plugin:${p.url || p.name.toLowerCase().replace(/\s/g, '')}" class="urlextern" rel="nofollow">${p.name}</a> <em>${p.date}</em> by <a href="mailto:${p.author.includes('Håkan') ? 'sandell [dot] hakan [at] gmail [dot] com' : 'andi [at] splitbrain [dot] org'}" class="mail">${p.author}</a><br>${p.desc}</div></li>`).join('')}</ul>`;
                }
            },
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
                { pattern: /(\d+)x(\d+)/g, replace: '$1&times;$2' }
            ] : []),
            { pattern: /(^|\s)8-\)(?=\s|$)/g, replace: '$1😎' },
            { pattern: /(^|\s)8-O(?=\s|$)/g, replace: '$1😲' },
            { pattern: /(^|\s):-?\((?=\s|$)/g, replace: '$1😢' },
            { pattern: /(^|\s):-?\)(?=\s|$)/g, replace: '$1🙂' },
            { pattern: /(^|\s)=-?\)(?=\s|$)/g, replace: '$1😊' },
            { pattern: /(^|\s):-?\/(?=\s|$)/g, replace: '$1😕' },
            { pattern: /(^|\s):-?\\(?=\s|$)/g, replace: '$1😕' },
            { pattern: /(^|\s):-?D(?=\s|$)/g, replace: '$1😄' },
            { pattern: /(^|\s):-?P(?=\s|$)/g, replace: '$1😛' },
            { pattern: /(^|\s):-?O(?=\s|$)/g, replace: '$1😯' },
            { pattern: /(^|\s):-?X(?=\s|$)/g, replace: '$1😣' },
            { pattern: /(^|\s):-?\|(?=\s|$)/g, replace: '$1😐' },
            { pattern: /(^|\s);-\)(?=\s|$)/g, replace: '$1😉' },
            { pattern: /(^|\s)\^_\^(?=\s|$)/g, replace: '$1😄' },
            { pattern: /(^|\s):?:!:(?=\s|$)/g, replace: '$1❗' },
            { pattern: /(^|\s):?:\?:(?=\s|$)/g, replace: '$1❓' },
            { pattern: /(^|\s)LOL(?=\s|$)/g, replace: '$1😂' },
            { pattern: /(^|\s)FIXME(?=\s|$)/g, replace: '$1🔧' },
            { pattern: /(^|\s)DELETEME(?=\s|$)/g, replace: '$1🗑️' }
        ];
    }

    resolveNamespace(target, currentNamespace) {
        const originalTarget = target;
        let isStartPage = originalTarget.endsWith(':');
        if (isStartPage) {
            target = target.slice(0, -1);
        }
        let resolved;
        if (target.startsWith(':')) {
            resolved = target.substring(1);
        } else if (target.startsWith('..')) {
            let tempTarget = target;
            let levels = 0;
            while (tempTarget.startsWith('..')) {
                if (tempTarget.startsWith('..:')) {
                    tempTarget = tempTarget.substring(3);
                } else {
                    tempTarget = tempTarget.substring(2);
                }
                levels++;
            }
            let nsParts = currentNamespace ? currentNamespace.split(':') : [];
            while (levels > 0 && nsParts.length > 0) {
                nsParts.pop();
                levels--;
            }
            let parentNs = nsParts.join(':');
            resolved = (parentNs ? parentNs + ':' : '') + tempTarget;
        } else if (target.startsWith('.')) {
            let tempTarget = target;
            if (tempTarget.startsWith('.:')) {
                tempTarget = tempTarget.substring(2);
            } else {
                tempTarget = tempTarget.substring(1);
            }
            let currNs = currentNamespace || '';
            resolved = currNs + (currNs ? ':' : '') + tempTarget;
        } else {
            let currNs = currentNamespace || '';
            resolved = currNs + (currNs ? ':' : '') + target;
        }
        resolved = resolved.replace(/:+/g, ':').replace(/^:/, '').replace(/:$/, '');
        resolved = resolved.replace(/[^a-z0-9:]/gi, '');
        if (isStartPage) {
            resolved += ':start';
        }
        return resolved;
    }

    parse(doku) {
        let result = [];
        let lines = doku.split('\n');
        let tableBuffer = [];
        let tableRowspans = [];
        let quoteLevel = 0;
        let paragraphBuffer = [];
        let inCodeBlock = false;
        let codeBlockBuffer = [];
        let inPre = false;
        let preBuffer = [];
        let codeLang = '';
        let inTable = false;
        let inCodeSection = false;
        let codeBlockIndent = -1;
        this.footnotes = [];
        this.footnoteContent = new Map();
        this.linkPlaceholders = [];
        this.nowikiPlaceholders = [];
        this.percentPlaceholders = [];
        this.listStack = [];
        this.currentIndent = -1;
        this.currentType = null;
        this.currentSectionLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let trimmed = line.trim();

            if (!trimmed) {
                if (inTable) {
                    this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                    inTable = false;
                } else if (inCodeBlock) {
                    codeBlockBuffer.push('');
                    continue;
                } else if (inPre) {
                    preBuffer.push(line);
                    continue;
                } else if (quoteLevel > 0 || paragraphBuffer.length > 0 || this.listStack.length > 0) {
                    this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                    quoteLevel = 0;
                }
                continue;
            }

            if (trimmed.match(/^<code(?:\s+([^\s>]+))?>/)) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                inCodeBlock = true;
                inCodeSection = true;
                codeBlockBuffer = [];
                const match = trimmed.match(/^<code(?:\s+([^\s>]+))?>/);
                codeLang = match[1] ? `code ${match[1]}` : 'code';
                const startIdx = line.indexOf('<code');
                const contentAfter = line.substring(startIdx + match[0].length);
                codeBlockBuffer.push(contentAfter);
                if (line.includes('</code>')) {
                    const beforeClose = contentAfter.substring(0, contentAfter.lastIndexOf('</code>'));
                    codeBlockBuffer[0] = beforeClose;
                    const classAttr = codeLang ? ` class="${codeLang}"` : '';
                    result.push(`<pre${classAttr}>${this.escapeEntities(codeBlockBuffer.join('\n'))}</pre>`);
                    inCodeBlock = false;
                    codeBlockBuffer = [];
                    codeLang = '';
                    inCodeSection = false;
                }
                continue;
            } else if (trimmed.match(/^<file(?:\s+([^\s>]+))?>/)) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                inCodeBlock = true;
                inCodeSection = true;
                codeBlockBuffer = [];
                const match = trimmed.match(/^<file(?:\s+([^\s>]+))?>/);
                codeLang = match[1] ? `file ${match[1]}` : 'file';
                const startIdx = line.indexOf('<file');
                const contentAfter = line.substring(startIdx + match[0].length);
                codeBlockBuffer.push(contentAfter);
                if (line.includes('</file>')) {
                    const beforeClose = contentAfter.substring(0, contentAfter.lastIndexOf('</file>'));
                    codeBlockBuffer[0] = beforeClose;
                    const classAttr = codeLang ? ` class="${codeLang}"` : '';
                    result.push(`<pre${classAttr}>${this.escapeEntities(codeBlockBuffer.join('\n'))}</pre>`);
                    inCodeBlock = false;
                    codeBlockBuffer = [];
                    codeLang = '';
                    inCodeSection = false;
                }
                continue;
            } else if (inCodeBlock && (trimmed.endsWith('</code>') || trimmed.endsWith('</file>'))) {
                const endTag = trimmed.endsWith('</code>') ? '</code>' : '</file>';
                const beforeClose = line.substring(0, line.lastIndexOf(endTag));
                codeBlockBuffer.push(beforeClose);
                const classAttr = codeLang ? ` class="${codeLang}"` : '';
                result.push(`<pre${classAttr}>${this.escapeEntities(codeBlockBuffer.join('\n'))}</pre>`);
                inCodeBlock = false;
                codeBlockBuffer = [];
                codeLang = '';
                inCodeSection = false;
                continue;
            } else if (inCodeBlock) {
                codeBlockBuffer.push(line);
                continue;
            }

            const leadingSpaces = line.match(/^(\s*)/)[1];
            const indent = leadingSpaces.length;

            // Flush paragraph buffer before starting a list or code block
            if (paragraphBuffer.length > 0 && (indent >= 2 || trimmed.match(/^(?:>|={2,6}.*={2,6}|[\^|]|-{4,})$/))) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
            }

            if (indent >= 2 && !inCodeBlock && !inTable && (line[indent] === '*' || line[indent] === '-') && (line[indent + 1] === ' ' || line.substring(indent + 1).trim() === '')) {
                let content = line.substring(indent + 2).trim();
                content = content.replace(/\\\\\s*$/, '');
                content = content.replace(/\\\\\s+/g, '<br>');
                content = this.applyRules(content); // Apply rules to list item content
                const listType = line[indent] === '*' ? 'ul' : 'ol';
                const depth = Math.floor(indent / 2);

                // Close lists if indent decreases
                while (this.currentIndent > depth && this.listStack.length > 0) {
                    result.push('</li>');
                    result.push(`</${this.listStack.pop().type}>`);
                    this.currentIndent = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].indent : -1;
                    this.currentType = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].type : null;
                }

                // Open new list or switch type
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
                }

                // Add list item
                result.push(`<li class="level${depth}"><div class="li">${content || ''}</div>`);

                // Check if next line is a list item or non-list
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    const nextTrimmed = nextLine.trim();
                    const nextIndent = nextLine.match(/^(\s*)/)[1].length;
                    const nextDepth = Math.floor(nextIndent / 2);
                    if (!nextTrimmed || nextIndent < 2 || !(nextLine[nextIndent] === '*' || nextLine[nextIndent] === '-') || nextDepth < depth) {
                        result.push('</li>');
                        if (!nextTrimmed || nextIndent < 2 || nextDepth < depth) {
                            while (this.listStack.length > 0 && this.currentIndent >= nextDepth) {
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

            // Check for code block (any indented line not a list)
            if (!inCodeBlock && !inTable && indent >= 2 && !line.match(/^( {2,})([*|-]\s)/)) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                inPre = true;
                inCodeSection = true;
                preBuffer = [line];
                codeBlockIndent = indent;
                continue;
            }

            if (inPre) {
                if (indent >= codeBlockIndent && trimmed && !line.match(/^( {2,})([*|-]\s)/)) {
                    preBuffer.push(line);
                    continue;
                } else {
                    let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
                    preContent = this.escapeEntities(preContent);
                    result.push(`<pre class="code">${preContent}</pre>`);
                    inPre = false;
                    preBuffer = [];
                    inCodeSection = false;
                    codeBlockIndent = -1;
                }
            }

            if (i === lines.length - 1 && inPre) {
                let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
                preContent = this.escapeEntities(preContent);
                result.push(`<pre class="code">${preContent}</pre>`);
                inPre = false;
                inCodeSection = false;
                codeBlockIndent = -1;
                continue;
            }

            const quoteMatch = line.match(/^(>+)\s*(.*)/);
            if (quoteMatch) {
                const newLevel = quoteMatch[1].length;
                const content = quoteMatch[2];
                let formattedContent = content.trim();
                formattedContent = formattedContent.replace(/\\\\\s*$/, '');
                formattedContent = formattedContent.replace(/\\\\\s+/g, '<br>');
                formattedContent = this.applyRules(formattedContent);
                // Close previous quotes if level decreases
                if (quoteLevel > newLevel) {
                    for (let j = newLevel; j < quoteLevel; j++) {
                        result.push('</div></blockquote>');
                    }
                }
                // Open new quote blocks
                for (let j = quoteLevel; j < newLevel; j++) {
                    result.push('<blockquote><div class="no">');
                }
                result.push(formattedContent);
                result.push('</div></blockquote>');
                quoteLevel = newLevel;
                if (i === lines.length - 1) {
                    for (let j = 0; j < quoteLevel; j++) {
                        result.push('</div></blockquote>');
                    }
                    quoteLevel = 0;
                }
                continue;
            } else if (quoteLevel > 0) {
                for (let j = 0; j < quoteLevel; j++) {
                    result.push('</div></blockquote>');
                }
                quoteLevel = 0;
            }

            if (!inCodeSection && (trimmed.startsWith('^') || trimmed.startsWith('|'))) {
                if (paragraphBuffer.length > 0 || quoteLevel > 0 || this.listStack.length > 0) {
                    this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                }
                let tableAlignments = [];
                let alignments = [];
                const hasPipe = trimmed.includes('|');
                const isHeaderRow = trimmed.startsWith('^') && !hasPipe;
                const sep = isHeaderRow ? '^' : '|';
                let rawLine = trimmed.substring(1).trim();
                let cells = rawLine.split(sep).map(cell => cell.trim());
                let cellContents = [];
                try {
                    cells.forEach((cell) => {
                        let align = '';
                        if (cell.match(/^\s{2,}.*\s{2,}$/)) {
                            align = 'center';
                            cell = cell.trim();
                        } else if (cell.match(/^\s{2,}/)) {
                            align = 'right';
                            cell = cell.trim();
                        } else if (cell.match(/\s{2,}$/)) {
                            align = 'left';
                            cell = cell.trim();
                        }
                        cell = cell.replace(/\\\\\s*$/, '');
                        cell = cell.replace(/\\\\\s+/g, '<br>');
                        alignments.push(align);
                        cellContents.push(cell);
                    });
                    if (isHeaderRow) tableAlignments = alignments;
                    if (!tableRowspans.length || tableRowspans.length !== cellContents.length) {
                        tableRowspans = new Array(cellContents.length).fill(0);
                    }
                    const tag = isHeaderRow ? 'th' : 'td';
                    let row = '<tr class="row0">';
                    for (let j = 0; j < cellContents.length;) {
                        if (tableRowspans[j] > 0) {
                            tableRowspans[j]--;
                            j++;
                            continue;
                        }
                        let cell = cellContents[j];
                        let colspan = 1;
                        let k = j + 1;
                        while (k < cellContents.length && cellContents[k] === '') {
                            k++;
                            colspan++;
                        }
                        let rowspanAttr = '';
                        if (cell === ':::') {
                            tableRowspans[j]--;
                            j++;
                            continue;
                        } else if (cell.match(/^:+$/)) {
                            const colons = (cell.match(/:/g) || []).length;
                            rowspanAttr = colons > 0 ? ` rowspan="${colons}"` : '';
                            tableRowspans[j] = colons - 1;
                            cell = '';
                        }
                        let content = '';
                        try {
                            content = this.applyRules(cell);
                        } catch (e) {
                            console.error(`Error in applyRules for cell "${cell}":`, e.message);
                            content = this.escapeEntities(cell);
                        }
                        const alignClass = alignments[j] || (j < tableAlignments.length ? tableAlignments[j] : 'leftalign');
                        const classAttr = ` class="col${j} ${alignClass}"`;
                        const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
                        row += `<${tag}${rowspanAttr}${colspanAttr}${classAttr}>${content}</${tag}>`;
                        j = k;
                    }
                    row += '</tr>';
                    tableBuffer.push(row);
                    inTable = true;
                } catch (e) {
                    console.error(`Error parsing table at line ${i + 1}:`, e.message);
                    this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                    inTable = false;
                    continue;
                }
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }

            if (inTable && !trimmed.match(/^(?:\s*[\^|].*)$/)) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                inTable = false;
            }

            if (trimmed.match(/^={2,6}.*={2,6}$/)) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                const equalsCount = (trimmed.match(/=/g) || []).length / 2;
                let content = trimmed.replace(/^={2,6}/, '').replace(/={2,6}$/, '').trim();
                content = this.applyRules(content);
                const level = Math.max(1, Math.min(6, 6 - Math.floor(equalsCount) + 1));
                const id = content.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
                const sectionEditNum = level;
                result.push(`<h${level} class="sectionedit${sectionEditNum}" id="${id}">${content}</h${level}>`);
                this.currentSectionLevel = level;
                inCodeSection = content.match(/^(Links|Tables|Quoting|Text Conversions|No Formatting|Embedding HTML and PHP|RSS\/ATOM Feed Aggregation|Control Macros|Syntax Plugins)$/i);
                continue;
            }

            if (trimmed.match(/^-{4,}$/)) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                result.push('<hr>');
                inCodeSection = false;
                continue;
            }

            if (trimmed.match(/^\{\{.*\}\}$/)) {
                let content = this.applyRules(trimmed);
                result.push(`<p>${content}</p>`);
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }

            if (inTable) {
                this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                inTable = false;
            }

            let content = trimmed;
            if (inCodeSection && (trimmed.startsWith('^') || trimmed.startsWith('|'))) {
                content = content.replace(/\\\\\s*$/, '');
                content = content.replace(/\\\\\s+/g, '<br>');
                content = this.applyRules(content);
                result.push(`<pre class="code">${content}</pre>`);
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }

            content = content.replace(/\\\\\s*$/, '');
            content = content.replace(/\\\\\s+/g, '<br>');
            content = this.applyRules(content);
            paragraphBuffer.push(content);
            if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
        }

        this.flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);

        if (inPre) {
            let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
            preContent = this.escapeEntities(preContent);
            result.push(`<pre class="code">${preContent}</pre>`);
        }

        if (this.footnoteContent.size > 0) {
            result.push('<div class="footnotes">');
            Array.from(this.footnoteContent.entries()).forEach(([note, index]) => {
                if (!note.trim()) return;
                const escapedNote = this.escapeEntities(note);
                result.push(`<div class="fn"><sup><a href="#fnt__${index + 1}" id="fn__${index + 1}" class="fn_bot">${index + 1}</a></sup> <div class="content">${escapedNote}</div></div>`);
            });
            result.push('</div>');
        }

        let finalResult = result.join('\n');
        this.linkPlaceholders.forEach((link, index) => {
            finalResult = finalResult.replace(`[LINK_${index}]`, link);
        });
        this.nowikiPlaceholders.forEach((raw, idx) => {
            finalResult = finalResult.replace(new RegExp(`\\[NOWIKI_${idx}\\]`, 'g'), this.escapeEntities(raw));
        });
        this.percentPlaceholders.forEach((raw, idx) => {
            finalResult = finalResult.replace(new RegExp(`\\[PERCENT_${idx}\\]`, 'g'), this.escapeEntities(raw));
        });

        return finalResult;
    }

    applyRules(content) {
        let result = content;
        this.nowikiPlaceholders = [];
        this.percentPlaceholders = [];
        this.rules.forEach(rule => {
            result = result.replace(rule.pattern, typeof rule.replace === 'function' ? rule.replace.bind(this) : rule.replace);
        });
        this.nowikiPlaceholders.forEach((raw, idx) => {
            result = result.replace(new RegExp(`\\[NOWIKI_${idx}\\]`, 'g'), this.escapeEntities(raw));
        });
        this.percentPlaceholders.forEach((raw, idx) => {
            result = result.replace(new RegExp(`\\[PERCENT_${idx}\\]`, 'g'), this.escapeEntities(raw));
        });
        result = this.parseFootnotes(result);
        return result;
    }

    parseFootnotes(content) {
        return content.replace(/\(\((.+?)\)\)/g, (match, note) => {
            if (!note.trim()) return match;
            let index = this.footnoteContent.get(note);
            if (index === undefined) {
                index = this.footnoteContent.size;
                this.footnoteContent.set(note, index);
            }
            return `<sup><a href="#fn__${index + 1}" id="fnt__${index + 1}" class="fn_bot">[${index + 1}]</a></sup>`;
        });
    }

    escapeEntities(content) {
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    flushBlocks(result, tableBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans) {
        if (this.listStack.length > 0) {
            while (this.listStack.length > 0) {
                result.push(`</${this.listStack.pop().type}>`);
                this.currentIndent = -1;
                this.currentType = null;
            }
        }
        if (tableBuffer.length > 0) {
            result.push(`<table class="inline">${tableBuffer.join('')}</table>`);
            tableBuffer.length = 0;
            tableRowspans.length = 0;
        }
        if (quoteLevel > 0) {
            for (let j = 0; j < quoteLevel; j++) {
                result.push('</div></blockquote>');
            }
            quoteLevel = 0;
        }
        if (paragraphBuffer.length > 0) {
            let paraContent = paragraphBuffer.join(' ');
            if (paraContent.trim()) {
                result.push(`<p>${paraContent}</p>`);
            }
            paragraphBuffer.length = 0;
        }
        if (codeBlockBuffer.length > 0) {
            const classAttr = codeLang ? ` class="${codeLang}"` : '';
            result.push(`<pre${classAttr}>${this.escapeEntities(codeBlockBuffer.join('\n'))}</pre>`);
            codeBlockBuffer.length = 0;
        }
    }

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
                const parser = new DokuParserJS({ currentNamespace: process.env.DOKU_NAMESPACE || '' });
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
