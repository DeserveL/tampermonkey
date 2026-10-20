// ==UserScript==
// @name         选中价格快捷汇率转换
// @namespace    deservel.currency.converter
// @version      1.6.0
// @description  鼠标选中任意文字后松开显示小圆点，悬停尝试换算；同时支持 Alt+C、币种纠正、网站记忆与汇率缓存。
// @author       DeserveL
// @match        http://*/*
// @match        https://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.frankfurter.dev
// @connect      cdn.jsdelivr.net
// @connect      latest.currency-api.pages.dev
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        targetCurrency: 'CNY',
        hotkey: { alt: true, ctrl: false, shift: false, key: 'c' },
        popupDuration: 3000,
        rateCacheHours: 24,
        requestTimeout: 3500,
        defaultDollarCurrency: 'USD',
        defaultYenCurrency: 'JPY',
        maxSelectionLength: 100,
        hoverDotEnabled: true,
        hoverDotSize: 18,          // 小圆点直径（像素）
        hoverDotOffsetX: -30,     // 选区左侧偏移，减少与沉浸式翻译图标重合
        hoverDotOffsetY: 10,      // 选区底部偏移
    };

    const STORAGE_KEYS = {
        siteRules: 'currency_converter_site_rules_v1',
        rateCache: 'currency_converter_rate_cache_v1',
    };

    const COMMON_CURRENCIES = [
        'USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD', 'CAD', 'AUD', 'SGD', 'NZD',
        'KRW', 'INR', 'CHF', 'TWD', 'THB', 'MYR', 'PHP', 'VND', 'IDR', 'BRL', 'MXN'
    ];

    const CURRENCY_SYMBOLS = {
        CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$', CAD: 'C$',
        AUD: 'A$', SGD: 'S$', NZD: 'NZ$', KRW: '₩', INR: '₹', CHF: 'CHF', TWD: 'NT$',
        THB: '฿', MYR: 'RM', PHP: '₱', VND: '₫', IDR: 'Rp', BRL: 'R$', MXN: 'MX$'
    };

    const CURRENCY_NAMES = {
        USD: '美元', CNY: '人民币', EUR: '欧元', GBP: '英镑', JPY: '日元', HKD: '港币',
        CAD: '加元', AUD: '澳元', SGD: '新加坡元', NZD: '新西兰元', KRW: '韩元', INR: '印度卢比',
        CHF: '瑞士法郎', TWD: '新台币', THB: '泰铢', MYR: '马来西亚林吉特', PHP: '菲律宾比索',
        VND: '越南盾', IDR: '印尼盾', BRL: '巴西雷亚尔', MXN: '墨西哥比索'
    };

    const EXPLICIT_CURRENCY_PATTERNS = [
        ['USD', /\bUSD\b|US\s*\$/i],
        ['CAD', /\bCAD\b|CA\s*\$|(?:^|[^A-Z])C\s*\$/i],
        ['AUD', /\bAUD\b|AU\s*\$|(?:^|[^A-Z])A\s*\$/i],
        ['HKD', /\bHKD\b|HK\s*\$/i],
        ['SGD', /\bSGD\b|SG\s*\$|(?:^|[^A-Z])S\s*\$/i],
        ['NZD', /\bNZD\b|NZ\s*\$/i],
        ['BRL', /\bBRL\b|R\s*\$/i],
        ['MXN', /\bMXN\b|MX\s*\$/i],
        ['CNY', /\bCNY\b|\bRMB\b|CN\s*[¥￥]/i],
        ['JPY', /\bJPY\b|JP\s*[¥￥]/i],
        ['EUR', /\bEUR\b|€/i],
        ['GBP', /\bGBP\b|£/i],
        ['KRW', /\bKRW\b|₩/i],
        ['INR', /\bINR\b|₹/i],
        ['CHF', /\bCHF\b/i],
        ['TWD', /\bTWD\b|NT\s*\$/i],
        ['THB', /\bTHB\b|฿/i],
        ['MYR', /\bMYR\b|\bRM\s*\d/i],
        ['PHP', /\bPHP\b|₱/i],
        ['VND', /\bVND\b|₫/i],
        ['IDR', /\bIDR\b|\bRp\s*\d/i],
    ];

    const DOMAIN_CURRENCY_RULES = [
        [/\.com\.au$|\.au$/i, 'AUD'],
        [/\.ca$/i, 'CAD'],
        [/\.co\.uk$|\.uk$/i, 'GBP'],
        [/\.co\.jp$|\.jp$/i, 'JPY'],
        [/\.com\.cn$|\.cn$/i, 'CNY'],
        [/\.com\.hk$|\.hk$/i, 'HKD'],
        [/\.com\.sg$|\.sg$/i, 'SGD'],
        [/\.co\.nz$|\.nz$/i, 'NZD'],
        [/\.co\.kr$|\.kr$/i, 'KRW'],
        [/\.co\.in$|\.in$/i, 'INR'],
        [/\.ch$/i, 'CHF'],
        [/\.tw$/i, 'TWD'],
        [/\.th$/i, 'THB'],
        [/\.my$/i, 'MYR'],
        [/\.ph$/i, 'PHP'],
        [/\.vn$/i, 'VND'],
        [/\.id$/i, 'IDR'],
        [/\.br$/i, 'BRL'],
        [/\.mx$/i, 'MXN'],
        [/\.us$/i, 'USD'],
        [/\.(de|fr|it|es|nl|be|at|ie|pt|fi|gr|ee|lv|lt|sk|si|lu|cy|mt|hr)$/i, 'EUR'],
    ];

    let popupEl = null;
    let popupTimer = null;
    let conversionSequence = 0;
    let dotHost = null;
    let dotButton = null;
    let dotSelection = null;
    let dotReleaseTimer = null;
    let lastMouse = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };

    document.addEventListener('mousemove', (event) => {
        lastMouse = { x: event.clientX, y: event.clientY };
    }, { passive: true });

    injectStyles();

    // 只在释放鼠标后出现圆点；不通过金额、货币符号等条件预先过滤。
    // window 捕获阶段提高在 Discourse / 动态论坛上的事件兼容性。
    if (CONFIG.hoverDotEnabled) {
        window.addEventListener('pointerdown', dismissDot, true);
        window.addEventListener('mousedown', dismissDot, true);
        window.addEventListener('mouseup', onMouseRelease, true);
        // pointerup 作为兼容备用；mouseup 和 pointerup 共用一个短定时器避免重复创建。
        window.addEventListener('pointerup', onPointerRelease, true);
        window.addEventListener('scroll', dismissDot, true);
        window.addEventListener('resize', dismissDot, true);
    }

    document.addEventListener('keydown', (event) => {
        if (!matchesHotkey(event)) return;

        event.preventDefault();
        event.stopPropagation();
        dismissDot();
        void convertSelection(getSelectedContent());
    }, true);

    async function convertSelection(selected) {
        if (!selected.text) {
            showMessagePopup(selected.rect, '请先选中一个价格');
            return;
        }

        if (selected.text.length > CONFIG.maxSelectionLength) {
            showMessagePopup(selected.rect, '选中内容过长，请只选择价格');
            return;
        }

        const amount = parseAmount(selected.text);
        if (!Number.isFinite(amount)) {
            showMessagePopup(selected.rect, '未识别到有效金额');
            return;
        }

        const detected = detectCurrency(selected.text, selected.element);
        if (!detected || !detected.code) {
            showMessagePopup(selected.rect, '无法识别币种');
            return;
        }

        const state = {
            rect: selected.rect,
            sourceText: selected.text,
            selectedElement: selected.element,
            amount,
            sourceCurrency: detected.code,
            uncertain: detected.uncertain,
            detectionSource: detected.source,
            status: 'loading',
            rate: null,
            converted: null,
            stale: false,
            rateDate: null,
            provider: null,
            error: null,
        };

        await convertAndRender(state);
    }

    function onMouseRelease(event) {
        if (event.button !== 0 || isOurUI(event.target)) return;
        scheduleSelectionDot();
    }

    function onPointerRelease(event) {
        if (event.pointerType === 'mouse' || event.pointerType === 'touch' || event.pointerType === 'pen') {
            if (!isOurUI(event.target)) scheduleSelectionDot();
        }
    }

    function isOurUI(target) {
        return !!(target && (
            (popupEl && popupEl.contains(target)) ||
            (dotHost && dotHost.contains(target))
        ));
    }

    function dismissDot() {
        if (dotReleaseTimer !== null) {
            clearTimeout(dotReleaseTimer);
            dotReleaseTimer = null;
        }
        dotSelection = null;
        if (dotHost) {
            dotHost.remove();
            dotHost = null;
            dotButton = null;
        }
    }

    function scheduleSelectionDot() {
        if (dotReleaseTimer !== null) clearTimeout(dotReleaseTimer);
        // 先等待浏览器完成选区更新，避免拖选过程中的 selectionchange 误触发。
        dotReleaseTimer = window.setTimeout(() => {
            dotReleaseTimer = null;
            const selected = getSelectedContent();
            if (!selected.text) {
                dismissDot();
                return;
            }
            showSelectionDot(selected);
        }, 35);
    }

    function showSelectionDot(selected) {
        dismissDot();
        dotSelection = selected; // 快照：即使随后网页清掉高亮，也能正确换算
        const host = document.createElement('div');
        host.id = 'fxc-simple-hover-dot-host';
        // Shadow DOM 隔离论坛主题、插件或全局按钮样式。
        host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;width:18px!important;height:18px!important;display:block!important;overflow:visible!important;pointer-events:auto!important;';
        const shadow = host.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', '悬停换算选中文字');
        button.title = '悬停换算为人民币';
        button.textContent = '¥';
        button.style.cssText = [
            'all:initial!important',
            'display:flex!important',
            'align-items:center!important',
            'justify-content:center!important',
            'box-sizing:border-box!important',
            'width:100%!important',
            'height:100%!important',
            'border:1px solid #fff!important',
            'border-radius:50%!important',
            'background:#2868dc!important',
            'color:#fff!important',
            'font:bold 12px Arial,sans-serif!important',
            'line-height:1!important',
            'cursor:pointer!important',
            'box-shadow:0 2px 7px rgba(0,0,0,.30)!important',
        ].join(';');
        shadow.appendChild(button);
        document.documentElement.appendChild(host);
        dotHost = host;
        dotButton = button;

        const rect = selected.rect || fallbackRect();
        const size = CONFIG.hoverDotSize;
        host.style.setProperty('width', `${size}px`, 'important');
        host.style.setProperty('height', `${size}px`, 'important');
        const x = Math.max(6, Math.min(window.innerWidth - size - 6, rect.left + CONFIG.hoverDotOffsetX));
        const y = Math.max(6, Math.min(window.innerHeight - size - 6, rect.bottom + CONFIG.hoverDotOffsetY));
        host.style.setProperty('left', `${Math.round(x)}px`, 'important');
        host.style.setProperty('top', `${Math.round(y)}px`, 'important');

        button.addEventListener('mouseenter', () => {
            const snapshot = dotSelection;
            dismissDot();
            if (snapshot) void convertSelection(snapshot);
        }, { once: true });
    }

    function matchesHotkey(event) {
        return event.altKey === CONFIG.hotkey.alt &&
            event.ctrlKey === CONFIG.hotkey.ctrl &&
            event.shiftKey === CONFIG.hotkey.shift &&
            event.key.toLowerCase() === CONFIG.hotkey.key;
    }

    function getSelectedContent() {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            const start = active.selectionStart;
            const end = active.selectionEnd;
            if (typeof start === 'number' && typeof end === 'number' && end > start) {
                return {
                    text: normalizeSelectionText(active.value.slice(start, end)),
                    rect: active.getBoundingClientRect(),
                    element: active,
                };
            }
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return { text: '', rect: fallbackRect(), element: null };
        }

        const text = normalizeSelectionText(selection.toString());
        const range = selection.getRangeAt(0);
        let rect = range.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) rect = fallbackRect();

        const node = selection.anchorNode;
        const element = node
            ? (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
            : null;

        return { text, rect, element };
    }

    function normalizeSelectionText(text) {
        return String(text || '')
            .replace(/[\u00A0\u202F]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function fallbackRect() {
        return {
            left: lastMouse.x,
            right: lastMouse.x,
            top: lastMouse.y,
            bottom: lastMouse.y,
            width: 0,
            height: 0,
        };
    }

    function parseAmount(text) {
        const normalized = String(text)
            .replace(/[\u00A0\u202F]/g, ' ')
            .replace(/[−–—]/g, '-');

        const match = normalized.match(/[-+]?\s*\d[\d\s.,'’]*/);
        if (!match) return NaN;

        let token = match[0]
            .replace(/[\s'’]/g, '')
            .replace(/^[+]/, '');

        const negative = token.startsWith('-') || (/\(.*\d.*\)/.test(normalized));
        token = token.replace(/^-/, '');

        const dotCount = (token.match(/\./g) || []).length;
        const commaCount = (token.match(/,/g) || []).length;

        let numeric;

        if (dotCount > 0 && commaCount > 0) {
            const lastDot = token.lastIndexOf('.');
            const lastComma = token.lastIndexOf(',');
            const decimalSep = lastDot > lastComma ? '.' : ',';
            const groupingSep = decimalSep === '.' ? ',' : '.';
            numeric = token.split(groupingSep).join('');
            if (decimalSep === ',') numeric = numeric.replace(',', '.');
        } else if (dotCount > 0 || commaCount > 0) {
            const sep = dotCount > 0 ? '.' : ',';
            const parts = token.split(sep);

            if (parts.length > 2) {
                const allGrouping = parts.slice(1).every(part => part.length === 3);
                if (allGrouping) {
                    numeric = parts.join('');
                } else {
                    const decimalPart = parts.pop();
                    numeric = parts.join('') + '.' + decimalPart;
                }
            } else {
                const decimals = parts[1] ? parts[1].length : 0;
                if (decimals === 1 || decimals === 2) {
                    numeric = parts[0] + '.' + parts[1];
                } else if (decimals === 3) {
                    numeric = parts.join('');
                } else {
                    numeric = parts.join('');
                }
            }
        } else {
            numeric = token;
        }

        const value = Number(numeric);
        return Number.isFinite(value) ? (negative ? -value : value) : NaN;
    }

    function detectCurrency(text, selectedElement) {
        const explicit = extractExplicitCurrency(text);
        if (explicit) {
            return { code: explicit, uncertain: false, source: 'selection' };
        }

        const siteRule = getSavedSiteCurrency();
        if (siteRule) {
            return { code: siteRule, uncertain: false, source: 'saved-site-rule' };
        }

        const elementCurrency = detectCurrencyFromElementContext(selectedElement);
        if (elementCurrency) {
            return { code: elementCurrency, uncertain: false, source: 'element-context' };
        }

        const nearbyCurrency = detectCurrencyFromNearbyText(selectedElement, text);
        if (nearbyCurrency) {
            return { code: nearbyCurrency, uncertain: false, source: 'nearby-text' };
        }

        const metadataCurrency = detectCurrencyFromPageMetadata();
        if (metadataCurrency) {
            return { code: metadataCurrency, uncertain: false, source: 'page-metadata' };
        }

        const domainCurrency = detectCurrencyFromDomain();
        if (domainCurrency) {
            return { code: domainCurrency, uncertain: true, source: 'domain' };
        }

        if (/[¥￥]/.test(text)) {
            return { code: CONFIG.defaultYenCurrency, uncertain: true, source: 'default-yen' };
        }

        if (/\$/.test(text)) {
            return { code: CONFIG.defaultDollarCurrency, uncertain: true, source: 'default-dollar' };
        }

        return { code: CONFIG.defaultDollarCurrency, uncertain: true, source: 'default' };
    }

    function extractExplicitCurrency(text) {
        for (const [code, pattern] of EXPLICIT_CURRENCY_PATTERNS) {
            if (pattern.test(text)) return code;
        }
        return null;
    }

    function detectCurrencyFromElementContext(element) {
        let current = element;
        for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
            const attrs = [
                'data-currency', 'data-currency-code', 'data-price-currency',
                'data-pricecurrency', 'currency'
            ];

            for (const attr of attrs) {
                const value = current.getAttribute && current.getAttribute(attr);
                const code = normalizeCurrencyCode(value);
                if (code) return code;
            }

            if (current.matches && current.matches('[itemprop="priceCurrency"]')) {
                const code = normalizeCurrencyCode(current.getAttribute('content') || current.textContent);
                if (code) return code;
            }

            const scopedCurrency = current.querySelector && current.querySelector('[itemprop="priceCurrency"]');
            if (scopedCurrency) {
                const code = normalizeCurrencyCode(scopedCurrency.getAttribute('content') || scopedCurrency.textContent);
                if (code) return code;
            }
        }
        return null;
    }

    function detectCurrencyFromNearbyText(element, selectedText) {
        if (!element || !element.textContent) return null;
        let text = normalizeSelectionText(element.textContent);
        if (!text) return null;

        if (text.length > 500) {
            const index = text.indexOf(selectedText);
            if (index >= 0) {
                const start = Math.max(0, index - 180);
                const end = Math.min(text.length, index + selectedText.length + 180);
                text = text.slice(start, end);
            } else {
                text = text.slice(0, 360);
            }
        }

        return extractExplicitCurrency(text);
    }

    function detectCurrencyFromPageMetadata() {
        const selectors = [
            'meta[property="product:price:currency"]',
            'meta[property="og:price:currency"]',
            'meta[itemprop="priceCurrency"]',
            'meta[name="priceCurrency"]',
            'meta[name="currency"]',
            '[itemprop="priceCurrency"][content]'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;
            const code = normalizeCurrencyCode(el.getAttribute('content') || el.textContent);
            if (code) return code;
        }

        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (let i = 0; i < Math.min(scripts.length, 20); i++) {
            const raw = scripts[i].textContent;
            if (!raw || raw.length > 600000 || !raw.includes('priceCurrency')) continue;
            try {
                const data = JSON.parse(raw);
                const found = findPriceCurrencyDeep(data, 0);
                if (found) return found;
            } catch (_) {
                // 某些网站的 JSON-LD 并非严格 JSON，忽略即可。
            }
        }

        return null;
    }

    function findPriceCurrencyDeep(value, depth) {
        if (depth > 7 || value == null) return null;
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = findPriceCurrencyDeep(item, depth + 1);
                if (found) return found;
            }
            return null;
        }
        if (typeof value !== 'object') return null;

        if (Object.prototype.hasOwnProperty.call(value, 'priceCurrency')) {
            const code = normalizeCurrencyCode(value.priceCurrency);
            if (code) return code;
        }

        for (const key of Object.keys(value)) {
            const found = findPriceCurrencyDeep(value[key], depth + 1);
            if (found) return found;
        }
        return null;
    }

    function normalizeCurrencyCode(value) {
        if (typeof value !== 'string') return null;
        const text = value.trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(text)) return text;
        return extractExplicitCurrency(text);
    }

    function detectCurrencyFromDomain() {
        const host = normalizeHostname(location.hostname);
        for (const [pattern, code] of DOMAIN_CURRENCY_RULES) {
            if (pattern.test(host)) return code;
        }
        return null;
    }

    function normalizeHostname(hostname) {
        return String(hostname || '').toLowerCase().replace(/^www\./, '');
    }

    function getSavedSiteCurrency() {
        const rules = getStoredObject(STORAGE_KEYS.siteRules, {});
        return normalizeCurrencyCode(rules[normalizeHostname(location.hostname)] || '');
    }

    function saveSiteCurrency(code) {
        const normalized = normalizeCurrencyCode(code);
        if (!normalized) return;
        const rules = getStoredObject(STORAGE_KEYS.siteRules, {});
        rules[normalizeHostname(location.hostname)] = normalized;
        setStoredObject(STORAGE_KEYS.siteRules, rules);
    }

    function clearSavedSiteCurrency() {
        const rules = getStoredObject(STORAGE_KEYS.siteRules, {});
        delete rules[normalizeHostname(location.hostname)];
        setStoredObject(STORAGE_KEYS.siteRules, rules);
    }

    async function convertAndRender(state) {
        const seq = ++conversionSequence;
        clearPopupTimer();
        state.status = 'loading';
        state.error = null;
        renderPopup(state);

        try {
            const result = await getExchangeRate(state.sourceCurrency, CONFIG.targetCurrency);
            if (seq !== conversionSequence) return;

            state.status = 'success';
            state.rate = result.rate;
            state.converted = state.amount * result.rate;
            state.stale = result.stale;
            state.rateDate = result.date || null;
            state.provider = result.provider || null;
            renderPopup(state);
            armPopupTimer();
        } catch (error) {
            if (seq !== conversionSequence) return;
            state.status = 'error';
            state.error = error && error.message ? error.message : '汇率获取失败';
            renderPopup(state);
            armPopupTimer();
        }
    }

    async function getExchangeRate(from, to) {
        if (from === to) {
            return {
                rate: 1,
                date: new Date().toISOString().slice(0, 10),
                provider: '本地',
                stale: false,
            };
        }

        const cache = getStoredObject(STORAGE_KEYS.rateCache, {});
        const key = `${from}:${to}`;
        const cached = cache[key];
        const maxAge = CONFIG.rateCacheHours * 60 * 60 * 1000;

        if (cached && Number.isFinite(Number(cached.rate)) && Date.now() - Number(cached.fetchedAt || 0) <= maxAge) {
            return { ...cached, rate: Number(cached.rate), stale: false };
        }

        const providers = [
            () => fetchFrankfurterRate(from, to),
            () => fetchCurrencyApiJsDelivr(from, to),
            () => fetchCurrencyApiCloudflare(from, to),
        ];

        let lastError = null;
        for (const provider of providers) {
            try {
                const fresh = await provider();
                if (!fresh || !Number.isFinite(Number(fresh.rate)) || Number(fresh.rate) <= 0) {
                    throw new Error('接口返回了无效汇率');
                }

                const entry = {
                    rate: Number(fresh.rate),
                    date: fresh.date || new Date().toISOString().slice(0, 10),
                    provider: fresh.provider,
                    fetchedAt: Date.now(),
                };
                cache[key] = entry;
                setStoredObject(STORAGE_KEYS.rateCache, cache);
                return { ...entry, stale: false };
            } catch (error) {
                lastError = error;
            }
        }

        if (cached && Number.isFinite(Number(cached.rate))) {
            return { ...cached, rate: Number(cached.rate), stale: true };
        }

        throw lastError || new Error('所有汇率接口均不可用');
    }

    async function fetchFrankfurterRate(from, to) {
        const url = `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
        const data = await requestJson(url);
        if (!data || !Number.isFinite(Number(data.rate))) {
            throw new Error('Frankfurter 返回格式异常');
        }
        return {
            rate: Number(data.rate),
            date: data.date,
            provider: 'Frankfurter',
        };
    }

    async function fetchCurrencyApiJsDelivr(from, to) {
        const base = from.toLowerCase();
        const quote = to.toLowerCase();
        const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base}.min.json`;
        const data = await requestJson(url);
        const rate = data && data[base] && data[base][quote];
        if (!Number.isFinite(Number(rate))) {
            throw new Error('Currency API(jsDelivr) 返回格式异常');
        }
        return {
            rate: Number(rate),
            date: data.date,
            provider: 'Currency API · jsDelivr',
        };
    }

    async function fetchCurrencyApiCloudflare(from, to) {
        const base = from.toLowerCase();
        const quote = to.toLowerCase();
        const url = `https://latest.currency-api.pages.dev/v1/currencies/${base}.min.json`;
        const data = await requestJson(url);
        const rate = data && data[base] && data[base][quote];
        if (!Number.isFinite(Number(rate))) {
            throw new Error('Currency API(Cloudflare) 返回格式异常');
        }
        return {
            rate: Number(rate),
            date: data.date,
            provider: 'Currency API · Cloudflare',
        };
    }

    function requestJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: CONFIG.requestTimeout,
                headers: { Accept: 'application/json' },
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (_) {
                        reject(new Error('JSON 解析失败'));
                    }
                },
                onerror() {
                    reject(new Error('网络请求失败'));
                },
                ontimeout() {
                    reject(new Error('网络请求超时'));
                },
            });
        });
    }

    function renderPopup(state) {
        const root = ensurePopup();
        root.innerHTML = '';
        addCloseButton(root);

        const firstRow = document.createElement('div');
        firstRow.className = 'fxc-row fxc-source-row';

        const sourceText = document.createElement('span');
        sourceText.className = 'fxc-source-text';
        sourceText.textContent = state.sourceText;

        const currencyButton = document.createElement('button');
        currencyButton.type = 'button';
        currencyButton.className = 'fxc-currency-btn';
        currencyButton.textContent = `${state.sourceCurrency}${state.uncertain ? ' ?' : ''}`;
        currencyButton.title = '点击纠正币种，并记住当前网站';
        currencyButton.addEventListener('click', (event) => {
            event.stopPropagation();
            clearPopupTimer();
            toggleCurrencyMenu(state, currencyButton);
        });

        firstRow.appendChild(sourceText);
        firstRow.appendChild(currencyButton);
        root.appendChild(firstRow);

        const mainRow = document.createElement('div');
        mainRow.className = 'fxc-main-row';

        if (state.status === 'loading') {
            mainRow.innerHTML = '<span class="fxc-spinner"></span><span>正在获取汇率...</span>';
        } else if (state.status === 'success') {
            const symbol = CURRENCY_SYMBOLS[CONFIG.targetCurrency] || '';
            mainRow.textContent = `≈ ${symbol}${formatMoney(state.converted)} ${CONFIG.targetCurrency}`;
        } else {
            mainRow.classList.add('fxc-error');
            mainRow.textContent = state.error || '汇率获取失败';
        }
        root.appendChild(mainRow);

        if (state.status === 'success') {
            const rateRow = document.createElement('div');
            rateRow.className = 'fxc-rate-row';
            rateRow.textContent = `1 ${state.sourceCurrency} ≈ ${formatRate(state.rate)} ${CONFIG.targetCurrency}`;
            root.appendChild(rateRow);

            if (state.stale) {
                const staleRow = document.createElement('div');
                staleRow.className = 'fxc-stale-row';
                staleRow.textContent = `网络不可用，使用缓存汇率${state.rateDate ? ` · ${state.rateDate}` : ''}`;
                root.appendChild(staleRow);
            }
        }

        root.onmouseenter = clearPopupTimer;
        root.onmouseleave = () => {
            if (state.status !== 'loading' && !root.querySelector('.fxc-menu')) armPopupTimer();
        };

        positionPopup(root, state.rect);
    }

    function toggleCurrencyMenu(state, button) {
        const root = ensurePopup();
        const oldMenu = root.querySelector('.fxc-menu');
        if (oldMenu) {
            oldMenu.remove();
            armPopupTimer();
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'fxc-menu';

        const autoOption = document.createElement('button');
        autoOption.type = 'button';
        autoOption.className = 'fxc-menu-item fxc-auto-item';
        autoOption.textContent = '自动识别  ·  清除此站记忆';
        autoOption.addEventListener('click', async (event) => {
            event.stopPropagation();
            clearSavedSiteCurrency();
            const detected = detectCurrency(state.sourceText, state.selectedElement);
            state.sourceCurrency = detected.code;
            state.uncertain = detected.uncertain;
            state.detectionSource = detected.source;
            menu.remove();
            await convertAndRender(state);
        });
        menu.appendChild(autoOption);

        for (const code of COMMON_CURRENCIES) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = `fxc-menu-item${code === state.sourceCurrency ? ' active' : ''}`;
            option.textContent = `${code}  ${CURRENCY_NAMES[code] || ''}`;
            option.addEventListener('click', async (event) => {
                event.stopPropagation();
                saveSiteCurrency(code);
                state.sourceCurrency = code;
                state.uncertain = false;
                state.detectionSource = 'manual';
                menu.remove();
                await convertAndRender(state);
            });
            menu.appendChild(option);
        }

        root.appendChild(menu);
        positionPopup(root, state.rect);
        button.blur();
    }

    function ensurePopup() {
        if (popupEl && document.documentElement.contains(popupEl)) return popupEl;

        popupEl = document.createElement('div');
        popupEl.className = 'fxc-popup';
        popupEl.setAttribute('role', 'status');
        popupEl.addEventListener('click', event => event.stopPropagation());
        document.documentElement.appendChild(popupEl);
        return popupEl;
    }

    function addCloseButton(root) {
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'fxc-close-btn';
        closeButton.textContent = '×';
        closeButton.title = '关闭';
        closeButton.setAttribute('aria-label', '关闭');
        closeButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            removePopup();
        });
        root.appendChild(closeButton);
    }

    function showMessagePopup(rect, message) {
        conversionSequence++;
        clearPopupTimer();
        const root = ensurePopup();
        root.innerHTML = '';
        addCloseButton(root);
        const row = document.createElement('div');
        row.className = 'fxc-message';
        row.textContent = message;
        root.appendChild(row);
        positionPopup(root, rect || fallbackRect());
        armPopupTimer();
    }

    function positionPopup(root, rect) {
        requestAnimationFrame(() => {
            const margin = 8;
            const gap = 8;
            const box = root.getBoundingClientRect();
            let left = Math.max(margin, rect.left || lastMouse.x);
            let top = (rect.bottom || lastMouse.y) + gap;

            if (left + box.width > window.innerWidth - margin) {
                left = Math.max(margin, window.innerWidth - box.width - margin);
            }
            if (top + box.height > window.innerHeight - margin) {
                top = Math.max(margin, (rect.top || lastMouse.y) - box.height - gap);
            }

            root.style.left = `${Math.round(left)}px`;
            root.style.top = `${Math.round(top)}px`;
        });
    }

    function formatMoney(value) {
        return new Intl.NumberFormat('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    function formatRate(value) {
        if (!Number.isFinite(Number(value))) return '--';
        const number = Number(value);
        const digits = number !== 0 && Math.abs(number) < 0.0001 ? 8 : 4;
        return new Intl.NumberFormat('zh-CN', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        }).format(number);
    }

    function armPopupTimer() {
        clearPopupTimer();
        popupTimer = window.setTimeout(removePopup, CONFIG.popupDuration);
    }

    function clearPopupTimer() {
        if (popupTimer) {
            clearTimeout(popupTimer);
            popupTimer = null;
        }
    }

    function removePopup() {
        conversionSequence++; // 点击 × 后，不允许异步汇率请求把已关闭的弹窗重新打开
        clearPopupTimer();
        if (popupEl) {
            popupEl.remove();
            popupEl = null;
        }
    }

    function getStoredObject(key, fallback) {
        try {
            const value = GM_getValue(key, '');
            if (!value) return fallback;
            if (typeof value === 'object') return value;
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function setStoredObject(key, value) {
        GM_setValue(key, JSON.stringify(value));
    }

    function injectStyles() {
        if (document.getElementById('fxc-style')) return;
        const style = document.createElement('style');
        style.id = 'fxc-style';
        style.textContent = `
            .fxc-popup {
                position: fixed !important;
                z-index: 2147483647 !important;
                min-width: 230px !important;
                max-width: min(360px, calc(100vw - 16px)) !important;
                box-sizing: border-box !important;
                padding: 12px 14px !important;
                border: 1px solid rgba(0, 0, 0, .10) !important;
                border-radius: 10px !important;
                background: rgba(30, 30, 32, .97) !important;
                color: #fff !important;
                box-shadow: 0 10px 30px rgba(0, 0, 0, .28) !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
                font-size: 13px !important;
                line-height: 1.45 !important;
                text-align: left !important;
                user-select: none !important;
                backdrop-filter: blur(8px) !important;
            }
            .fxc-close-btn {
                position: absolute !important;
                top: 5px !important;
                right: 7px !important;
                width: 24px !important;
                height: 24px !important;
                padding: 0 !important;
                margin: 0 !important;
                border: 0 !important;
                border-radius: 6px !important;
                background: transparent !important;
                color: rgba(255,255,255,.65) !important;
                font-family: Arial, sans-serif !important;
                font-size: 20px !important;
                font-weight: 400 !important;
                line-height: 22px !important;
                text-align: center !important;
                cursor: pointer !important;
            }
            .fxc-close-btn:hover {
                background: rgba(255,255,255,.12) !important;
                color: #fff !important;
            }
            .fxc-row, .fxc-source-row {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                min-width: 0 !important;
            }
            .fxc-source-row {
                justify-content: space-between !important;
                margin-bottom: 7px !important;
                padding-right: 22px !important;
            }
            .fxc-source-text {
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
                font-weight: 600 !important;
                font-size: 14px !important;
            }
            .fxc-currency-btn {
                flex: 0 0 auto !important;
                padding: 2px 7px !important;
                margin: 0 !important;
                border: 1px solid rgba(255,255,255,.18) !important;
                border-radius: 6px !important;
                background: rgba(255,255,255,.08) !important;
                color: #fff !important;
                font: inherit !important;
                font-size: 12px !important;
                line-height: 20px !important;
                cursor: pointer !important;
            }
            .fxc-currency-btn:hover {
                background: rgba(255,255,255,.15) !important;
            }
            .fxc-main-row {
                display: flex !important;
                align-items: center !important;
                gap: 7px !important;
                font-size: 18px !important;
                font-weight: 700 !important;
                line-height: 1.45 !important;
                white-space: nowrap !important;
            }
            .fxc-rate-row {
                margin-top: 4px !important;
                color: rgba(255,255,255,.72) !important;
                font-size: 12px !important;
            }
            .fxc-stale-row {
                margin-top: 5px !important;
                color: #ffd27a !important;
                font-size: 11px !important;
            }
            .fxc-error, .fxc-message {
                color: #ffb4b4 !important;
                font-weight: 600 !important;
            }
            .fxc-message {
                padding-right: 18px !important;
                font-size: 13px !important;
            }
            .fxc-spinner {
                width: 13px !important;
                height: 13px !important;
                box-sizing: border-box !important;
                border: 2px solid rgba(255,255,255,.25) !important;
                border-top-color: #fff !important;
                border-radius: 50% !important;
                animation: fxc-spin .75s linear infinite !important;
            }
            @keyframes fxc-spin { to { transform: rotate(360deg); } }
            .fxc-menu {
                position: static !important;
                margin-top: 8px !important;
                max-height: 270px !important;
                overflow-y: auto !important;
                padding: 6px !important;
                border: 1px solid rgba(0,0,0,.12) !important;
                border-radius: 9px !important;
                background: #fff !important;
                box-shadow: 0 10px 30px rgba(0,0,0,.25) !important;
            }
            .fxc-menu-item {
                display: block !important;
                width: 100% !important;
                padding: 7px 9px !important;
                margin: 0 !important;
                border: 0 !important;
                border-radius: 6px !important;
                background: transparent !important;
                color: #222 !important;
                font: inherit !important;
                font-size: 12px !important;
                line-height: 1.35 !important;
                text-align: left !important;
                cursor: pointer !important;
            }
            .fxc-menu-item:hover, .fxc-menu-item.active {
                background: #f1f3f5 !important;
            }
            .fxc-auto-item {
                margin-bottom: 4px !important;
                border-bottom: 1px solid #eceff1 !important;
                border-radius: 0 !important;
                color: #555 !important;
            }
        `;
        document.documentElement.appendChild(style);
    }
})();
