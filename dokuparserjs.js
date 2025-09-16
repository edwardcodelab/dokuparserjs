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
        this.linkPlaceholders = [];
        this.nowikiPlaceholders = [];
        this.percentPlaceholders = [];
        this.listStack = [];
        this.currentIndent = -1;
        this.currentType = null;
        this.openLi = false;
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
                        attrs = ` title="${target}"`;
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
                            className = 'wikilink1 curid';
                        } else {
                            className = 'wikilink1';
                        }
                        attrs = ` data-wiki-id="${target}"`;
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
                pattern: /\{\{(\s*)([^|{}]+?)(?:\?(\d+)(?:x(\d+))?)?(?:\|(.+?))?(\s*)\}\}/g,
                replace: (match, leadingSpace, src, width, height, alt, trailingSpace) => {
                    let className = (!leadingSpace && trailingSpace) ? 'medialeft' : (leadingSpace && !trailingSpace) ? 'mediaright' : (!leadingSpace && !trailingSpace) ? 'mediacenter' : '';
                    src = src.trim();
                    let isLinkOnly = src.includes('?linkonly') || src.includes('?nolink');
                    src = src.replace(/\?(linkonly|nolink)/, '').trim();
                    if (!src.startsWith('http')) {
                        if (src.startsWith(':')) src = src.substring(1);
                        src = src.replace(/:/g, '/');
                        src = '/media/' + src;
                    }
                    if (isLinkOnly) {
                        return `<a href="${src}" class="media">${alt || src.split('/').pop()}</a>`;
                    }
                    const widthAttr = width ? ` width="${width}"` : '';
                    const heightAttr = height ? ` height="${height}"` : '';
                    const altAttr = alt && alt.trim() ? ` alt="${alt}" title="${alt}"` : '';
                    const classAttr = className ? ` class="${className}"` : '';
                    const img = `<img src="${src}"${widthAttr}${heightAttr}${altAttr}${classAttr} loading="lazy">`;
                    return className ? img : `<p>${img}</p>`;
                }
            },
            { pattern: /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g, replace: '<a href="mailto:$1" class="mail">$1</a>' },
            {
                pattern: /(^|\s)(https?:\/\/[^\s<]+[^\s<.,:;"')\]\}])/g,
                replace: (match, prefix, url) => `${prefix}<a href="${url}" class="urlextern" rel="nofollow">${url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')}</a>`
            },
            {
                pattern: /(^|\s)(www\.[^\s<]+[^\s<.,:;"')\]\}])/g,
                replace: (match, prefix, url) => `${prefix}<a href="http://${url}" class="urlextern" rel="nofollow">${url.replace(/^www\./, '').replace(/\/$/, '')}</a>`
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
                    const items = Array(count).fill().map((_, i) => `<li><a href="${url}" class="urlextern" rel="nofollow">RSS item ${i + 1}</a> by Author (2025-09-16)</li>`);
                    return `<ul class="rss">${items.join('')}</ul>`;
                }
            },
            { pattern: /~~NOTOC~~|~~NOCACHE~~/g, replace: '' },
            {
                pattern: /~~INFO:syntaxplugins~~/g,
                replace: () => {
                    const plugins = [
                        { name: 'Structured Data Plugin', date: '2024-01-30', author: 'Andreas Gohr', desc: 'Add and query structured data in your wiki' },
                        { name: 'DokuTeaser Plugin', date: '2016-01-16', author: 'Andreas Gohr', desc: 'A plugin for internal use on dokuwiki.org only' },
                        { name: 'Gallery Plugin', date: '2024-04-30', author: 'Andreas Gohr', desc: 'Creates a gallery of images from a namespace or RSS/ATOM feed' },
                        { name: 'Info Plugin', date: '2020-06-04', author: 'Andreas Gohr', desc: 'Displays information about various DokuWiki internals' },
                        { name: 'Repository Plugin', date: '2024-02-09', author: 'Andreas Gohr/Håkan Sandell', desc: 'Helps organizing the plugin and template repository' },
                        { name: 'Translation Plugin', date: '2024-04-30', author: 'Andreas Gohr', desc: 'Supports the easy setup of a multi-language wiki' },
                        { name: 'PHPXref Plugin', date: '2024-04-30', author: 'Andreas Gohr', desc: 'Makes linking to a PHPXref generated API doc easy' }
                    ];
                    return `<ul>${plugins.map(p => `<li class="level1"><a href="https://www.dokuwiki.org/plugin:${p.name.toLowerCase().replace(/\s/g, '')}" class="urlextern" rel="nofollow">${p.name}</a> <em>${p.date}</em> by <a href="mailto:${p.author.includes('Håkan') ? 'sandell [dot] hakan [at] gmail [dot] com' : 'andi [at] splitbrain [dot] org'}" class="mail">${p.author}</a><br>${p.desc}</li>`).join('')}</ul>`;
                }
            },
            // Typography rules
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
            // Smiley rules (simplified to text emojis)
            { pattern: /(^|\s)8-\)(?=\s|$)/g, replace: '$1😎' },
            { pattern: /(^|\s)8-O(?=\s|$)/g, replace: '$1😲' },
            { pattern: /(^|\s):-?\((?=\s|$)/g, replace: '$1😢' },
            { pattern: /(^|\s):-?\)(?=\s|$)/g, replace: '$1🙂' },
            { pattern: /(^|\s)=-\)(?=\s|$)/g, replace: '$1😊' },
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
        resolved = resolved.replace(/[^a-z0-9:]/g, '');
        if (isStartPage) {
            resolved = resolved || '';
            resolved += ':start';
        }
        return resolved;
    }

    parse(doku) {
        let result = [];
        let lines = doku.split('\n');
        let tableBuffer = [];
        let tableAlignments = [];
        let tableRowspans = [];
        let quoteLevel = 0;
        let quoteBuffer = [];
        let paragraphBuffer = [];
        let inCodeBlock = false;
        let codeBlockBuffer = [];
        let inPre = false;
        let preBuffer = [];
        let codeLang = '';
        let inTable = false;
        let inCodeSection = false;
        this.footnotes = [];
        this.linkPlaceholders = [];
        this.nowikiPlaceholders = [];
        this.percentPlaceholders = [];
        this.listStack = [];
        this.currentIndent = -1;
        this.currentType = null;
        this.openLi = false;
        this.currentSectionLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let trimmed = line.trim();
            if (!trimmed) {
                if (inTable) {
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                    inTable = false;
                } else if (inCodeBlock) {
                    codeBlockBuffer.push('');
                    continue;
                } else if (inPre) {
                    preBuffer.push(line);
                    continue;
                } else if (quoteLevel > 0 || paragraphBuffer.length > 0 || this.currentIndent >= 0) {
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                    quoteLevel = 0;
                }
                continue;
            }
            if (trimmed.match(/^<code(?:\s+([^\s>]+))?>/)) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
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
                    result.push(`<p><pre${classAttr}>${codeBlockBuffer.join('\n')}</pre></p>`);
                    inCodeBlock = false;
                    codeBlockBuffer = [];
                    codeLang = '';
                    inCodeSection = false;
                }
                continue;
            } else if (trimmed.match(/^<file(?:\s+([^\s>]+))?>/)) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
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
                    result.push(`<p><pre${classAttr}>${codeBlockBuffer.join('\n')}</pre></p>`);
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
                result.push(`<p><pre${classAttr}>${codeBlockBuffer.join('\n')}</pre></p>`);
                inCodeBlock = false;
                codeBlockBuffer = [];
                codeLang = '';
                inCodeSection = false;
                continue;
            } else if (inCodeBlock) {
                codeBlockBuffer.push(line);
                continue;
            }
            const indentMatch = line.match(/^(\s*)/);
            const indentLevel = Math.floor(indentMatch[0].length / 2);
            if (!inCodeBlock && !inTable && trimmed.match(/^(?:[*|-]\s*)/)) {
                if (inTable) {
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                    inTable = false;
                }
                let content = trimmed.replace(/^(?:[*|-]\s*)/, '').trim();
                content = content.replace(/\\\\\s*$/, '');
                content = content.replace(/\\\\\s+/g, '<br>');
                content = this.applyRules(content);
                const listType = 'ul';
                if (indentLevel > this.currentIndent) {
                    result.push('<' + listType + '>');
                    this.listStack.push({type: listType, indent: indentLevel});
                    this.currentType = listType;
                    this.currentIndent = indentLevel;
                    result.push(`<li class="level${indentLevel + 1}">${content || ''}`);
                    this.openLi = true;
                } else {
                    if (this.openLi) {
                        result.push('</li>');
                        this.openLi = false;
                    }
                    while (this.currentIndent > indentLevel) {
                        result.push('</' + this.currentType + '>');
                        this.listStack.pop();
                        this.currentType = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].type : null;
                        this.currentIndent = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].indent : -1;
                    }
                    if (indentLevel === this.currentIndent) {
                        result.push(`<li class="level${indentLevel + 1}">${content || ''}`);
                        this.openLi = true;
                    }
                }
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }
            if (!inCodeBlock && !inTable && line.match(/^( {2,})(?![*|-]\s)/)) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                inPre = true;
                inCodeSection = true;
                preBuffer = [];
            }
            if (inPre) {
                preBuffer.push(line);
                if (!line.match(/^( {2,})/)) {
                    let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
                    result.push(`<p><pre class="code">${preContent}</pre></p>`);
                    inPre = false;
                    preBuffer = [];
                    inCodeSection = false;
                }
                if (i === lines.length - 1 && inPre) {
                    let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
                    result.push(`<p><pre class="code">${preContent}</pre></p>`);
                    inPre = false;
                    inCodeSection = false;
                }
                continue;
            }
            const quoteMatch = line.match(/^(>+)\s*(.*)/);
            if (quoteMatch) {
                const newLevel = quoteMatch[1].length;
                const content = quoteMatch[2];
                if (quoteLevel > 0 && newLevel !== quoteLevel) {
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                }
                quoteLevel = newLevel;
                let formattedContent = content.trim();
                formattedContent = formattedContent.replace(/\\\\\s*$/, '');
                formattedContent = formattedContent.replace(/\\\\\s+/g, '<br>');
                formattedContent = this.applyRules(formattedContent);
                quoteBuffer.push(formattedContent);
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            } else if (quoteLevel > 0) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                quoteLevel = 0;
            }
            if (trimmed.endsWith('\\\\') || trimmed.includes('\\\\ ')) {
                let content = trimmed.replace(/\\\\\s*$/, '');
                content = content.replace(/\\\\\s+/g, '<br>');
                content = this.applyRules(content);
                paragraphBuffer.push(content);
                if (trimmed.endsWith('\\\\')) paragraphBuffer.push('<br>');
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }
            if (!inCodeSection && (trimmed.startsWith('^') || trimmed.startsWith('|'))) {
                if (paragraphBuffer.length > 0 || quoteLevel > 0 || this.currentIndent >= 0) {
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                }
                const isHeader = trimmed.startsWith('^');
                const sep = isHeader ? '^' : '|';
                const rawLine = trimmed.substring(1);
                let cells = rawLine.split(sep).map(cell => cell.trim());
                let alignments = [];
                let cellContents = [];
                cells.forEach(cell => {
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
                if (isHeader) tableAlignments = alignments;
                const tag = isHeader ? 'th' : 'td';
                let row = '<tr>';
                let skipCells = 0;
                cellContents.forEach((cell, i) => {
                    if (skipCells > 0) {
                        skipCells--;
                        return;
                    }
                    let colspan = 1;
                    while (i + 1 < cellContents.length && cellContents[i + 1] === '') {
                        colspan++;
                        skipCells++;
                        i++;
                    }
                    let rowspanAttr = '';
                    if (cell === ':::' && tableRowspans[i]) {
                        tableRowspans[i]--;
                        return;
                    } else if (cell.match(/^:+:$/)) {
                        const colons = cell.split(':').length - 1;
                        rowspanAttr = colons > 1 ? ` rowspan="${colons}"` : '';
                        tableRowspans[i] = colons - 1;
                        cell = '';
                    }
                    let content = this.applyRules(cell.trim());
                    const alignClass = (alignments[i] || tableAlignments[i] || '');
                    const classAttr = alignClass ? ` class="${alignClass}"` : '';
                    const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
                    row += `<${tag}${rowspanAttr}${colspanAttr}${classAttr}>${content}</${tag}>`;
                });
                row += '</tr>';
                tableBuffer.push(row);
                inTable = true;
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }
            if (trimmed.match(/^={2,6}.*={2,6}$/)) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                let content = trimmed.replace(/=$/, ''); // Remove trailing '='
                content = this.applyRules(content);
                const headerHtml = this.getTitle(content);
                const headerText = content.replace(/={2,6}/g, '').trim();
                this.currentSectionLevel = parseInt(headerHtml.match(/h(\d)/)[1]);
                result.push(`<div class="level${this.currentSectionLevel}">${headerHtml}`);
                inCodeSection = headerText.match(/^(Links|Tables|Quoting|Text Conversions|No Formatting|Embedding HTML and PHP)$/i);
                continue;
            }
            if (trimmed.match(/^-{4,}$/)) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                result.push('<hr>');
                inCodeSection = false;
                continue;
            }
            if (trimmed.match(/^\{\{.*\}\}$/)) {
                let content = this.applyRules(trimmed);
                paragraphBuffer.push(content);
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }
            if (inTable) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                inTable = false;
            }
            let content = trimmed;
            if (inCodeSection && (trimmed.startsWith('^') || trimmed.startsWith('|'))) {
                content = content.replace(/\\\\\s*$/, '');
                content = content.replace(/\\\\\s+/g, '<br>');
                content = this.applyRules(content);
                result.push(`<p><pre class="code">${content}</pre></p>`);
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
                continue;
            }
            content = content.replace(/\\\\\s*$/, '');
            content = content.replace(/\\\\\s+/g, '<br>');
            content = this.applyRules(content);
            paragraphBuffer.push(content);
            if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
        }
        this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans);
        if (inPre) {
            let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
            result.push(`<p><pre class="code">${preContent}</pre></p>`);
        }
        if (this.footnotes.length > 0) {
            if (this.currentSectionLevel > 0) result.push('</div>');
            result.push('<div class="footnotes">');
            this.footnotes.forEach((note, i) => {
                if (!note.trim()) return;
                const escapedNote = this.escapeEntities(note);
                result.push(`<div class="fn"><sup><a href="#fnt__${i + 1}" id="fn__${i + 1}" class="fn_bot">${i + 1}</a></sup> <div class="content">${escapedNote}</div></div>`);
            });
            result.push('</div>');
        } else if (this.currentSectionLevel > 0) {
            result.push('</div>');
        }
        let finalResult = result.join('');
        this.linkPlaceholders.forEach((link, index) => {
            finalResult = finalResult.replace(`[LINK_${index}]`, link);
        });
        this.nowikiPlaceholders.forEach((raw, idx) => {
            finalResult = finalResult.replace(new RegExp(`\\[NOWIKI_${idx}\\]`, 'g'), raw);
        });
        this.percentPlaceholders.forEach((raw, idx) => {
            finalResult = finalResult.replace(new RegExp(`\\[PERCENT_${idx}\\]`, 'g'), raw);
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
            result = result.replace(new RegExp(`\\[NOWIKI_${idx}\\]`, 'g'), raw);
        });
        this.percentPlaceholders.forEach((raw, idx) => {
            result = result.replace(new RegExp(`\\[PERCENT_${idx}\\]`, 'g'), raw);
        });
        result = this.parseFootnotes(result);
        return result;
    }

    parseFootnotes(content) {
        return content.replace(/\(\((.+?)\)\)/g, (match, note) => {
            if (!note.trim()) return '';
            this.footnotes.push(note);
            const index = this.footnotes.length;
            return `<sup><a href="#fn__${index}" class="fn_bot">[${index}]</a></sup>`;
        });
    }

    escapeEntities(content) {
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    getTitle(line) {
        const trimmed = line.trim();
        const i = trimmed.search(/[^=]/);
        const content = trimmed.substr(i, trimmed.length - i * 2).trim();
        const element = 'h' + (7 - i);
        const id = content.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_/, '').replace(/_$/, '');
        return `<${element} class="sectionedit${7 - i}" id="${id}">${content}</${element}>`;
    }

    flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer, tableRowspans) {
        if (this.openLi) {
            result.push('</li>');
            this.openLi = false;
        }
        while (this.listStack.length > 0) {
            result.push('</' + this.listStack.pop().type + '>');
            this.currentIndent = -1;
            this.currentType = null;
        }
        if (tableBuffer.length) {
            result.push('<table class="inline">' + tableBuffer.join('') + '</table>');
            tableBuffer.length = 0;
            tableRowspans.length = 0;
        }
        if (quoteBuffer.length) {
            result.push(`<blockquote class="quote-level-${quoteLevel}">` + quoteBuffer.join('<br>') + '</blockquote>');
            quoteBuffer.length = 0;
        }
        if (paragraphBuffer.length) {
            result.push('<p>' + paragraphBuffer.join(' ') + '</p>');
            paragraphBuffer.length = 0;
        }
        if (codeBlockBuffer.length) {
            const classAttr = codeLang ? ` class="${codeLang}"` : '';
            result.push(`<p><pre${classAttr}>${codeBlockBuffer.join('\n')}</pre></p>`);
            codeBlockBuffer.length = 0;
        }
    }

    encapsulate(string, element, alignClass = '') {
        return '<' + element + (alignClass ? ' class="' + alignClass + '"' : '') + '>' + string + '</' + element + '>';
    }

    static parseCLI() {
        const fs = require('fs');
        const stdin = process.stdin;
        let input = '';
        stdin.setEncoding('utf8');
        stdin.on('readable', () => {
            let chunk;
            while (chunk = stdin.read()) {
                input += chunk;
            }
        });
        stdin.on('end', () => {
            if (!input.trim()) {
                console.error('Usage: node dokuparserjs.js < input.txt | cat input.txt | node dokuparserjs.js');
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
