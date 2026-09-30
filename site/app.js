/**
 * URDiary showcase — page behaviour.
 *
 * The mascot is the app's own code: vendor/mascot.js, vendor/mascot_motion.js and
 * vendor/mascot.css are byte-for-byte copies of desktop/ (site/tools/sync-mascot.sh), so every
 * pose, blink, hop and celebration here is exactly what the app does. This file only mounts
 * the SVG that MascotModule returns and calls MascotMotion — it never draws or animates the
 * mascot itself. If vendor/ is missing, the page still renders (just without mascots).
 *
 * Contract §4 still holds on this page: celebrations only follow an explicit action (the two
 * "save an entry" buttons), the chat-area mascots (thinking bubble, tea) stay quiet, and
 * prefers-reduced-motion turns everything static — including this page's own reveals.
 */
(function () {
    'use strict';

    var DICT = window.SITE_I18N || {};
    var CFG = window.URDIARY_SITE || {};
    var Mascot = window.MascotModule;
    var Motion = window.MascotMotion;
    var root = document.documentElement;
    var LANG_KEY = 'urdiary-site-lang';
    var LANGS = ['zh-TW', 'en'];
    var PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    // The app's 24 diary stamps (desktop/js/mascot.js STAMP_ICONS) and the quiet set that
    // backend/app/services/day_stamp.py enforces on heavy days.
    var STAMPS = ['cake', 'gift', 'heart', 'cheers', 'trophy', 'flag', 'book', 'star', 'plane',
        'camera', 'ball', 'movie', 'music', 'food', 'coffee', 'flower', 'sun', 'umbrella', 'moon',
        'rainbow', 'sprout', 'heal', 'paw', 'gradcap'];
    var QUIET_STAMPS = ['umbrella', 'moon', 'rainbow', 'sprout', 'heal'];

    var reduceMql = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var lang = LANGS.indexOf(root.getAttribute('lang')) >= 0 ? root.getAttribute('lang') : 'en';
    var mediaFiles = null;          // names listed in media/manifest.json (null until loaded)
    var heroVideoPaused = false;
    var eggOnStage = typeof WeakMap === 'function' ? new WeakMap() : null;

    // ------------------------------------------------------------------ helpers
    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
    function has(obj, key) { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); }
    function t(key) {
        if (has(DICT[lang], key)) return DICT[lang][key];
        if (has(DICT.en, key)) return DICT.en[key];
        return key;
    }
    function isReduced() { return !!(reduceMql && reduceMql.matches); }
    function onReduceChange(fn) {
        if (!reduceMql) return;
        if (typeof reduceMql.addEventListener === 'function') reduceMql.addEventListener('change', fn);
        else if (typeof reduceMql.addListener === 'function') reduceMql.addListener(fn);
    }
    function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
    function svgFrom(html) {
        var tpl = document.createElement('template');
        tpl.innerHTML = html || '';
        return tpl.content.querySelector('svg');
    }
    function safe(label, fn) {
        try { fn(); } catch (e) { console.error('[urdiary-site] ' + label + ' failed:', e); }
    }
    function announce(text) {
        var live = $('#live');
        if (!live) return;
        live.textContent = '';
        setTimeout(function () { live.textContent = text; }, 30);
    }

    // ------------------------------------------------------------------ i18n
    function applyI18n() {
        root.setAttribute('lang', lang);
        document.title = t('meta.title');
        var desc = $('meta[name="description"]');
        if (desc) desc.setAttribute('content', t('meta.description'));

        $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
        $$('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
        $$('[data-i18n-attr]').forEach(function (el) {
            el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
                var i = pair.indexOf(':');
                if (i > 0) el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
            });
        });

        // Screenshots exist per language (site/assets/screens/{zh,en}); same pixel size, so no shift.
        var dir = lang === 'zh-TW' ? 'zh' : 'en';
        $$('img[data-shot]').forEach(function (img) {
            var src = 'assets/screens/' + dir + '/' + img.getAttribute('data-shot') + '.webp';
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        });
        $$('.zoom').forEach(function (btn) {
            var img = $('img', btn);
            if (img) btn.setAttribute('aria-label', t('zoom.open').replace('{alt}', img.getAttribute('alt') || ''));
        });

        var toggle = $('#lang-toggle');
        if (toggle) toggle.setAttribute('lang', lang === 'zh-TW' ? 'en' : 'zh-TW');   // its label is in the other language

        updateMotionNote();
        updateVideoToggle();
    }

    function setLang(next) {
        if (next === lang || LANGS.indexOf(next) < 0) return;
        lang = next;
        store(LANG_KEY, lang);
        applyI18n();
        updateIntroVideo();
    }

    // ------------------------------------------------------------------ mascots
    var POSES = {
        welcome: function () { return Mascot.welcomeHtml(); },
        diary: function () { return Mascot.emptyHtml('diary', ''); },
        calendar: function () { return Mascot.emptyHtml('calendar', ''); },
        question: function () { return Mascot.emptyHtml('generic', ''); },
        tea: function () { return Mascot.checkinHtml(); }
    };

    function lastEgg() {
        var eggs = document.querySelectorAll('body > .mascot-egg');
        return eggs.length ? eggs[eggs.length - 1] : null;
    }

    // A still of the app's save-diary celebration. MascotModule only offers it as the live
    // overlay, so build one and keep its SVG; created and removed in the same task, it is
    // never styled or painted, so no animation starts.
    function eggStill(kind) {
        if (typeof Mascot.showSaveEgg !== 'function') return null;
        Mascot.showSaveEgg(kind);
        var egg = lastEgg();
        if (!egg) return null;
        var svg = $('svg', egg);
        egg.parentNode.removeChild(egg);
        return svg;
    }

    function mountMascots() {
        if (!Mascot) return;
        $$('.mascot-btn[data-pose]').forEach(function (btn) {
            var make = POSES[btn.getAttribute('data-pose')];
            var svg = make ? svgFrom(make()) : null;
            if (svg) btn.appendChild(svg);
            btn.addEventListener('click', function () { tapMascot(btn); });
        });
        $$('.pg-static[data-pose]').forEach(function (el) {
            var svg = svgFrom(POSES[el.getAttribute('data-pose')]());
            if (svg) el.appendChild(svg);
        });
        $$('.pg-static[data-egg]').forEach(function (el) {
            var svg = eggStill(el.getAttribute('data-egg'));
            if (svg) el.appendChild(svg);
        });
        $$('[data-stamp]').forEach(function (el) {
            el.innerHTML = Mascot.stampIcon(el.getAttribute('data-stamp'), 48);
        });
        var thinking = $('#illus-thinking');
        if (thinking) thinking.innerHTML = Mascot.thinkingBubbleHtml();   // the app's quiet sway + dots
        var soon = $('#soon-mascot');
        var tea = svgFrom(Mascot.checkinHtml());
        if (soon && tea) soon.appendChild(tea);

        var sheet = $('#stamp-sheet');
        if (sheet) {
            STAMPS.forEach(function (id) {
                var li = document.createElement('li');
                li.innerHTML = Mascot.stampIcon(id, 32);
                li.setAttribute('data-i18n-attr', 'title:stamp.' + id);
                var name = document.createElement('span');
                name.className = 'visually-hidden';
                name.setAttribute('data-i18n', 'stamp.' + id);
                li.appendChild(name);
                if (QUIET_STAMPS.indexOf(id) >= 0) {
                    li.className = 'is-quiet';
                    var quiet = document.createElement('span');
                    quiet.className = 'visually-hidden';
                    quiet.setAttribute('data-i18n', 'pg.stamps.quiet');
                    li.appendChild(quiet);
                }
                sheet.appendChild(li);
            });
        }
    }

    // Tap = the app's reaction (MascotMotion.react: hop + happy face + little heart, rate-limited,
    // nothing under reduced motion). The button makes it reachable by keyboard too; a pointer
    // click on the SVG also reaches MascotMotion's own document listener, whose rate limiter
    // turns that second call into a no-op.
    function tapMascot(btn) {
        if (!Motion || typeof Motion.react !== 'function') return;
        var svg = $('svg[data-mm-tap]', btn);
        if (svg && Motion.react(svg) && btn.id === 'hero-mascot') {
            var hint = $('#tap-hint');
            if (hint) hint.classList.add('is-done');
        }
    }

    // The two celebrations play inside their card: the app's own overlay (showSaveEgg), moved
    // into the stage right after it is created — same timing, same fade, one at a time.
    function playEgg(kind, stage) {
        if (!Mascot || typeof Mascot.showSaveEgg !== 'function' || !stage) return;
        Mascot.showSaveEgg(kind);
        var egg = lastEgg();
        if (!egg) return;
        stage.appendChild(egg);
        stage.classList.add('is-playing');
        if (eggOnStage) eggOnStage.set(stage, egg);
        if (typeof MutationObserver !== 'function') return;
        var watch = new MutationObserver(function () {
            if (egg.isConnected && !egg.classList.contains('fade')) return;
            watch.disconnect();
            if (!eggOnStage || eggOnStage.get(stage) === egg) stage.classList.remove('is-playing');
        });
        watch.observe(egg, { attributes: true, attributeFilter: ['class'] });
        watch.observe(stage, { childList: true });
    }

    function setupEggs() {
        $$('.btn-egg[data-egg]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                playEgg(btn.getAttribute('data-egg'), document.getElementById(btn.getAttribute('aria-controls')));
            });
        });
    }

    function updateMotionNote() {
        var reduced = isReduced();
        var note = $('#motion-note');
        var text = $('#motion-note-text');
        if (note) note.classList.toggle('is-reduced', reduced);
        if (text) text.textContent = t(reduced ? 'motion.off' : 'motion.on');
        var hint = $('#tap-hint');
        if (hint) hint.hidden = reduced;          // under reduced motion a tap does nothing, so don't invite one
    }

    // ------------------------------------------------------------------ page chrome
    function setupLangToggle() {
        var btn = $('#lang-toggle');
        if (btn) btn.addEventListener('click', function () { setLang(lang === 'zh-TW' ? 'en' : 'zh-TW'); });
    }

    function setupHeader() {
        var header = $('#site-header');
        if (!header) return;
        var queued = false;
        function update() {
            queued = false;
            header.classList.toggle('is-scrolled', (window.scrollY || window.pageYOffset) > 8);
        }
        window.addEventListener('scroll', function () {
            if (!queued) { queued = true; requestAnimationFrame(update); }
        }, { passive: true });
        update();
    }

    function setupReveal() {
        if (isReduced() || typeof window.IntersectionObserver !== 'function') return;   // content is simply there
        root.classList.add('motion-ok');
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
        $$('.reveal').forEach(function (el) { io.observe(el); });
        onReduceChange(function () {
            if (!isReduced()) return;
            io.disconnect();
            root.classList.remove('motion-ok');
        });
    }

    function setupCopy() {
        var canCopy = !!(navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext);
        $$('.copy-btn').forEach(function (btn) {
            if (!canCopy) { btn.hidden = true; return; }
            var timer = null;
            btn.addEventListener('click', function () {
                var code = document.getElementById(btn.getAttribute('data-copy'));
                if (!code) return;
                navigator.clipboard.writeText(code.textContent).then(function () {
                    btn.textContent = t('start.copied');
                    btn.classList.add('is-copied');
                    announce(t('start.copied'));
                    clearTimeout(timer);
                    timer = setTimeout(function () {
                        btn.textContent = t('start.copy');
                        btn.classList.remove('is-copied');
                    }, 1800);
                }, function () { /* clipboard refused: leave the text selectable */ });
            });
        });
    }

    function setupZoom() {
        var dialog = $('#lightbox');
        var big = $('#lightbox-img');
        var supported = !!(dialog && big && typeof dialog.showModal === 'function');
        $$('.zoom').forEach(function (btn) {
            if (!supported) { btn.disabled = true; btn.style.cursor = 'default'; return; }
            btn.addEventListener('click', function () {
                var img = $('img', btn);
                if (!img) return;
                big.src = img.currentSrc || img.src;
                big.alt = img.alt;
                dialog.showModal();
            });
        });
        if (!supported) return;
        dialog.addEventListener('click', function (event) {
            if (event.target === dialog || event.target === big) dialog.close();
        });
        dialog.addEventListener('close', function () { big.src = PLACEHOLDER; big.alt = ''; });
    }

    // ------------------------------------------------------------------ media (Stage 3)
    // A still of the welcome pose, straight from MascotModule, as the videos' poster.
    var posterCache = null;
    function posterUri() {
        if (posterCache !== null) return posterCache;
        posterCache = '';
        var svg = Mascot ? svgFrom(Mascot.welcomeHtml()) : null;
        if (!svg || typeof XMLSerializer !== 'function') return posterCache;
        var W = 1280, H = 720, w = 400, h = Math.round(w * 200 / 220);
        svg.removeAttribute('aria-hidden');
        svg.setAttribute('x', String((W - w) / 2));
        svg.setAttribute('y', String(Math.round((H - h) / 2)));
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        var page = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '">' +
            '<rect width="' + W + '" height="' + H + '" fill="#f9f3e6"/>' +
            new XMLSerializer().serializeToString(svg) + '</svg>';
        posterCache = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(page);
        return posterCache;
    }

    // Only files listed in media/manifest.json are ever requested: a missing mp4 would 404 and
    // put an error in the console. onerror still covers a listed file that fails to load.
    function loadManifest() {
        if (typeof window.fetch !== 'function') return Promise.resolve([]);
        return fetch('media/manifest.json', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : { files: [] }; })
            .then(function (m) { return m && Array.isArray(m.files) ? m.files : []; })
            .catch(function () { return []; });
    }
    function listed(path) {
        return !!(mediaFiles && path && mediaFiles.indexOf(String(path).replace(/^media\//, '')) >= 0);
    }

    function updateVideoToggle() {
        var toggle = $('#hero-video-toggle');
        if (!toggle) return;
        toggle.classList.toggle('is-paused', heroVideoPaused);
        toggle.setAttribute('aria-label', t(heroVideoPaused ? 'hero.videoPlay' : 'hero.videoPause'));
    }

    function setupHeroVideo() {
        var file = CFG.media && CFG.media.heroLoop;
        var wrap = $('#hero-stage');
        var video = $('#hero-video');
        var toggle = $('#hero-video-toggle');
        if (!wrap || !video || !toggle || !listed(file)) return;   // not published yet: the live mascot is the hero
        function play() {
            heroVideoPaused = false;
            var p = video.play();
            if (p && typeof p.catch === 'function') p.catch(function () { heroVideoPaused = true; updateVideoToggle(); });
            updateVideoToggle();
        }
        function pause() { heroVideoPaused = true; video.pause(); updateVideoToggle(); }
        function fallBack() {
            wrap.classList.remove('has-video');
            video.hidden = true;
            toggle.hidden = true;
            video.removeAttribute('src');
            video.removeAttribute('poster');
        }
        video.addEventListener('loadeddata', function () {
            wrap.classList.add('has-video');
            video.hidden = false;
            toggle.hidden = false;
            if (isReduced()) pause(); else play();
        }, { once: true });
        video.addEventListener('error', fallBack, { once: true });
        toggle.addEventListener('click', function () { if (video.paused) play(); else pause(); });
        onReduceChange(function () { if (isReduced() && !video.hidden) pause(); });
        var poster = posterUri();
        if (poster) video.poster = poster;
        video.src = file;
    }

    function updateIntroVideo() {
        var frame = $('#intro-frame');
        var video = $('#intro-video');
        var soon = $('#intro-soon');
        if (!frame || !video || !soon) return;
        var file = CFG.media && CFG.media.intro && CFG.media.intro[lang];
        function showSoon() {
            if (!video.hidden) video.pause();
            video.removeAttribute('src');
            video.hidden = true;
            soon.hidden = false;
            frame.classList.add('is-soon');
        }
        if (!listed(file)) { showSoon(); return; }
        if (video.getAttribute('src') === file) return;
        video.onerror = function () { if (video.getAttribute('src') === file) showSoon(); };
        var poster = posterUri();
        if (poster) video.poster = poster;
        video.src = file;
        video.hidden = false;
        soon.hidden = true;
        frame.classList.remove('is-soon');
    }

    // ------------------------------------------------------------------ start
    safe('mascots', mountMascots);
    safe('i18n', applyI18n);
    safe('motion', function () { if (Motion && typeof Motion.init === 'function') Motion.init(); });
    safe('language toggle', setupLangToggle);
    safe('header', setupHeader);
    safe('reveal', setupReveal);
    safe('copy buttons', setupCopy);
    safe('zoom', setupZoom);
    safe('celebrations', setupEggs);
    safe('motion note', function () { onReduceChange(updateMotionNote); });
    safe('disclosure', function () {
        var line = $('#ai-disclosure');
        if (line) line.hidden = CFG.aiMediaDisclosure !== true;
    });
    root.classList.add('is-ready');
    loadManifest().then(function (files) {
        mediaFiles = files;
        safe('hero video', setupHeroVideo);
        safe('intro video', updateIntroVideo);
    });
})();
