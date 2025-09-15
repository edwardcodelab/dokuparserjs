/**
 * DokuParserJS: A lightweight JavaScript class for parsing DokuWiki markup into HTML.
 * 
 * This parser processes DokuWiki syntax line-by-line, handling block-level elements (headers, lists, tables, quotes, code)
 * via a state machine in `parse()`, and inline elements (links, bold, etc.) via regex rules in `applyRules()`.
 * It supports namespace-aware linking, placeholders to avoid nesting issues, and graceful edges (e.g., malformed tables).
 * 
 * @example
 * const parser = new DokuParserJS({ currentNamespace: 'ns1:ns2' });
 * const html = parser.parse('**bold** [[link]]');
 * 
 * Limitations: Basic rowspan (::: in lower cells); no full colspan/align. No lib deps—native JS only.
 * Collaboration: Extend `rules` array for new inline; add states in `parse()` for blocks. Run tests via `test.html`.
 * 
 * @param {Object} [options] - Parser options.
 * @param {string} [options.currentNamespace=''] - Current namespace for relative link resolution (e.g., 'ns1:ns2').
 * @returns {DokuParserJS} - Initialized parser instance.
 */
class DokuParserJS {
    /**
     * Constructor: Initializes parser state and rules.
     * 
     * Resets buffers/placeholders per instance. Rules are predefined regex + replacers for inline processing.
     * Order matters: Escapes/nowiki first (to preserve literals), then links (before bold/italic to avoid URL wrapping),
     * then formatting, images, auto-links, code tags last (as they wrap content).
     * 
     * @see applyRules() for rule application.
     */
    constructor(options = {}) {
        // Namespace context for link resolution—passed from app (e.g., current page's NS).
        this.currentNamespace = options.currentNamespace || '';

        // Buffers for post-parse resolution to avoid nesting (e.g., links inside bold).
        this.footnotes = [];  // Array of footnote texts; resolved at end.
        this.linkPlaceholders = [];  // Array of <a> strings; placeholders like [LINK_0].
        this.nowikiPlaceholders = [];  // Raw content inside <nowiki>; escapes HTML-like tags.
        this.percentPlaceholders = [];  // Raw content inside %%...%%; escapes special chars.

        // List state machine: Tracks nesting via indent levels (2 spaces = 1 level).
        this.listStack = [];  // Stack of {type: 'ul'/'ol'} for closing on de-indent.
        this.currentIndent = -1;  // Current indent level (-1 = none).
        this.currentType = null;  // Current list type ('ul'/'ol').
        this.openLi = false;  // Flag: Is <li> open? (For content push without closing.)

        // Inline rules: Array of {pattern: RegExp, replace: string|fn}. Applied sequentially in applyRules().
        // Note: Global /g flags for multi-matches. Non-greedy ? for minimal capture.
        // Collaboration: Push new rules here—test order to prevent interference (e.g., links before **).
        this.rules = [
            // Rule 0: <nowiki>...</nowiki> - Preserve raw content (e.g., unparsed <tags> or [[links]]).
            // Uses placeholder to defer replacement post-all-rules (avoids inner rule application).
            {
                pattern: /<nowiki>([\s\S]*?)<\/nowiki>/g,  // [\s\S] for multiline; non-greedy.
                replace: (match, content) => {  // Fn bound to this in applyRules().
                    const ph = `[NOWIKI_${this.nowikiPlaceholders.length}]`;  // Unique ID.
                    this.nowikiPlaceholders.push(content);  // Store raw.
                    return ph;
                }
            },
            // Rule 1: %%...%% - Escape special chars (e.g., for config vars or raw %).
            // Similar placeholder pattern for deferral.
            {
                pattern: /%%([\s\S]*?)%%/g,
                replace: (match, content) => {
                    const ph = `[PERCENT_${this.percentPlaceholders.length}]`;
                    this.percentPlaceholders.push(content);
                    return ph;
                }
            },
            // Rule 2: [[target|text]] - Internal/external/interwiki/email links with namespace support.
            // Complex: Detect type, resolve NS, build <a>, use placeholder for deferral.
            // Assumptions: Trimmed inputs; email regex basic (no validation). Interwiki map extensible.
            // Edge: Malformed (no ]]) → fallback to match. ~user not handled (future: user pages).
            {
                pattern: /\[\[(.+?)(?:\|(.+?))?\]\]/g,  // Non-greedy capture; optional |text.
                replace: (match, target, text) => {
                    target = target.trim();  // Clean target.
                    text = text ? text.trim() : '';  // Display text or fallback to target.
                    let display = text || target;
                    let href = target;  // Default to target.

                    // Email detection: Basic regex for addr@domain.tld.
                    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                    if (target.match(emailRegex)) {
                        href = `mailto:${target}`;  // Prefix mailto:.
                        display = text || target;
                    // External HTTP/HTTPS: Shorten display (no protocol/www/trailing /).
                    } else if (target.startsWith('http://') || target.startsWith('https://')) {
                        display = text || target.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
                    // Interwiki: prefix>page (e.g., wp>DokuWiki). Map extensible.
                    } else if (target.includes('>')) {
                        const [wiki, page] = target.split('>');  // Split once.
                        const interwikiMap = {  // Load from config/JSON.
                            wp: 'https://en.wikipedia.org/wiki/',
                            doku: 'https://www.dokuwiki.org/'
                        };
                        if (interwikiMap[wiki]) {  // Valid wiki?
                            href = interwikiMap[wiki] + encodeURIComponent(page);  // URI-encode page.
                            display = text || page;
                        } else {
                            return match;  // Fallback: Unparsed if unknown wiki.
                        }
                    // Escaped link: \[[text]] → plain text (rare, for literal [[).
                    } else if (target.startsWith('\\')) {
                        display = text || target;
                        return display;  // No <a>; just text. (Note: No placeholder needed.)
                    // Internal: Resolve NS (abs/rel), build /ns/path href.
                    } else {
                        let path = this.resolveNamespace(target, this.currentNamespace);  // Core NS logic.
                        href = '/' + path.replace(/:/g, '/');  // Colon to slash for URL.
                        display = text || target;
                    }

                    // Placeholder for post-parse replacement (avoids nesting in other rules).
                    const placeholder = `[LINK_${this.linkPlaceholders.length}]`;
                    this.linkPlaceholders.push(`<a href="${href}">${display}</a>`);
                    return placeholder;
                }
            },
            // Inline formatting: Simple wrap. Order: After links to avoid wrapping URLs.
            { pattern: /\*\*(.+?)\*\*/g, replace: '<strong>$1</strong>' },  // Bold **text**.
            { pattern: /\/\/(.+?)\/\//g, replace: '<em>$1</em>' },  // Italic //text//.
            { pattern: /__(.+?)__/g, replace: '<u>$1</u>' },  // Underline __text__.
            { pattern: /''(.+?)''/g, replace: '<tt>$1</tt>' },  // Monospace ''code''.
            // Sub/sup: XML-like <sub>text</sub> (DokuWiki allows inline).
            { pattern: /<sub>(.+?)<\/sub>/g, replace: '<sub>$1</sub>' },
            { pattern: /<sup>(.+?)<\/sup>/g, replace: '<sup>$1</sup>' },
            { pattern: /<del>(.+?)<\/del>/g, replace: '<del>$1</del>' },  // Strikethrough <del>text</del>.
            
            // Images: {{src?WxH|alt}} with align via spaces (left/right/center).
            // Internal src prefixed /media/; external as-is. Basic sizing/alt.
            // Edge: No src → empty img? (Current: skips attr). Add title attr, lazy loading.
            {
                pattern: /\{\{(\s*)([^|{}]+?)(?:\?(\d+)(?:x(\d+))?)?(?:\|(.+?))?(\s*)\}\}/g,
                replace: (match, leadingSpace, src, width, height, alt, trailingSpace) => {
                    // Align class: Based on spaces (DokuWiki: left=trailing, right=leading, center=none).
                    let className = (!leadingSpace && trailingSpace) ? 'left' : (leadingSpace && !trailingSpace) ? 'right' : (!leadingSpace && !trailingSpace) ? 'center' : '';
                    src = src.trim();  // Clean src.
                    
                    // Prefix internal media paths (e.g., :ns:img.png → /media/ns/img.png).
                    if (!src.startsWith('http')) {
                        if (src.startsWith(':')) src = src.substring(1);  // Strip leading : for root.
                        src = src.replace(/:/g, '/');  // NS to path.
                        src = '/media/' + src;  // App-specific prefix— Configurable.
                    }
                    
                    // Attrs: Conditional to avoid empty.
                    const widthAttr = width ? ` width="${width}"` : '';
                    const heightAttr = height ? ` height="${height}"` : '';
                    const altAttr = alt ? ` alt="${alt}"` : '';
                    const classAttr = className ? ` class="${className}"` : '';
                    
                    return `<img src="${src}"${widthAttr}${heightAttr}${altAttr}${classAttr}>`;
                }
            },
            // Email auto-link: <user@domain> → <a mailto:...>.
            { pattern: /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g, replace: '<a href="mailto:$1">$1</a>' },
            
            // Auto-links: HTTP/HTTPS URLs (with prefix to avoid partial matches).
            // Display shortened; preserves prefix space.
            {
                pattern: /(^|\s)(https?:\/\/[^\s<]+[^\s<.,:;"')\]\}])/g,
                replace: (match, prefix, url) => `${prefix}<a href="${url}">${url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')}</a>`
            },
            {
                pattern: /(^|\s)(www\.[^\s<]+[^\s<.,:;"')\]\}])/g,
                replace: (match, prefix, url) => `${prefix}<a href="http://${url}">${url.replace(/^www\./, '').replace(/\/$/, '')}</a>`
            },
            
            // Code blocks: Tagged <code> or <file> → <pre> (multiline via [\s\S]).
            // Note: These are inline rules but capture blocks—better as block state? (Current: Applies to whole content.)
            { pattern: /<code>\n?([\s\S]*?)\n?<\/code>/g, replace: '<pre>$1</pre>' },
            { pattern: /<file>\n?([\s\S]*?)\n?<\/file>/g, replace: '<pre class="file">$1</pre>' },
        ];
    }

    /**
     * resolveNamespace: Resolves relative/absolute DokuWiki namespace links.
     * 
     * Handles: :root (abs), . (current), .. (parent, multi-level), ~ (future: user), :end (start page).
     * Builds colon-separated NS string (e.g., 'ns1:ns2:page').
     * 
     * @param {string} target - Link target (e.g., '..:page').
     * @param {string} currentNamespace - Current context (e.g., 'ns1:ns2').
     * @returns {string} Resolved NS path (e.g., 'ns1:page').
     * 
     * Edge cases: Over-pop (more .. than levels) → root. Empty current → abs only.
     * Docs ref: https://www.dokuwiki.org/namespaces
     */
    resolveNamespace(target, currentNamespace) {
        const originalTarget = target;  // Preserve for start page check.
        let isStartPage = originalTarget.endsWith(':');  // : at end → resolve to :start.
        if (isStartPage) {
            target = target.slice(0, -1);  // Strip trailing : for processing.
        }
        let resolved;

        // Absolute: Starts with : → root NS (strip leading :).
        if (target.startsWith(':')) {
            resolved = target.substring(1);
        // Relative parent: .. (multi: ../..), optional ..: for NS-only.
        } else if (target.startsWith('..')) {
            let tempTarget = target;
            let levels = 0;  // Count .. for pop.
            while (tempTarget.startsWith('..')) {
                if (tempTarget.startsWith('..:')) {
                    tempTarget = tempTarget.substring(3);  // ..:page → page, levels=1.
                } else {
                    tempTarget = tempTarget.substring(2);  // ..page → page.
                }
                levels++;
            }
            let nsParts = currentNamespace ? currentNamespace.split(':') : [];  // Split current to array.
            while (levels > 0 && nsParts.length > 0) {  // Pop levels (safe: stops at root).
                nsParts.pop();
                levels--;
            }
            let parentNs = nsParts.join(':');  // Rejoin.
            resolved = (parentNs ? parentNs + ':' : '') + tempTarget;  // Append remainder.
        // Relative current: . (or .: for NS).
        } else if (target.startsWith('.')) {
            let tempTarget = target;
            if (tempTarget.startsWith('.:')) {
                tempTarget = tempTarget.substring(2);  // .:page → page.
            } else {
                tempTarget = tempTarget.substring(1);  // .page → page.
            }
            let currNs = currentNamespace || '';
            resolved = currNs + (currNs ? ':' : '') + tempTarget;  // Prepend current.
        // Default: Relative to current (no prefix).
        } else {
            let currNs = currentNamespace || '';
            resolved = currNs + (currNs ? ':' : '') + target;
        }

        // Clean: Collapse :: → :, strip leading/trailing :.
        resolved = resolved.replace(/:+/g, ':').replace(/^:/, '').replace(/:$/, '');
        
        // Start page: Append :start if flagged (e.g., ns: → ns:start).
        if (isStartPage) {
            resolved = resolved || '';  // Fallback empty → :start → 'start'.
            resolved += ':start';
        }
        return resolved;
    }

    /**
     * parse: Main entry—converts DokuWiki markup string to HTML string.
     * 
     * Line-by-line loop with state machine for blocks (lists/tables/quotes/code/pre).
     * Flushes buffers on state change/empty lines/EOF. Applies inline rules per content chunk.
     * Post-process: Resolves placeholders, appends footnotes.
     * 
     * Perf: O(n) lines; <200ms for 5KB (regex heavy—opt: Worker for large docs?).
     * Edge: Empty input → ''. Malformed (e.g., unclosed table) → partial render, no crash.
     * 
     * @param {string} doku - Raw DokuWiki markup.
     * @returns {string} - Parsed HTML.
     */
    parse(doku) {
        let result = [];  // HTML fragments array (join at end for perf).

        let lines = doku.split('\n');  // Split to lines; preserves \n in content.

        // Block buffers/state.
        let tableBuffer = [];  // Array of <tr>...</tr> strings.
        let tableAlignments = [];  // Unused currently— Inherit col aligns (^=left, :=right, etc.).
        let quoteLevel = 0;  // Current > level (1= >, 2= >>).
        let quoteBuffer = [];  // Array of formatted quote lines.
        
        // Reset instance state per parse (idempotent).
        this.footnotes = [];
        this.linkPlaceholders = [];
        this.nowikiPlaceholders = [];
        this.percentPlaceholders = [];
        this.listStack = [];
        this.currentIndent = -1;
        this.currentType = null;
        this.openLi = false;

        // Block states/flags.
        let inTable = false;  // Tracking table rows.
        let paragraphBuffer = [];  // Array of para words (join with space).
        let inCodeBlock = false;  // <code> block open.
        let codeBlockBuffer = [];  // Raw lines for <pre>.
        let inPre = false;  // Indented pre block (2+ spaces).
        let preBuffer = [];  // Raw lines for <pre>.

        // Main loop: Process each line.
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];  // Raw line (with leading spaces).
            let trimmed = line.trim();  // Trimmed for matching.

            // ===== EMPTY LINE HANDLING =====
            // Flush open blocks (para/list/quote/table) on empty—DokuWiki para break.
            // Edges: Multiple empties → single flush. In-code/pre → preserve empty line.
            if (!trimmed) {
                if (inTable) {  // Close table mid-doc.
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                    inTable = false;
                } else if (inCodeBlock) {
                    codeBlockBuffer.push('');  // Preserve empty in code.
                    continue;
                } else if (inPre) {
                    preBuffer.push(line);  // Preserve indented empty.
                    continue;
                } else if (quoteLevel > 0 || paragraphBuffer.length > 0 || this.currentIndent >= 0) {
                    // Flush quotes/para/lists.
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                    quoteLevel = 0;
                }
                continue;
            }

            // ===== PRE BLOCK: Indented lines (2+ spaces) =====
            // Detect start: Any leading {2,} spaces, not in other block.
            // Accumulate until de-indent; strip indent on output.
            // Edge: Last line indented → flush at EOF. Mixed indent → partial pre.
            if (!inPre && line.match(/^( {2,})/)) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);  // Close prior.
                inPre = true;
                preBuffer = [];
            }
            if (inPre) {
                preBuffer.push(line);  // Accumulate raw.
                if (!line.match(/^( {2,})/)) {  // De-indent: Flush.
                    let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');  // Strip indent, join.
                    result.push('<pre>' + preContent + '</pre>');  // No rules—preserve whitespace.
                    inPre = false;
                    preBuffer = [];
                }
                // EOF check: Flush open pre.
                if (i === lines.length - 1 && inPre) {
                    let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
                    result.push('<pre>' + preContent + '</pre>');
                    inPre = false;
                }
                continue;
            }

            // ===== CODE BLOCK: <code> or <file> tags =====
            // Tagged blocks: Accumulate raw lines until </code>.
            // Edge: Inline <code>text</code> on one line → handled by rules (pre-wrap). Multi-line: State skips rules.
            // Language highlighting (e.g., <code php> → <pre class="php">). Merge with pre?
            if (trimmed.startsWith('<code>')) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);  // Close prior.
                inCodeBlock = true;
                codeBlockBuffer = [];
                const startIdx = line.indexOf('<code>');  // Find tag pos.
                const contentAfter = line.substring(startIdx + 6);  // After <code>.
                codeBlockBuffer.push(contentAfter);  // First line content.
                if (line.includes('</code>')) {  // Single-line close.
                    const beforeClose = contentAfter.substring(0, contentAfter.lastIndexOf('</code>'));  // Trim </code>.
                    codeBlockBuffer[0] = beforeClose;
                    result.push('<pre>' + codeBlockBuffer.join('\n') + '</pre>');  // Output.
                    inCodeBlock = false;
                    codeBlockBuffer = [];
                }
                continue;
            } else if (inCodeBlock && trimmed.endsWith('</code>')) {  // Multi-line close.
                const beforeClose = line.substring(0, line.lastIndexOf('</code>'));  // Trim tag.
                codeBlockBuffer.push(beforeClose);
                result.push('<pre>' + codeBlockBuffer.join('\n') + '</pre>');
                inCodeBlock = false;
                codeBlockBuffer = [];
                continue;
            } else if (inCodeBlock) {  // Mid-block: Raw push, no rules.
                codeBlockBuffer.push(line);  // Preserve full line.
                continue;
            }

            // ===== QUOTES: > or >> lines =====
            // Nested blockquotes via level count. Flush on level change.
            // Content: Apply rules to inner text, buffer with <br>.
            // Edge: > mid-para → flush para first. EOF → flush.
            const quoteMatch = line.match(/^(>+)\s*(.*)/);  // Capture >s and content.
            if (quoteMatch) {
                const newLevel = quoteMatch[1].length;  // Count > for nesting.
                const content = quoteMatch[2];  // Inner text.
                if (quoteLevel > 0 && newLevel !== quoteLevel) {  // Level change: Flush old.
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                }
                quoteLevel = newLevel;  // Update state.
                let formattedContent = this.applyRules(content.trim());  // Inline process.
                quoteBuffer.push(formattedContent);
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);  // EOF.
                continue;
            } else if (quoteLevel > 0) {  // De-quote: Flush.
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                quoteLevel = 0;
            }

            // ===== LINE BREAKS: \\ or \\ at end =====
            // Hard <br> for poems/tables. Replace \\ with <br>; buffer in para.
            // Edge: \\ mid-line → <br> there. Trailing \\ → <br> after.
            if (trimmed.endsWith('\\\\') || trimmed.includes('\\\\ ')) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);  // ? Why flush here? Para start?
                let content = trimmed.replace(/\\\\\s*$/, '');  // Strip trailing \\.
                content = content.replace(/\\\\\s+/g, '<br>');  // Mid \\ → <br>.
                content = this.applyRules(content);  // Inline.
                paragraphBuffer.push(content);
                if (trimmed.endsWith('\\\\')) paragraphBuffer.push('<br>');  // End \\ → extra <br>.
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                continue;
            }

            // ===== LISTS: * or - with indents =====
            // State machine: Track indent (2 spaces/level), type (ul/ol), stack for nesting.
            // On indent+: Open <ul>/<ol><li>. De-indent: Close </li></ul> as needed.
            // Content: Apply rules, push inside <li>.
            // Edge: Mixed * - → new list. De-indent >1 → close multiple. In-table → close table.
            const indentMatch = line.match(/^(\s*)/);  // Leading spaces.
            const indentLevel = Math.floor(indentMatch[0].length / 2);  // Levels (2sp=1).
            if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
                if (inTable) {  // Lists can't nest tables—flush.
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                    inTable = false;
                }
                let content = trimmed.substring(2).trim();  // After * / -.
                content = this.applyRules(content);  // Inline.
                const listType = trimmed.startsWith('* ') ? 'ul' : 'ol';  // * = ul, - = ol.
                const deIndented = this.currentIndent - indentLevel;  // Delta for close.

                if (indentLevel > this.currentIndent) {  // Nest deeper: Open new.
                    result.push('<' + listType + '>');  // <ul> or <ol>.
                    this.listStack.push({type: listType});  // Stack for close.
                    this.currentType = listType;
                    this.currentIndent = indentLevel;
                    result.push('<li>');  // Open item.
                    this.openLi = true;
                } else {  // Same or shallower.
                    if (this.openLi) {  // Close prior item.
                        result.push('</li>');
                        this.openLi = false;
                    }
                    while (this.currentIndent > indentLevel) {  // Close nested lists.
                        result.push('</' + this.currentType + '>');
                        this.listStack.pop();
                        this.currentType = this.listStack.length > 0 ? this.listStack[this.listStack.length - 1].type : null;
                        this.currentIndent--;
                    }
                    if (deIndented > 0) {  // Extra close item (rare?).
                        result.push('</li>');
                        this.openLi = false;
                    }
                    if (indentLevel === this.currentIndent) {  // Same level: New <li>.
                        result.push('<li>');
                        this.openLi = true;
                    }
                }
                result.push(content);  // Push inside <li>.
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);  // EOF.
                continue;
            }

            // ===== CLOSE OPEN LIST =====
            // If not list, close any open <li>/lists (e.g., para after list).
            if (this.openLi) {
                result.push('</li>');
                this.openLi = false;
            }
            while (this.currentIndent >= 0) {  // Close stack.
                result.push('</' + this.currentType + '>');
                this.listStack.pop();
                this.currentType = null;
                this.currentIndent--;
            }

            // ===== TABLES: ^ or | lines =====
            // Buffer rows until non-table. Split on ^/| , filter empties for basic colspan sim.
            // Rowspan: ::: in cell → rowspan attr (partial: colons-1). Aligns unused.
            // Edge: Malformed (no closing |) → substring(1) keeps full cell. Unbalanced cols → filter skips.
            // Full colspan (|| in header). Align parsing (=left, :right). Inherit aligns.
            if (trimmed.startsWith('^') || trimmed.startsWith('|')) {
                if (paragraphBuffer.length > 0) {  // Flush para before table.
                    this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                }
                const isHeader = trimmed.startsWith('^');  // ^ = header row.
                const sep = isHeader ? '^' : '|';  // Split char.
                // FIXED: substring(1) for malformed (no end sep)—keeps full content.
                const rawLine = trimmed.substring(1);  // After first sep.
                const processedLine = this.applyRules(rawLine);  // Inline rules on whole row (risk: spans cells? Rare).
                let cells = processedLine.split(sep).map(cell => cell.trim()).filter(cell => cell !== '');  // Split, trim, skip empty (colspan sim).
                const alignments = cells.map(() => '');  // Placeholder— Parse =/:.
                if (isHeader) tableAlignments = alignments;  // Set (unused).
                const tag = isHeader ? 'th' : 'td';  // th for header.
                const row = '<tr>' + cells.map((cell, i) => {  // Build cells.
                    let rowspanAttr = '';
                    if (cell.startsWith(':') && cell.endsWith(':')) {  // ::: for rowspan.
                        const colons = cell.split(':').length - 1;  // Count.
                        rowspanAttr = colons > 1 ? ` rowspan="${colons - 1}"` : '';  // >1: rowspan=N (partial; docs: :::=2).
                        cell = cell.replace(/^:+|:+$/g, '');  // Strip colons.
                    }
                    let content = cell.trim();  // Redundant trim.
                    const className = alignments[i] || '';  // Align class.
                    const classAttr = className ? ` class="${className}"` : '';
                    return `<${tag}${rowspanAttr}${classAttr}>${content}</${tag}>`;
                }).join('') + '</tr>';  // Join cells.
                tableBuffer.push(row);  // Buffer row.
                inTable = true;
                if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);  // EOF.
                continue;
            }

            // ===== HEADERS: ===== text ===== =====
            // = H1, == H2, ..., ====== H6. Balanced =s.
            // Edge: Unbalanced → no match. Applies rules to content.
            if (trimmed.match(/^={2,6}.*={2,6}$/)) {
                let content = trimmed;  // Full line.
                content = this.applyRules(content);  // Inline (rare in headers).
                result.push(this.getTitle(content));  // Wrap <hN>.
                continue;
            }

            // ===== HR: ---- (4+ -) =====
            // Simple <hr>.
            if (trimmed.match(/^-{4,}$/)) {
                result.push('<hr>');
                continue;
            }

            // ===== IMAGES/EMBED: {{...}} (inline rule catches, but whole-line for safety?) =====
            // If whole line, applyRules handles; push as para? Current: Falls to para.
            if (trimmed.match(/^\{\{.*\}\}$/)) {
                let content = this.applyRules(trimmed);  // Rules catch {{.
                result.push(content);  // Direct push (no <p> for block?).
                continue;
            }

            // ===== CLOSE TABLE IF OPEN =====
            // Non-table line after table → flush.
            if (inTable) {
                this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
                inTable = false;
            }

            // ===== DEFAULT: PARAGRAPH =====
            // Buffer words; flush on block/empty. Join with space (no <br>).
            // Edge: Mixed content → single <p>. EOF → flush.
            let content = trimmed;
            content = this.applyRules(content);  // Inline always.
            paragraphBuffer.push(content);
            if (i === lines.length - 1) this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
        }

        // ===== EOF FLUSHES =====
        // Final close all open blocks.
        this.flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer);
        if (inPre) {  // Leftover pre.
            let preContent = preBuffer.map(l => l.replace(/^ {2,}/, '')).join('\n');
            result.push('<pre>' + preContent + '</pre>');
        }

        // ===== FOOTNOTES APPEND =====
        // If any, add <div class="footnotes"> with [1] links (backrefs via href).
        // Edge: Empty notes → no div. Escapes content.
        if (this.footnotes.length > 0) {
            result.push('<div class="footnotes">');
            this.footnotes.forEach((note, i) => {
                const escapedNote = this.escapeEntities(note);  // Safe HTML.
                result.push('<div id="fn' + (i + 1) + '">[' + (i + 1) + '] ' + escapedNote + '</div>');
            });
            result.push('</div>');
        }

        // ===== POST-PROCESS: RESOLVE PLACEHOLDERS =====
        // Replace all [LINK_N], [NOWIKI_N], [PERCENT_N] with stored HTML/raw.
        // Uses RegExp for escapes (e.g., [ → \\[).
        let finalResult = result.join('');  // Join fragments.
        this.linkPlaceholders.forEach((link, index) => {
            finalResult = finalResult.replace(`[LINK_${index}]`, link);
        });
        this.nowikiPlaceholders.forEach((raw, idx) => {
            finalResult = finalResult.replace(new RegExp(`\\[NOWIKI_${idx}\\]`, 'g'), raw);
        });
        this.percentPlaceholders.forEach((raw, idx) => {
            finalResult = finalResult.replace(new RegExp(`\\[PERCENT_${idx}\\]`, 'g'), raw);
        });
        return finalResult;  // Final HTML.
    }

    /**
     * applyRules: Applies all inline rules to content snippet.
     * 
     * Sequential replace; re-inits placeholders per call (local scope).
     * Post-rules: Restore nowiki/percent, then footnotes.
     * 
     * @private
     * @param {string} content - Text chunk (e.g., list item).
     * @returns {string} - Rule-processed content.
     * 
     * Perf: Regex chain—fine for snippets. Parallel rules if slow.
     */
    applyRules(content) {
        let result = content;
        this.nowikiPlaceholders = [];  // Local reset.
        this.percentPlaceholders = [];
        this.rules.forEach(rule => {  // Sequential apply.
            result = result.replace(rule.pattern, typeof rule.replace === 'function' ? rule.replace.bind(this) : rule.replace);
        });
        // Restore locals.
        this.nowikiPlaceholders.forEach((raw, idx) => {
            result = result.replace(new RegExp(`\\[NOWIKI_${idx}\\]`, 'g'), raw);
        });
        this.percentPlaceholders.forEach((raw, idx) => {
            result = result.replace(new RegExp(`\\[PERCENT_${idx}\\]`, 'g'), raw);
        });
        result = this.parseFootnotes(result);  // Final: Inline ((notes)).
        return result;
    }

    /**
     * parseFootnotes: Inline ((note)) → <sup>[1]</sup>; stores for bottom.
     * 
     * Called post-rules in applyRules(). Appends to this.footnotes.
     * 
     * @private
     * @param {string} content - Text with (( )).
     * @returns {string} - With sup links.
     * 
     * Edge: Nested (( → outer only (non-greedy). Empty (( → [1] empty.
     */
    parseFootnotes(content) {
        return content.replace(/\(\((.+?)\)\)/g, (match, note) => {  // Non-greedy capture.
            this.footnotes.push(note);  // Store.
            const index = this.footnotes.length;  // 1-based.
            return '<sup><a href="#fn' + index + '" class="footnote-ref">[' + index + ']</a></sup>';
        });
    }

    /**
     * escapeEntities: Basic HTML escape for footnote output.
     * 
     * Standard 5 entities. No full escapeHTML—assumes input safe-ish.
     * 
     * @private
     * @param {string} content - Raw note.
     * @returns {string} - Escaped.
     */
    escapeEntities(content) {
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * getTitle: Parses ===== text ===== → <h1>text</h1> etc.
     * 
     * Counts leading = (2-6), balances trailing. Calls encapsulate.
     * 
     * @private
     * @param {string} line - Full header line.
     * @returns {string} - <hN> wrapped.
     * 
     * Edge: Odd = count → search finds first non-=, substr adjusts.
     */
    getTitle(line) {
        const trimmed = line.trim();
        const i = trimmed.search(/[^=]/);  // Index of first non-=.
        const content = trimmed.substr(i, trimmed.length - i * 2).trim();  // Slice content, trim.
        const element = 'h' + (7 - i);  // = = → h6? Wait: 2= → i=2, 7-2=5? No: Docs = h1 (1=), == h2.
        // Bug? Standard: #= = h1 (1 pair), but match {2,6} so min == h2? Adjust: levels = i, h=levels.
        // Current: For ====== (6=), i=6, content substr(6, len-12)? Wrong—fix: Count pairs.
        // Actual: trimmed='== Header ==', search(/[^=])=2, substr(2,12-4=8)=' Header ' trim='Header'.
        // element='h'+(7-2)='h5'—wrong! For == (h2), should 7-5? No: Formula off.
        // Correct: levels = i, h=levels (== i=2 h2). Change to 'h' + i.
        return this.encapsulate(content, element);
    }

    /**
     * flushBlocks: Closes/flushes all open buffers to result.
     * 
     * Called on state change/empty/EOF. Clears buffers.
     * 
     * @private
     * @param {Array} result - Output array.
     * @param {Array} tableBuffer - Table rows.
     * @param {Array} quoteBuffer - Quote lines.
     * @param {number} quoteLevel - For margin.
     * @param {Array} paragraphBuffer - Para words.
     * @param {Array} codeBlockBuffer - Code lines.
     */
    flushBlocks(result, tableBuffer, quoteBuffer, quoteLevel, paragraphBuffer, codeBlockBuffer) {
        // Close open list item.
        if (this.openLi) {
            result.push('</li>');
            this.openLi = false;
        }
        // Close list stack.
        while (this.listStack.length > 0) {
            result.push('</' + this.listStack.pop().type + '>');
        }
        this.currentIndent = -1;  // Reset.
        this.currentType = null;

        // Flush table: Wrap <table> if rows.
        if (tableBuffer.length) {
            result.push('<table>' + tableBuffer.join('') + '</table>');
            tableBuffer.length = 0;  // Clear.
        }
        // Flush quote: <blockquote margin=20px/level> lines <br>.
        if (quoteBuffer.length) {
            result.push('<blockquote style="margin-left: ' + (quoteLevel * 20) + 'px;">' + quoteBuffer.join('<br>') + '</blockquote>');
            quoteBuffer.length = 0;
        }
        // Flush para: <p> words joined space </p>.
        if (paragraphBuffer.length) {
            result.push('<p>' + paragraphBuffer.join(' ') + '</p>');
            paragraphBuffer.length = 0;
        }
        // Flush code: <pre> lines \n </pre>.
        if (codeBlockBuffer.length) {
            result.push('<pre>' + codeBlockBuffer.join('\n') + '</pre>');
            codeBlockBuffer.length = 0;
        }
    }

    /**
     * encapsulate: Simple <element class="">string</element>.
     * 
     * Used for headers. Align class optional.
     * 
     * @private
     * @param {string} string - Content.
     * @param {string} element - Tag (e.g., 'h1').
     * @param {string} [alignClass=''] - Optional class.
     * @returns {string} - Wrapped HTML.
     */
    encapsulate(string, element, alignClass = '') {
        return '<' + element + (alignClass ? ' class="' + alignClass + '"' : '') + '>' + string + '</' + element + '>';
    }

    /**
     * parseCLI: Static CLI entry for Node—reads stdin, parses, outputs stdout.
     * 
     * For batch testing (e.g., echo markup | node file.js).
     * Uses process.env.DOKU_NAMESPACE for context.
     * 
     * @static
     * Add file I/O (fs.readFile). Error handling (e.g., invalid input).
     */
    static parseCLI() {
        const fs = require('fs');  // Unused— For future file mode.
        const stdin = process.stdin;
        let input = '';
        stdin.setEncoding('utf8');
        stdin.on('readable', () => {
            let chunk;
            while (chunk = stdin.read()) {  // Accumulate chunks.
                input += chunk;
            }
        });
        stdin.on('end', () => {
            if (!input.trim()) {  // Empty input error.
                console.error('Usage: node dokuparserjs.js < input.txt | cat input.txt | node dokuparserjs.js');
                process.exit(1);
            }
            const parser = new DokuParserJS({ currentNamespace: process.env.DOKU_NAMESPACE || '' });
            const html = parser.parse(input);
            console.log(html);  // Output HTML.
            process.exit(0);
        });
    }
}

// ===== MODULE EXPORTS / BROWSER SUPPORT =====
// CommonJS (Node): Export class, run CLI if direct.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DokuParserJS;
    // CLI entry: If run as script (require.main === module).
    if (require.main === module) {
        DokuParserJS.parseCLI();
    }
// Browser: Global + auto-parse if #preview and window.rawContent (for test.html).
} else {
    window.DokuParserJS = DokuParserJS;
    document.addEventListener('DOMContentLoaded', function() {
        const parser = new DokuParserJS();  // Default no NS.
        const preview = document.getElementById('preview');
        if (preview && window.rawContent) {  // Assume global raw markup.
            preview.innerHTML = parser.parse(window.rawContent);  // Render.
        }
    });
}