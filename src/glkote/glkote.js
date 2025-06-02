'use strict';

/* GlkOte -- a Javascript display library for IF interfaces
 * GlkOte Library: version 2.3.7.
 * Designed by Andrew Plotkin <erkyrath@eblong.com>
 * <http://eblong.com/zarf/glk/glkote.html>
 * 
 * This Javascript library is copyright 2008-2025 by Andrew Plotkin.
 * It is distributed under the MIT license; see the "LICENSE" file.
 *
 * GlkOte is a tool for creating interactive fiction -- and other text-based
 * applications -- on a web page. It is a Javascript library which handles
 * the mechanics of displaying text, arranging panes of text, and accepting
 * text input from the user.
 *
 * GlkOte is based on the Glk API. However, GlkOte's API is not identical to
 * Glk, even allowing for the differences between Javascript and C. GlkOte is
 * adapted to the realities of a web application environment -- a thin
 * Javascript layer which communicates with a distant server in intermittent
 * bursts.
 *
 * GlkOte can be used from two angles. First, in a purely client-side IF
 * application. The (included, optional) glkapi.js file facilitates this; it
 * wraps around GlkOte and provides an API that is identical to Glk, as
 * closely as Javascript allows. An IF interpreter written in Javascript,
 * running entirely within the user's web browser, can use glkapi.js just as
 * a C interpreter uses a normal Glk library. Or it could bypass glkapi.js
 * and use GlkOte directly.
 *
 * Alternatively, GlkOte could be used with a Glk library which acts as a
 * web service. The RemGlk library (not included) can be used this way.
 * In this mode, GlkOte collects user input and sends it to the web service
 * as a AJAX request. The service decodes the (JSON-format) input data,
 * executes a game turn, and returns the game response as a (JSON-format)
 * reply to the request. A proof-of-concept can be found at:
 *     https://github.com/erkyrath/remote-if-demo
 *
 * (A few calls, or arguments of calls, are marked "for autosave/autorestore
 * only". These exist for the purpose of getting a game displayed in a known
 * state, which is rather more complicated than the usual situation of 
 * letting a game start up and run.)
 *
 * For full documentation, see the docs.html file in this package.
 */

/* All state is contained in GlkoteClass. */
var GlkOteClass = function() {

/* Module global variables */
let is_inited = false;
let game_interface = null;
let dom_context = undefined;
let dom_prefix = '';
let localization_map = {};
let windowport_id = 'windowport';
let gameport_id = 'gameport';
let errorpane_id = 'errorpane';
let errorcontent_id = 'errorcontent';
let loadingpane_id = 'loadingpane';
let max_buffer_length = 800; /* scrollback paragraphs to retain */
let generation = 0;
let generation_sent = -1;
let disabled = false;
let loading_visible = null;
let error_visible = false;
let windowdic = null;
let current_metrics = null;
let current_devpixelratio = null;
let current_viewportheight = null;
let orig_gameport_margins = null;
let last_known_focus = 0;
let last_known_paging = 0;
let windows_paging_count = 0;
const graphics_draw_queue = [];
let request_timer = null;
let request_timer_interval = null;
let resize_timer = null;
let retry_timer = null;
let is_mobile = false;
const perform_paging = true;
let detect_external_links = false;
let regex_external_links = null;
let debug_out_handler = null;

let Dialog = null; /* imported API object (the file select/open layer) */
let Blorb = null; /* imported API object (the resource layer) */

/* Some handy constants */
/* A non-breaking space character. */
const NBSP = '\xa0';
/* And a zero-width character. */
const ZWJ =  '\u200D';
/* Size of the scrollbar, give or take some. */
const approx_scroll_width = 20;
/* Margin for how close you have to scroll to end-of-page to kill the
   moreprompt. (Really this just counters rounding error. And the
   measurement error of different fonts in a window. But as long as
   this is less than the last-line bottom margin, it won't cause
   problems.) */
const moreprompt_margin = 4;
/* Minimum width of an input field. This comes up if the prompt is
   unusually long, ending near the right margin. We'd rather the
   input element wrap around to the next line in that case. */
const inputel_minwidth = 200;
    
/* Some constants for key event native values. (Not including function 
   keys.) */
const key_codes = {
    KEY_BACKSPACE: 8,
    KEY_TAB:       9,
    KEY_RETURN:   13,
    KEY_ESC:      27,
    KEY_LEFT:     37,
    KEY_UP:       38,
    KEY_RIGHT:    39,
    KEY_DOWN:     40,
    KEY_DELETE:   46,
    KEY_HOME:     36,
    KEY_END:      35,
    KEY_PAGEUP:   33,
    KEY_PAGEDOWN: 34,
    KEY_INSERT:   45
};

/* All the keys that can be used as line input terminators, and their
   native values. */
const terminator_key_names = {
    escape : key_codes.KEY_ESC,
    func1 : 112, func2 : 113, func3 : 114, func4 : 115, func5 : 116, 
    func6 : 117, func7 : 118, func8 : 119, func9 : 120, func10 : 121, 
    func11 : 122, func12 : 123
};
/* The inverse of the above. Maps native values to Glk key names. Set up at
   init time. */
const terminator_key_values = {};

/* The transcript-recording feature. If enabled, this sends session
   information to an external recording service. */
let recording = false;
let recording_state = null;
let recording_handler = null;
let recording_handler_url = null;
const recording_context = {};

/* An image cache. This maps numbers or url strings to Image objects.
   These are used only for painting in graphics (canvas) windows.
*/
const image_cache = {};

/* This function becomes GlkOte.init(). The document calls this to begin
   the game. The simplest way to do this is to give the <body> tag an
   onLoad="GlkOte.init();" attribute.
*/
function glkote_init(iface) {
    if (!iface && window.Game)
        iface = window.Game;
    if (!iface) {
        glkote_error('No game interface object has been provided.');
        return;
    }
    if (!iface.accept) {
        glkote_error('The game interface object must have an accept() function.');
        return;
    }
    game_interface = iface;

    if (!window.jQuery || !jQuery.fn.jquery) {
        glkote_error('The jQuery library has not been loaded.');
        return;
    }

    const version = jQuery.fn.jquery.split('.');
    if (version.length < 2 || version[0] < 1 || (version[0] == 1 && version[1] < 9)) {
        glkote_error('This version of the jQuery library is too old. (Version ' + jQuery.fn.jquery + ' found; 1.9.0 required.)');
        return;
    }

    /* Set up a static table. */
    for (const val in terminator_key_names) {
        terminator_key_values[terminator_key_names[val]] = val;
    }

    /* Checking this is bad form, but we will use it for some UI tweaks. */
    is_mobile = ('ontouchstart' in window);

    /* Map mapping window ID (strings) to window description objects. */
    windowdic = new Map();

    /* Get the localization map, if provided.
       (Despite the name, this is a plain object, not a Map. Sorry.) */
    if (iface.localize)
        localization_map = iface.localize;

    /* Set the top-level DOM element ids, if provided. */
    if (iface.dom_prefix)
        dom_prefix = iface.dom_prefix;
    if (iface.windowport)
        windowport_id = iface.windowport;
    if (iface.gameport)
        gameport_id = iface.gameport;
    if (iface.errorpane)
        errorpane_id = iface.errorpane;
    if (iface.errorcontent)
        errorcontent_id = iface.errorcontent;
    if (iface.loadingpane)
        loadingpane_id = iface.loadingpane;

    const el = $('#'+windowport_id, dom_context);
    if (!el.length) {
        glkote_error('Cannot find windowport element #'+windowport_id+' in this document.');
        return;
    }
    el.empty();
    if (perform_paging)
        $(document).on('keypress', evhan_doc_keypress);
    $(window).on('resize', evhan_doc_resize);

    /* Note the pixel ratio (resolution level; this is greater than 1 for
       high-res displays. */
    current_devpixelratio = window.devicePixelRatio || 1;

    /* Record the original top and bottom margins (from window-edge) of
       the gameport. Also of the element that gameport is relative to.
       These will be needed for mobile keyboard resizing. */
    const gameport = $('#'+gameport_id, dom_context);
    const gameparent = gameport.offsetParent();
    orig_gameport_margins = {
        top: gameport.offset().top,
        bottom: $(window).height() - (gameport.offset().top + gameport.outerHeight()),
        parenttop: gameparent.offset().top,
        /* We won't need parentbottom. If we did, we'd have to be careful
           of the case where gameparent is <html>. */
    };

    /* We can get callbacks on any *boolean* change in the resolution level.
       Not, unfortunately, on all changes. */
    if (window.matchMedia) {
        window.matchMedia('screen and (min-resolution: 1.5dppx)').addListener(evhan_doc_pixelreschange);
        window.matchMedia('screen and (min-resolution: 2dppx)').addListener(evhan_doc_pixelreschange);
        window.matchMedia('screen and (min-resolution: 3dppx)').addListener(evhan_doc_pixelreschange);
        window.matchMedia('screen and (min-resolution: 4dppx)').addListener(evhan_doc_pixelreschange);
    }

    /* Figure out the window size and font metrics. */
    const res = measure_window();
    if (jQuery.type(res) === 'string') {
        glkote_error(res);
        return;
    }
    current_metrics = res;

    /* Add an observer which will give us notifications if the gameport
       size changes. */
    create_resize_sensor();

    if (iface.max_buffer_length)
        max_buffer_length = iface.max_buffer_length;
    
    /* Check the options that control whether URL-like strings in the output
       are displayed as hyperlinks. */
    detect_external_links = iface.detect_external_links;
    if (detect_external_links) {
        regex_external_links = iface.regex_external_links;
        if (!regex_external_links) {
            /* Fill in a default regex for matching or finding URLs. */
            if (detect_external_links == 'search') {
                /* The searching case is hard. This regex is based on John Gruber's
                   monstrosity, the "web URL only" variant:
                   http://daringfireball.net/2010/07/improved_regex_for_matching_urls
                   I cut it down a bit; it will not recognize bare domain names like
                   "www.eblong.com". I also removed the "(?i)" from the beginning,
                   because Javascript doesn't handle that syntax. (It's supposed to
                   make the regex case-insensitive.) Instead, we use the 'i'
                   second argument to RegExp().
                */
                regex_external_links = RegExp('\\b((?:https?://)(?:[^\\s()<>]+|\\(([^\\s()<>]+|(\\([^\\s()<>]+\\)))*\\))+(?:\\(([^\\s()<>]+|(\\([^\\s()<>]+\\)))*\\)|[^\\s`!()\\[\\]{};:\'".,<>?\u00ab\u00bb\u201c\u201d\u2018\u2019]))', 'i');
            }
            else {
                /* The matching case is much simpler. This matches any string
                   beginning with "http" or "https". */
                regex_external_links = RegExp('^https?:', 'i');
            }
        }
    }

    /* Check the options that control transcript recording. */
    if (iface.recording_url) {
        recording = true;
        recording_handler = recording_standard_handler;
        recording_handler_url = iface.recording_url;
    }
    if (iface.recording_handler) {
        recording = true;
        recording_handler = iface.recording_handler;
        recording_handler_url = '(custom handler)';
    }
    if (recording) {
        /* But also check whether the user has opted out by putting "feedback=0"
           in the URL query. */
        const qparams = get_query_params();
        const flag = qparams['feedback'];
        if (jQuery.type(flag) != 'undefined' && flag != '1') {
            recording = false;
            glkote_log('User has opted out of transcript recording.');
        }
        else {
            /* Set up the recording-state object. */
            let sessionid = null;
            try {
                /* UUID-style */
                sessionid = crypto.randomUUID();
            }
            catch (ex) {
                /* The old way, all numeric digits */
                sessionid = (new Date().getTime()) + '' + (Math.ceil( Math.random() * 10000 ));
            }
            recording_state = {
                sessionId: sessionid,
                input: null, output: null,
                timestamp: 0, outtimestamp: 0
            };
            if (iface.recording_label)
                recording_state.label = iface.recording_label;
            if (iface.recording_format == 'simple')
                recording_state.format = 'simple';
            else
                recording_state.format = 'glkote';
            glkote_log('Transcript recording active: session ' + recording_state.sessionId + ' "' + recording_state.label + '", destination ' + recording_handler_url);
        }
    }

    if (iface.debug_commands) {
        let debugmod = window.GiDebug;
        if (iface.debug_commands != true)
            debugmod = iface.debug_commands;
        if (!debugmod) {
            glkote_log('The debug_commands option is set, but there is no GiDebug module.');
        }
        else {
            debugmod.init(evhan_debug_command);
            debug_out_handler = debugmod.output;
            if (iface.debug_console_open)
                debugmod.open();
        }
    }

    /* Either Blorb was passed in or we don't have one. */
    if (iface.Blorb) {
        Blorb = iface.Blorb;
    }

    /* Either Dialog was passed in or we must create one. */
    if (iface.Dialog) {
        Dialog = iface.Dialog;
        /* This might be inited or not. */
    }
    else if (window.DialogClass) {
        Dialog = new window.DialogClass();
        /* Will have to init. */
    }

    /* From here, every path must call finish_init(). But it might happen async (after a delay). */
    
    /* If Dialog exists but has not yet been inited, we should init it. */
    if (Dialog && !Dialog.inited()) {
        /* Default config object for initing the Dialog library. It only cares about two fields: GlkOte and dom_prefix.
           We pass along dialog_dom_prefix (as dom_prefix) and localize, if supplied. */
        const dialogiface = { GlkOte:this };
        if (iface.dialog_dom_prefix) {
            dialogiface.dom_prefix = iface.dialog_dom_prefix;
        }
        if (iface.localize) {
            dialogiface.localize = iface.localize;
        }

        /* We might have a sync or async init call! (ElectroFS uses the async style.) */
        if (Dialog.init_async) {
            Dialog.init_async(dialogiface, function() { finish_init(iface); });
            return; /* callback will call finish_init(). */
        }
        else if (Dialog.init) {
            Dialog.init(dialogiface);
        }
    }
    
    finish_init(iface);
}

/* Conclude the glkote_init() procedure. This sends the VM its "init"
   event. */
function finish_init(iface) {
    is_inited = true;
    if (!iface.font_load_delay) {
        /* Normal case: start the game (interpreter) immediately. */
        send_response('init', null, current_metrics);
    }
    else {
        /* Delay case: wait a tiny interval, then re-check the window metrics
           and *then* start the game. We might need to do this if the window
           fonts were not cached or loaded with the DOM. (Lectrote, for example,
           because of the way it loads font preferences.) */
        disabled = true;
        defer_func(function() {
            disabled = false;
            current_metrics = measure_window();
            send_response('init', null, current_metrics);
        });
    }
}

function glkote_inited() {
    return is_inited;
}

/* Work out various pixel measurements used to compute window sizes:
   - the width and height of the windowport
   - the width and height of a character in a grid window
   - ditto for buffer windows (although this is only approximate, since
   buffer window fonts can be non-fixed-width, and styles can have
   different point sizes)
   - the amount of padding space around buffer and grid window content

   This stuff is determined by creating some invisible, offscreen windows
   and measuring their dimensions.
*/
function measure_window() {
    const metrics = {};

    /* We assume the gameport is the same size as the windowport, which
       is true on all browsers but IE7. Fortunately, on IE7 it's
       the windowport size that's wrong -- gameport is the size
       we're interested in. */
    const gameport = $('#'+gameport_id, dom_context);
    if (!gameport.length)
        return 'Cannot find gameport element #'+gameport_id+' in this document.';

    /* If the HTML file includes an #layouttestpane div, we discard it.
       We used to do metrics measurements from a predefined div with
       that name. Nowadays, it's sometimes used as a hidden font-preloader. */
    $('#'+dom_prefix+'layouttestpane', dom_context).remove();

    /* Gameport size, excluding padding and border.

       We subtract one pixel because the width()/height() methods round
       to the nearest integer (not the floor). If they rounded up, the
       game might overflow the actual gameport by a pixel, which could
       produce nasty spurious scrollbars.
       
       (TODO: in jQuery 3, the width()/height() methods do not round.
       Could upgrade and use those with Math.floor().)
    */
    metrics.width  = Math.max(0, gameport.width()-1);
    metrics.height = Math.max(0, gameport.height()-1);

    /* Create a dummy layout div containing a grid window and a buffer window,
       each with two lines of text. */
    const layout_test_pane = $('<div>', { id:dom_prefix+'layout_test_pane' });
    layout_test_pane.text('This should not be visible');
    layout_test_pane.css({
        /* "display:none" would make the pane not render at all, making it
           impossible to measure. Instead, make it invisible and offscreen. */
        position: 'absolute',
        visibility: 'hidden',
        left: '-1000px'
    });
    const line = $('<div>');
    line.append($('<span>', {'class': 'Style_normal'}).text('12345678'));

    const gridwin = $('<div>', {'class': 'WindowFrame GridWindow'});
    const gridline1 = line.clone().addClass('GridLine').appendTo(gridwin);
    const gridline2 = line.clone().addClass('GridLine').appendTo(gridwin);
    const gridspan = gridline1.children('span');
    layout_test_pane.append(gridwin);

    const bufwin = $('<div>', {'class': 'WindowFrame BufferWindow'});
    const bufline1 = line.clone().addClass('BufferLine').appendTo(bufwin);
    const bufline2 = line.clone().addClass('BufferLine').appendTo(bufwin);
    const invcurspan = $('<span>', {'class': 'InvisibleCursor'});
    bufline2.append(invcurspan);
    const bufspan = bufline1.children('span');
    layout_test_pane.append(bufwin);

    const graphwin = $('<div>', {'class': 'WindowFrame GraphicsWindow'});
    const graphcanvas = $('<canvas>');
    graphcanvas.attr('width', 64);
    graphcanvas.attr('height', 32);
    graphwin.append(graphcanvas);
    layout_test_pane.append(graphwin);

    gameport.append(layout_test_pane);

    function get_size(el) {
        return {
            width: el.outerWidth(),
            height: el.outerHeight()
        };
    }

    /* Here we will include padding and border. */
    let winsize = get_size(gridwin);
    let spansize = get_size(gridspan);
    let line1size = get_size(gridline1);
    let line2size = get_size(gridline2);

    metrics.gridcharheight = Math.max(1, gridline2.position().top - gridline1.position().top);
    metrics.gridcharwidth = Math.max(1, gridspan.width() / 8);
    /* Yes, we can wind up with a non-integer charwidth value. But we force the value to be >= 1; zero can lead to annoying NaNs later on. */

    /* Find the total margin around the character grid (out to the window's
       padding/border). These values include both sides (left+right,
       top+bottom). */
    metrics.gridmarginx = winsize.width - spansize.width;
    metrics.gridmarginy = winsize.height - (line1size.height + line2size.height);

    /* Here we will include padding and border. */
    winsize = get_size(bufwin);
    spansize = get_size(bufspan);
    line1size = get_size(bufline1);
    line2size = get_size(bufline2);

    metrics.buffercharheight = Math.max(1, bufline2.position().top - bufline1.position().top);
    metrics.buffercharwidth = Math.max(1, bufspan.width() / 8);
    /* Again, at least 1, but not necessarily integer. */

    /* Again, these values include both sides (left+right, top+bottom).
       We add a couple of pixels to the vertical margin to allow for
       measurement error in different fonts. */
    metrics.buffermarginx = winsize.width - spansize.width;
    metrics.buffermarginy = winsize.height - (line1size.height + line2size.height) + 2;

    /* Here we will include padding and border. */
    winsize = get_size(graphwin);
    const canvassize = get_size(graphcanvas);
    
    /* Again, these values include both sides (left+right, top+bottom). */
    metrics.graphicsmarginx = winsize.width - canvassize.width;
    metrics.graphicsmarginy = winsize.height - canvassize.height;

    /* Now that we're done measuring, discard the pane. */
    layout_test_pane.remove();
    
    /* These values come from the game interface object.
       Specific fields like "inspacingx" will default to general terms like
       "spacing", if not supplied.
       (The complete_metrics() function in glkapi.js does this job too, but
       this implementation is older and I don't want to ditch it.) */
    metrics.outspacingx = 0;
    metrics.outspacingy = 0;
    metrics.inspacingx = 0;
    metrics.inspacingy = 0;

    if (game_interface.spacing != undefined) {
        metrics.outspacingx = game_interface.spacing;
        metrics.outspacingy = game_interface.spacing;
        metrics.inspacingx = game_interface.spacing;
        metrics.inspacingy = game_interface.spacing;
    }
    if (game_interface.outspacing != undefined) {
        metrics.outspacingx = game_interface.outspacing;
        metrics.outspacingy = game_interface.outspacing;
    }
    if (game_interface.inspacing != undefined) {
        metrics.inspacingx = game_interface.inspacing;
        metrics.inspacingy = game_interface.inspacing;
    }
    if (game_interface.inspacingx != undefined)
        metrics.inspacingx = game_interface.inspacingx;
    if (game_interface.inspacingy != undefined)
        metrics.inspacingy = game_interface.inspacingy;
    if (game_interface.outspacingx != undefined)
        metrics.outspacingx = game_interface.outspacingx;
    if (game_interface.outspacingy != undefined)
        metrics.outspacingy = game_interface.outspacingy;

    return metrics;
}

/* Compare two metrics objects; return whether they're "roughly"
   similar. (We only care about window size and some of the font
   metrics, because those are the fields likely to change out
   from under the library.)
*/
function metrics_match(met1, met2) {
    if (met1.width != met2.width)
        return false;
    if (met1.height != met2.height)
        return false;
    if (met1.gridcharwidth != met2.gridcharwidth)
        return false;
    if (met1.gridcharheight != met2.gridcharheight)
        return false;
    if (met1.buffercharwidth != met2.buffercharwidth)
        return false;
    if (met1.buffercharheight != met2.buffercharheight)
        return false;
    return true;
}

/* Create an object which will fire events if the gameport changes size.
   (For any reason, including document CSS changes. We need this to detect
   Lectrote's margin change, for example.)
*/
function create_resize_sensor() {
    const gameport = $('#'+gameport_id, dom_context);
    if (!gameport.length) {
        console.log('Cannot find gameport element #'+gameport_id+' in this document.');
        return;
    }

    /* This event fires copiously when the window is being resized.
       This is one reason evhan_doc_resize() has debouncing logic. */
    function evhan(ents) {
        evhan_doc_resize();
    }

    try {
        let observer = new ResizeObserver(evhan);
        observer.observe(gameport.get(0));
    } catch (ex) {
        console.log('ResizeObserver is not available in this browser.');
    }

    if (is_mobile && window.visualViewport) {
        $(visualViewport).on('resize', evhan_viewport_resize);
    }
}

/* This function becomes GlkOte.update(). The game calls this to update
   the screen state. The argument includes all the information about new
   windows, new text, and new input requests -- everything necessary to
   construct a new display state for the user.
*/
function glkote_update(arg) {
    hide_loading();

    /* This field is *only* for the autorestore case, and only on the very
       first update. It contains additional information (from save_allstate)
       which helps recreate the display. */
    let autorestore = null;
    if (arg.autorestore && generation == 0)
        autorestore = arg.autorestore;

    /* In the autorestore case we skip recording. We don't yet have the
       session ID (that'll be pulled *from* the autorestore data), so this
       would just create a garbage one-line session. */
    
    if (recording && !autorestore) {
        recording_send(arg);
    }

    if (arg.debugoutput && debug_out_handler) {
        debug_out_handler(arg.debugoutput);
    }

    if (arg.type == 'error') {
        glkote_error(arg.message);
        return;
    }

    if (arg.type == 'pass') {
        return;
    }

    if (arg.type == 'retry') {
        if (!retry_timer) {
            glkote_log('Event has timed out; will retry...');
            show_loading();
            retry_timer = delay_func(2, retry_update);
        }
        else {
            glkote_log('Event has timed out, but a retry is already queued!');
        }
        return;
    }

    if (arg.type != 'update') {
        glkote_log('Ignoring unknown message type ' + arg.type + '.');
        return;
    }

    if (arg.gen == generation) {
        /* Nothing has changed. */
        glkote_log('Ignoring repeated generation number: ' + generation);
        return;
    }
    if (arg.gen < generation) {
        /* This update belongs in the past. */
        glkote_log('Ignoring out-of-order generation number: got ' + arg.gen + ', currently at ' + generation);
        return;
    }
    generation = arg.gen;

    /* Un-disable the UI, if it was previously disabled. */
    if (disabled) {
        for (const win of windowdic.values()) {
            if (win.inputel) {
                win.inputel.prop('disabled', false);
            }
        }
        disabled = false;
    }

    /* Perform the updates, in a most particular order. */

    if (arg.input != null)
        accept_inputcancel(arg.input);
    if (arg.windows != null)
        accept_windowset(arg.windows);
    if (arg.content != null)
        accept_contentset(arg.content);
    if (arg.input != null)
        accept_inputset(arg.input);

    /* Note that a timer value of null is different from undefined. */
    if (arg.timer !== undefined)
        accept_timerrequest(arg.timer);

    if (arg.specialinput != null)
        accept_specialinput(arg.specialinput);

    /* Any buffer windows that have changed need to be scrolled down.
       Then, we take the opportunity to update topunseen. (If a buffer
       window hasn't changed, topunseen hasn't changed.) */

    for (const win of windowdic.values()) {
        if (win.type == 'buffer' && win.needscroll) {
            /* needscroll is true if the window has accumulated any content or
               an input field in this update cycle. needspaging is true if
               the window has any unviewed content from *last* cycle; we set 
               it now if any new content remains unviewed after the first
               obligatory scrolldown. 
               (If perform_paging is false, we forget about needspaging and
               just always scroll to the bottom.) */
            win.needscroll = false;

            if (!win.needspaging) {
                const frameel = win.frameel;

                if (!perform_paging) {
                    /* Scroll all the way down. Note that scrollHeight is not a jQuery
                       property; we have to go to the raw DOM to get it. */
                    frameel.scrollTop(frameel.get(0).scrollHeight);
                    win.needspaging = false;
                    win.scrolledtoend = true;
                }
                else {
                    /* Scroll the unseen content to the top. */
                    frameel.scrollTop(win.topunseen - current_metrics.buffercharheight);
                    const frameheight = frameel.outerHeight();
                    win.scrolledtoend = frameel.scrollTop() + frameheight + moreprompt_margin >= frameel.get(0).scrollHeight;
                    /* Compute the new topunseen value. */
                    win.pagefrommark = win.topunseen;
                    const realbottom = buffer_last_line_top_offset(win);
                    let newtopunseen = frameel.scrollTop() + frameheight;
                    if (newtopunseen > realbottom)
                        newtopunseen = realbottom;
                    if (win.topunseen < newtopunseen)
                        win.topunseen = newtopunseen;
                    /* The scroll-down has not touched needspaging, because it is
                       currently false. Let's see if it should be true. */
                    if (frameel.scrollTop() + frameheight + moreprompt_margin >= frameel.get(0).scrollHeight) {
                        win.needspaging = false;
                    }
                    else if (frameheight <= current_metrics.buffercharheight) {
                        /* Window is too small to bother paging. */
                        win.needspaging = false;
                    }
                    else {
                        win.needspaging = true;
                    }
                }

                /* Add or remove the more prompt and previous mark, based on the
                   new needspaging flag. Note that the more-prompt will be
                   removed when the user scrolls down; but the prev-mark
                   stays until we get back here. */
                let moreel = $('#'+dom_prefix+'win'+win.id+'_moreprompt', dom_context);
                let prevel = $('#'+dom_prefix+'win'+win.id+'_prevmark', dom_context);
                if (!win.needspaging) {
                    if (moreel.length)
                        moreel.remove();
                    if (prevel.length)
                        prevel.remove();
                }
                else {
                    if (!moreel.length) {
                        moreel = $('<div>',
                                   { id: dom_prefix+'win'+win.id+'_moreprompt', 'class': 'MorePrompt' } );
                        moreel.text(localize('glkote_more'));
                        /* 20 pixels is a cheap approximation of a scrollbar-width. */
                        const morex = win.coords.right + approx_scroll_width;
                        const morey = win.coords.bottom;
                        moreel.css({ bottom:morey+'px', right:morex+'px' });
                        $('#'+windowport_id, dom_context).append(moreel);
                    }
                    if (!prevel.length) {
                        prevel = $('<div>',
                                   { id: dom_prefix+'win'+win.id+'_prevmark', 'class': 'PreviousMark' } );
                        frameel.prepend(prevel);
                    }
                    prevel.css('top', (win.pagefrommark+'px'));
                }
            }
        }
        else if (win.type == 'buffer') { /* but *not* win.needscroll */
            /* This window has no new content. If its size has
               changed, it would be smart to adjust the scrolling so
               that the same text is visible.
               Ideally that means the same *bottom line* of text as
               before. But we're not that smart. We enforce a simpler
               rule: If the window was scrolled all the way down before,
               it should still be. */
            if (win.scrolledtoend) {
                const frameel = win.frameel;
                frameel.scrollTop(frameel.get(0).scrollHeight);
            }
        }
    }

    /* Set windows_paging_count. (But don't set the focus -- we'll do that
       momentarily.) */
    readjust_paging_focus(false);

    /* Disable everything, if that was requested (or if this is a special
       input cycle). */
    disabled = false;
    if (arg.disable || arg.specialinput) {
        disabled = true;
        for (const win of windowdic.values()) {
            if (win.inputel) {
                win.inputel.prop('disabled', true);
            }
        }
    }

    /* Figure out which window to set the focus to. (But not if the UI is
       disabled. We also skip this if there's paging to be done, because
       focussing might autoscroll and we want to trap keystrokes for 
       paging anyhow.) */

    let newinputwin = 0;
    if (!disabled && !windows_paging_count) {
        for (const win of windowdic.values()) {
            if (win.input) {
                if (!newinputwin || win.id == last_known_focus)
                    newinputwin = win.id;
            }
        }
    }

    if (newinputwin) {
        const win = windowdic.get(newinputwin);
        if (win.inputel) {
            win.inputel.focus();
        }
    }

    if (autorestore) {
        if (autorestore.history) {
            for (const [winid, ls] of Object.entries(autorestore.history)) {
                const win = windowdic.get(winid);
                if (win != null) {
                    win.history = ls.slice(0);
                    win.historypos = win.history.length;
                }
            }
        }
        if (autorestore.defcolor) {
            for (const [winid, val] of Object.entries(autorestore.defcolor)) {
                const win = windowdic.get(winid);
                if (win != null) {
                    win.defcolor = val;
                }
            }
        }
        if (autorestore.recording_sessionid) {
            if (recording && recording_state) {
                recording_state.sessionId = autorestore.recording_sessionid;
                glkote_log('Transcript recording restored: session ' + recording_state.sessionId + ' "' + recording_state.label + '", destination ' + recording_handler_url);
            }
        }

        /* For the case of autorestore (only), we short-circuit the paging
           mechanism and assume the player has already seen all the text. */
        for (const win of windowdic.values()) {
            if (win.type == 'buffer') {
                window_scroll_to_bottom(win);
            }
        }
        
        if (!(autorestore.metrics 
              && autorestore.metrics.width == current_metrics.width 
              && autorestore.metrics.height == current_metrics.height)) {
            /* The window metrics don't match what's recorded in the
               autosave. Trigger a synthetic resize event. */
            current_metrics.width += 2;
            evhan_doc_resize();
        }
    }

    /* Done with the update. Exit and wait for the next input event. */
}

/* Handle all the window changes. The argument lists all windows that
   should be open. Any unlisted windows, therefore, get closed.

   Note that if there are no changes to the window state, this function
   will not be called. This is different from calling this function with
   an empty argument object (which would mean "close all windows").
*/
function accept_windowset(arg) {
    for (const win of windowdic.values()) {
        win.inplace = false;
    }

    arg.forEach(accept_one_window);

    /* Close any windows not mentioned in the argument. */
    const closewins = [];
    for (const win of windowdic.values()) {
        if (!win.inplace) {
            closewins.push(win);
        }
    }
    for (const win of closewins) {
        close_one_window(win);
    }
}

/* Handle the update for a single window. Open it if it doesn't already
   exist; set its size and position, if those need to be changed.
*/
function accept_one_window(arg) {
    let frameel, win;

    if (!arg) {
        return;
    }

    win = windowdic.get(arg.id);
    if (win == null) {
        /* The window must be created. */
        win = { id: arg.id, type: arg.type, rock: arg.rock };
        windowdic.set(arg.id, win);
        let typeclass;
        if (win.type == 'grid')
            typeclass = 'GridWindow';
        if (win.type == 'buffer')
            typeclass = 'BufferWindow';
        if (win.type == 'graphics')
            typeclass = 'GraphicsWindow';
        const rockclass = 'WindowRock_' + arg.rock;
        frameel = $('<div>',
                    { id: dom_prefix+'window'+arg.id,
                      'class': 'WindowFrame HasNoInputField ' + typeclass + ' ' + rockclass });
        frameel.data('winid', arg.id);
        frameel.on('mousedown', arg.id, evhan_window_mousedown);
        if (perform_paging && win.type == 'buffer')
            frameel.on('scroll', arg.id, evhan_window_scroll);
        if (win.type == 'grid' || win.type == 'graphics')
            frameel.on('click', win.id, evhan_input_mouse_click);
        if (win.type == 'buffer')
            frameel.attr({
                'aria-live':'polite',
                'aria-atomic':'false',
                'aria-relevant':'additions' });
        win.frameel = frameel;
        win.gridheight = 0;
        win.gridwidth = 0;
        win.input = null;
        win.inputel = null;
        win.terminators = {};
        win.reqhyperlink = false;
        win.reqmouse = false;
        win.needscroll = false;
        win.needspaging = false;
        win.scrolledtoend = true;
        win.topunseen = 0;
        win.pagefrommark = 0;
        win.coords = { left:null, top:null, right:null, bottom:null };
        win.history = new Array();
        win.historypos = 0;
        $('#'+windowport_id, dom_context).append(frameel);
    }
    else {
        frameel = win.frameel;
        if (win.type != arg.type)
            glkote_error('Window ' + arg.id + ' was created with type ' + win.type + ', but now is described as type ' + arg.type);
    }

    win.inplace = true;

    if (win.type == 'grid') {
        /* Make sure we have the correct number of GridLine divs. */
        if (arg.gridheight > win.gridheight) {
            for (let ix=win.gridheight; ix<arg.gridheight; ix++) {
                const el = $('<div>',
                             { id: dom_prefix+'win'+win.id+'_ln'+ix, 'class': 'GridLine' });
                el.append(NBSP);
                win.frameel.append(el);
            }
        }
        if (arg.gridheight < win.gridheight) {
            for (let ix=arg.gridheight; ix<win.gridheight; ix++) {
                const el = $('#'+dom_prefix+'win'+win.id+'_ln'+ix, dom_context);
                if (el.length)
                    el.remove();
            }
        }
        win.gridheight = arg.gridheight;
        win.gridwidth = arg.gridwidth;
    }

    if (win.type == 'buffer') {
        /* Don't need anything? */
    }

    if (win.type == 'graphics') {
        let el = $('#'+dom_prefix+'win'+win.id+'_canvas', dom_context);
        if (!el.length) {
            win.graphwidth = arg.graphwidth;
            win.graphheight = arg.graphheight;
            win.defcolor = '#FFF';
            el = $('<canvas>',
                   { id: dom_prefix+'win'+win.id+'_canvas' });
            /* The pixel-ratio code here should work correctly on Chrome and
               Safari, on screens of any pixel-ratio. I followed
               http://www.html5rocks.com/en/tutorials/canvas/hidpi/ .
            */
            win.backpixelratio = 1;
            const ctx = canvas_get_2dcontext(el);
            if (ctx) {
                /* This property is still namespaced as of 2016. */
                win.backpixelratio = ctx.webkitBackingStorePixelRatio
                    || ctx.mozBackingStorePixelRatio
                    || ctx.msBackingStorePixelRatio
                    || ctx.oBackingStorePixelRatio
                    || ctx.backingStorePixelRatio 
                    || 1;
            }
            win.scaleratio = current_devpixelratio / win.backpixelratio;
            el.attr('width', win.graphwidth * win.scaleratio);
            el.attr('height', win.graphheight * win.scaleratio);
            el.css('width', (win.graphwidth + 'px'));
            el.css('height', (win.graphheight + 'px'));
            win.frameel.css('background-color', win.defcolor);
            if (ctx) {
                /* Set scale to win.scaleratio */
                ctx.setTransform(win.scaleratio, 0, 0, win.scaleratio, 0, 0);
            }
            win.frameel.append(el);
        }
        else {
            if (win.graphwidth != arg.graphwidth || win.graphheight != arg.graphheight) {
                win.graphwidth = arg.graphwidth;
                win.graphheight = arg.graphheight;
                el.attr('width', win.graphwidth * win.scaleratio);
                el.attr('height', win.graphheight * win.scaleratio);
                el.css('width', (win.graphwidth + 'px'));
                el.css('height', (win.graphheight + 'px'));
                /* Clear to the default color, as if for a "fill" command. */
                const ctx = canvas_get_2dcontext(el);
                if (ctx) {
                    ctx.setTransform(win.scaleratio, 0, 0, win.scaleratio, 0, 0);
                    ctx.fillStyle = win.defcolor;
                    ctx.fillRect(0, 0, win.graphwidth, win.graphheight);
                    ctx.fillStyle = '#000000';
                }
                win.frameel.css('background-color', win.defcolor);
                /* We have to trigger a redraw event for this window. But we can't do
                   that from inside the accept handler. We'll set up a deferred
                   function call. */
                const funcarg = win.id;
                defer_func(function() { send_window_redraw(funcarg); });
            }
        }
    }

    /* We used to set the "right" and "bottom" CSS values in styledic,
       but that led to unpleasant (albeit transient) window-squashing
       during resize. Using outerWidth()/outerHeight() works better. */
    const right = current_metrics.width - (arg.left + arg.width);
    const bottom = current_metrics.height - (arg.top + arg.height);
    const styledic = { left: arg.left+'px', top: arg.top+'px' };
    win.coords.left = arg.left;
    win.coords.top = arg.top;
    win.coords.right = right;
    win.coords.bottom = bottom;
    frameel.css(styledic);
    frameel.outerWidth(arg.width);
    frameel.outerHeight(arg.height);
}

/* Handle closing one window. */
function close_one_window(win) {
    win.frameel.remove();
    windowdic.delete(win.id);
    win.frameel = null;

    const moreel = $('#'+dom_prefix+'win'+win.id+'_moreprompt', dom_context);
    if (moreel.length)
        moreel.remove();
}

/* Handle all of the window content changes. */
function accept_contentset(arg) {
    arg.forEach(accept_one_content);
}

/* Handle the content changes for a single window. */
function accept_one_content(arg) {
    const win = windowdic.get(arg.id);

    /* Check some error conditions. */

    if (win == null) {
        glkote_error('Got content update for window ' + arg.id + ', which does not exist.');
        return;
    }

    if (win.input && win.input.type == 'line') {
        glkote_error('Got content update for window ' + arg.id + ', which is awaiting line input.');
        return;
    }

    win.needscroll = true;

    if (win.type == 'grid') {
        /* Modify the given lines of the grid window (and leave the rest alone). */
        const lines = arg.lines;
        for (let ix=0; ix<lines.length; ix++) {
            const linearg = lines[ix];
            const linenum = linearg.line;
            const content = linearg.content;
            const lineel = $('#'+dom_prefix+'win'+win.id+'_ln'+linenum, dom_context);
            if (!lineel.length) {
                glkote_error('Got content for nonexistent line ' + linenum + ' of window ' + arg.id + '.');
                continue;
            }
            if (!content || !content.length) {
                lineel.text(NBSP);
            }
            else {
                lineel.empty();
                for (let sx=0; sx<content.length; sx++) {
                    const rdesc = content[sx];
                    let rstyle, rtext, rlink;
                    if (jQuery.type(rdesc) === 'object') {
                        if (rdesc.special !== undefined)
                            continue;
                        rstyle = rdesc.style;
                        rtext = rdesc.text;
                        rlink = rdesc.hyperlink;
                    }
                    else {
                        rstyle = rdesc;
                        sx++;
                        rtext = content[sx];
                        rlink = undefined;
                    }
                    const el = $('<span>',
                                 { 'class': 'Style_' + rstyle } );
                    if (rlink == undefined) {
                        insert_text_detecting(el, rtext);
                    }
                    else {
                        const ael = $('<a>',
                                      { 'href': '#', 'class': 'Internal' } );
                        ael.text(rtext);
                        ael.on('click', build_evhan_hyperlink(win.id, rlink));
                        el.append(ael);
                    }
                    lineel.append(el);
                }
            }
        }
    }

    if (win.type == 'buffer') {
        /* Append the given lines onto the end of the buffer window. */
        let text = arg.text;

        if (win.inputel) {
            /* This can happen if we're waiting for char input. (Line input
               would make this content update illegal -- but we already checked
               that.) The inputel is inside the cursel, which we're about to
               rip out. We remove it, so that we can put it back later. */
            win.inputel.detach();
        }

        let cursel = $('#'+dom_prefix+'win'+win.id+'_cursor', dom_context);
        if (cursel.length)
            cursel.remove();
        cursel = null;

        if (arg.clear) {
            win.frameel.empty();
            win.topunseen = 0;
            win.pagefrommark = 0;
        }

        /* Accept a missing text field as doing nothing. */
        if (text === undefined)
            text = [];

        /* Each line we receive has a flag indicating whether it *starts*
           a new paragraph. (If the flag is false, the line gets appended
           to the previous paragraph.)

           We have to keep track of a flag per paragraph div. The blankpara
           flag indicates whether this is a completely empty paragraph (a
           blank line). We have to drop a space into empty paragraphs --
           otherwise they'd collapse -- and so this flag lets us distinguish
           between an empty paragraph and one which truly contains a space.
           (The difference is, when you append data to a truly empty paragraph,
           you have to delete the placeholder space.)

           We also give the paragraph div the BlankPara class, in case
           CSS cares.
        */

        for (let ix=0; ix<text.length; ix++) {
            const textarg = text[ix];
            const content = textarg.content;
            let divel = null;
            if (textarg.append) {
                if (!content || !content.length)
                    continue;
                divel = buffer_last_line(win);
            }
            if (divel == null) {
                /* Create a new paragraph div */
                divel = $('<div>', { 'class': 'BufferLine BlankPara' });
                divel.data('blankpara', true);
                win.frameel.append(divel);
            }
            if (textarg.flowbreak) {
                divel.addClass('FlowBreak');
            }
            if (!content || !content.length) {
                if (divel.data('blankpara'))
                    divel.append($('<span>', { 'class':'BlankLineSpan' }).text(' '));
                continue;
            }
            if (divel.data('blankpara')) {
                divel.data('blankpara', false);
                divel.removeClass('BlankPara');
                divel.empty();
            }
            for (let sx=0; sx<content.length; sx++) {
                const rdesc = content[sx];
                let rstyle, rtext, rlink;
                if (jQuery.type(rdesc) === 'object') {
                    if (rdesc.special !== undefined) {
                        if (rdesc.special == 'image') {
                            /* This is not as restrictive as the Glk spec says it should
                               be. Margin-aligned images which do not follow a line
                               break should disappear. This will undoubtedly cause
                               headaches for portability someday. */
                            let imgurl = rdesc.url;
                            if (Blorb && Blorb.get_image_url) {
                                const newurl = Blorb.get_image_url(rdesc.image);
                                if (newurl)
                                    imgurl = newurl;
                            }
                            let el = $('<img>', 
                                       { src:imgurl } );
                            let winmaxwidth = rdesc.winmaxwidth;
                            // null means no limit, undefined means 1.0
                            if (winmaxwidth === undefined)
                                winmaxwidth = 1.0;
                            if (winmaxwidth) {
                                el.css('max-width', percentstr(winmaxwidth));
                            }
                            if (rdesc.widthratio === undefined) {
                                el.attr('width', ''+rdesc.width);
                            }
                            else {
                                el.css('width', percentstr(rdesc.widthratio));
                            }
                            if (rdesc.aspectwidth === undefined || rdesc.aspectheight === undefined) {
                                if (winmaxwidth && rdesc.widthratio === undefined) {
                                    // Special case: we need to define the height as an aspect ratio, because winmaxwidth means proportional scaling.
                                    // (Note that winmaxwidth and rdesc.widthratio should not be used together, so we don't have to worry about that case.)
                                    el.css('aspect-ratio', ratiostr(rdesc.width, rdesc.height));
                                }
                                else {
                                    el.attr('height', ''+rdesc.height);
                                }
                            }
                            else {
                                el.css('aspect-ratio', ratiostr(rdesc.aspectwidth, rdesc.aspectheight));
                            }
                
                            if (rdesc.alttext)
                                el.attr('alt', rdesc.alttext);
                            else
                                el.attr('alt', 'Image '+rdesc.image);
                            switch (rdesc.alignment) {
                            case 'inlineup':
                                el.addClass('ImageInlineUp');
                                break;
                            case 'inlinedown':
                                el.addClass('ImageInlineDown');
                                break;
                            case 'inlinecenter':
                                el.addClass('ImageInlineCenter');
                                break;
                            case 'marginleft':
                                el.addClass('ImageMarginLeft');
                                break;
                            case 'marginright':
                                el.addClass('ImageMarginRight');
                                break;
                            default:
                                el.addClass('ImageInlineUp');
                                break;
                            }
                            if (rdesc.hyperlink != undefined) {
                                const ael = $('<a>',
                                              { 'href': '#', 'class': 'Internal' } );
                                ael.append(el);
                                ael.on('click', build_evhan_hyperlink(win.id, rdesc.hyperlink));
                                el = ael;
                            }
                            divel.append(el);
                            continue;
                        }
                        glkote_log('Unknown special entry in line data: ' + rdesc.special);
                        continue;
                    }
                    rstyle = rdesc.style;
                    rtext = rdesc.text;
                    rlink = rdesc.hyperlink;
                }
                else {
                    rstyle = rdesc;
                    sx++;
                    rtext = content[sx];
                    rlink = undefined;
                }
                const el = $('<span>',
                             { 'class': 'Style_' + rstyle } );
                if (rlink == undefined) {
                    insert_text_detecting(el, rtext);
                }
                else {
                    const ael = $('<a>',
                                  { 'href': '#', 'class': 'Internal' } );
                    ael.text(rtext);
                    ael.on('click', build_evhan_hyperlink(win.id, rlink));
                    el.append(ael);
                }
                divel.append(el);
            }
        }

        /* Trim the scrollback. If there are more than max_buffer_length
           paragraphs, delete some. (It would be better to limit by
           character count, rather than paragraph count. But this is
           easier.) (Yeah, the prev-mark can wind up included in the count --
           and trimmed out. It's only slightly wrong.) */
        const parals = win.frameel.children();
        if (parals.length) {
            const totrim = parals.length - max_buffer_length;
            if (totrim > 0) {
                const offtop = parals.get(totrim).offsetTop;
                win.topunseen -= offtop;
                if (win.topunseen < 0)
                    win.topunseen = 0;
                win.pagefrommark -= offtop;
                if (win.pagefrommark < 0)
                    win.pagefrommark = 0;
                for (let ix=0; ix<totrim; ix++) {
                    $(parals.get(ix)).remove();
                }
            }
        }

        /* Stick the invisible cursor-marker inside (at the end of) the last
           paragraph div. We use this to position the input box. */
        const divel = buffer_last_line(win);
        if (divel) {
            const cursel = $('<span>',
                             { id: dom_prefix+'win'+win.id+'_cursor', 'class': 'InvisibleCursor' } );
            const zwjel = $('<span>', { id: dom_prefix+'win'+win.id+'_curspos', 'class': 'InvisiblePos' });
            zwjel.text(ZWJ); /* zero-width but not totally collapsed */
            cursel.append(zwjel);
            divel.append(cursel);

            if (win.inputel) {
                /* Put back the inputel that we found earlier. */
                /* NOTE: Currently we never get here, or at least we don't
                   in normal IF play. The accept_inputcancel() stage will
                   always remove inputel entirely. */
                const inputel = win.inputel;
                /* See discussion in accept_inputset(). */
                const posleft = $('#'+dom_prefix+'win'+win.id+'_curspos', dom_context).offset().left - win.frameel.offset().left;
                const width = win.frameel.width() - (current_metrics.buffermarginx + posleft + 2);
                if (width < inputel_minwidth) {
                    inputel.css({ width: inputel_minwidth+'px',
                                  position: '',
                                  left: '', top: '', });
                }
                else {
                    inputel.css({ width: width+'px',
                                  position: 'absolute',
                                  left: '0px', top: '0px', });
                }
                cursel.append(inputel);
            }
        }
    }

    if (win.type == 'graphics') {
        /* Perform the requested draw operations. */
        let draw = arg.draw;
        
        /* Accept a missing draw field as doing nothing. */
        if (draw === undefined)
            draw = [];

        /* Unfortunately, image-draw actions might take some time (if the image
           data is not cached). So we can't do this with a simple synchronous loop.
           Instead, we must add drawing ops to a queue, and then have a function
           callback that executes them. (It's a global queue, not per-window.)
           
           We assume that if the queue is nonempty, a callback is already waiting
           out there, so we don't have to set it up.
        */

        const docall = (graphics_draw_queue.length == 0);
        for (let ix=0; ix<draw.length; ix++) {
            const op = draw[ix];
            /* We'll be paranoid and clone the op object, throwing in a window
               number. */
            const newop = { winid:win.id };
            Object.assign(newop, op);
            graphics_draw_queue.push(newop);
        }
        if (docall && graphics_draw_queue.length > 0) {
            perform_graphics_ops(null);
        }
    }
}

/* Handle all necessary removal of input fields.

   A field needs to be removed if it is not listed in the input argument,
   *or* if it is listed with a later generation number than we remember.
   (The latter case means that input was cancelled and restarted.
   TODO: Is that true? Seems to happen always.)
*/
function accept_inputcancel(arg) {
    const hasinput = {};
    for (const argi of arg) {
        if (argi.type)
            hasinput[argi.id] = argi;
    }

    for (const win of windowdic.values()) {
        if (win.input) {
            const argi = hasinput[win.id];
            if (argi == null || argi.gen > win.input.gen) {
                /* cancel this input. */
                win.input = null;
                win.frameel.addClass('HasNoInputField');
                win.frameel.removeClass('HasInputField');
                if (win.inputel) {
                    win.inputel.remove();
                    win.inputel = null;
                }
            }
        }
    }
}

/* Handle all necessary creation of input fields. Also, if a field needs
   to change position, move it.
*/
function accept_inputset(arg) {
    const hasinput = {};
    const hashyperlink = {};
    const hasmouse = {};
    for (const argi of arg) {
        if (argi.type)
            hasinput[argi.id] = argi;
        if (argi.hyperlink)
            hashyperlink[argi.id] = true;
        if (argi.mouse)
            hasmouse[argi.id] = true;
    }

    for (const win of windowdic.values()) {
        win.reqhyperlink = hashyperlink[win.id];
        win.reqmouse = hasmouse[win.id];

        const argi = hasinput[win.id];
        if (argi == null)
            continue;
        win.input = argi;
        win.frameel.addClass('HasInputField');
        win.frameel.removeClass('HasNoInputField');

        /* Maximum number of characters to accept. */
        let maxlen = 1;
        if (argi.type == 'line')
            maxlen = argi.maxlen;

        /* We're only going to emplace the inputel when it's freshly created. If it's lingering from a previous input, we leave it in place in the DOM. This *should* reduce soft-keyboard flashing problems without screwing up the DOM semantics. */
        let newinputel = false;
        let inputel = win.inputel;
        
        if (inputel == null) {
            newinputel = true;
            let classes = 'Input';
            if (argi.type == 'line') {
                classes += ' LineInput';
            }
            else if (argi.type == 'char') {
                classes += ' CharInput';
            }
            else {
                glkote_error('Window ' + win.id + ' has requested unrecognized input type ' + argi.type + '.');
            }
            inputel = $('<input>',
                        { id: dom_prefix+'win'+win.id+'_input',
                          'class': classes, type: 'text', maxlength: maxlen });
            if (is_mobile) {
                if (maxlen < 3)
                    inputel.attr('placeholder', '\u2316');
                else
                    inputel.attr('placeholder', localize('glkote_taphere'));
            }
            inputel.attr({
                'aria-live': 'off',
                'autocapitalize': 'off',
            });
            if (argi.type == 'line') {
                inputel.on('keypress', evhan_input_keypress);
                inputel.on('keydown', evhan_input_keydown);
                if (argi.initial)
                    inputel.val(argi.initial);
                win.terminators = {};
                if (argi.terminators) {
                    for (let ix=0; ix<argi.terminators.length; ix++) 
                        win.terminators[argi.terminators[ix]] = true;
                }
            }
            else if (argi.type == 'char') {
                inputel.on('keypress', evhan_input_char_keypress);
                inputel.on('keydown', evhan_input_char_keydown);
                inputel.on('input', evhan_input_char_input);
            }
            inputel.on('focus', win.id, evhan_input_focus);
            //inputel.on('blur', win.id, evhan_input_blur); // Currently has no effect
            inputel.data('winid', win.id);
            win.inputel = inputel;
            win.historypos = win.history.length;
            win.needscroll = true;
        }

        if (win.type == 'grid') {
            const lineel = $('#'+dom_prefix+'win'+win.id+'_ln'+argi.ypos, dom_context);
            if (!lineel.length) {
                glkote_error('Window ' + win.id + ' has requested input at unknown line ' + argi.ypos + '.');
                return;
            }
            const pos = lineel.position();
            const xpos = pos.left + Math.round(argi.xpos * current_metrics.gridcharwidth);
            let width = Math.round(maxlen * current_metrics.gridcharwidth);
            /* This calculation is antsy. See below. (But grid window line input
               is rare in IF.) */
            const maxwidth = win.frameel.width() - (current_metrics.buffermarginx + xpos + 2);
            if (width > maxwidth)
                width = maxwidth;
            inputel.css({ position: 'absolute',
                          left: xpos+'px', top: pos.top+'px', width: width+'px' });
            if (newinputel)
                win.frameel.append(inputel);
        }

        if (win.type == 'buffer') {
            let cursel = $('#'+dom_prefix+'win'+win.id+'_cursor', dom_context);
            /* Check to make sure an InvisibleCursor exists on the last line.
               The only reason it might not is if the window is entirely blank
               (no lines). In that case, append one to the window frame
               itself. */
            if (!cursel.length) {
                cursel = $('<span>',
                           { id: dom_prefix+'win'+win.id+'_cursor', 'class': 'InvisibleCursor' } );
                const zwjel = $('<span>', { id: dom_prefix+'win'+win.id+'_curspos', 'class': 'InvisiblePos' });
                zwjel.text(ZWJ); /* zero-width but not totally collapsed */
                cursel.append(zwjel);
                win.frameel.append(cursel);
            }
            /* Now we check how much free space we have to the right of the
               prompt.
               
               Why? Normally we want the input element to be absolutely
               positioned in its line, running to the right margin.
               (We recompute the width on every rearrange event, so adapting
               to geometry changes is no problem.) But if the prompt
               happens to be long, we'd rather let the input line wrap,
               in which case it *shouldn't* be absolutely positioned.)
               (Maybe we should use a hard <br> rather than relying on
               wrapping? Well, this works for the moment.)

               The free-space calculation is a bit messy. We rely on a
               zero-width span which sit *before* the input element
               (and thus doesn't wrap). We check its offset (relative to
               the frame) and then subtract from the total width.
               (We're conservative about this, excluding every possible
               margin.)
             */
            const posleft = $('#'+dom_prefix+'win'+win.id+'_curspos', dom_context).offset().left - win.frameel.offset().left;
            const width = win.frameel.width() - (current_metrics.buffermarginx + posleft + 2);
            if (width < inputel_minwidth) {
                inputel.css({ width: inputel_minwidth+'px',
                              position: '',
                              left: '', top: '', });
            }
            else {
                inputel.css({ width: width+'px',
                              position: 'absolute',
                              left: '0px', top: '0px', });
            }
            if (newinputel)
                cursel.append(inputel);
        }
    }
}

/* Handle the change in the timer request. The argument is either null
   (cancel the timer) or a positive value in milliseconds (reset and restart
   the timer with that interval).
*/
function accept_timerrequest(arg) {
    /* Cancel timer, if there is one. Note that if the game passes us a
       timer value equal to our current interval, we will still reset and
       restart the timer. */
    if (request_timer) {
        window.clearTimeout(request_timer);
        request_timer = null;
        request_timer_interval = null;
    }

    if (!arg) {
        /* No new timer. */
    }
    else {
        /* Start a new timer. */
        request_timer_interval = arg;
        request_timer = window.setTimeout(evhan_timer_event, request_timer_interval);
    }
}

function accept_specialinput(arg) {
    if (arg.type == 'fileref_prompt') {
        let replyfunc = function(ref) {
            send_response('specialresponse', null, 'fileref_prompt', ref);
        };
        try {
            const writable = (arg.filemode != 'read');
            Dialog.open(writable, arg.filetype, arg.gameid, replyfunc);
        }
        catch (ex) {
            GlkOte.log('Unable to open file dialog: ' + ex);
            /* Return a failure. But we don't want to call send_response before
               glkote_update has finished, so we defer the reply slightly. */
            replyfunc = function() {
                send_response('specialresponse', null, 'fileref_prompt', null);
            };
            defer_func(replyfunc);
        }
    }
    else {
        glkote_error('Request for unknown special input type: ' + arg.type);
    }
}

/* Return the element which is the last BufferLine element of the
   window. (jQuery-wrapped.) If none, return null.
*/
function buffer_last_line(win) {
    const divel = last_child_of(win.frameel); /* not wrapped */
    if (divel == null)
        return null;
    /* If the sole child is the PreviousMark, there are no BufferLines. */
    if (divel.className.indexOf('BufferLine') < 0)
        return null;
    return $(divel);
}

/* Return the vertical offset (relative to the parent) of the top of the 
   last child of the parent. We use the raw DOM "offsetTop" property;
   jQuery doesn't have an accessor for it.
   (Possibly broken in MSIE7? It worked in the old version, though.)
*/
function buffer_last_line_top_offset(win) {
    const divel = buffer_last_line(win);
    if (!divel || !divel.length)
        return 0;
    return divel.get(0).offsetTop;
}

/* Set windows_paging_count to the number of windows that need paging.
   If that's nonzero, pick an appropriate window for the paging focus.

   The canfocus flag determines whether this function can jump to an
   input field focus (should paging be complete).

   This must be called whenever a window's needspaging flag changes.
*/
function readjust_paging_focus(canfocus) {
    windows_paging_count = 0;
    let pageable_win = 0;

    if (perform_paging) {
        for (const win of windowdic.values()) {
            if (win.needspaging) {
                windows_paging_count += 1;
                if (!pageable_win || win.id == last_known_paging)
                    pageable_win = win.id;
            }
        }
    }
    
    if (windows_paging_count) {
        /* pageable_win will be set. This is our new paging focus. */
        last_known_paging = pageable_win;
    }

    if (!windows_paging_count && canfocus) {
        /* Time to set the input field focus. This is the same code as in
           the update routine, although somewhat simplified since we don't
           need to worry about the DOM being in flux. */

        let newinputwin = 0;
        if (!disabled && !windows_paging_count) {
            for (const win of windowdic.values()) {
                if (win.input) {
                    if (!newinputwin || win.id == last_known_focus)
                        newinputwin = win.id;
                }
            }
        }
        
        if (newinputwin) {
            const win = windowdic.get(newinputwin);
            if (win.inputel) {
                win.inputel.focus();
            }
        }
    }
}

/* Return the game interface object that was provided to init(). Call
   this if a subsidiary library (e.g., dialog.js) needs to imitate some
   display setting. Do not try to modify the object; it will probably
   not do what you want.
*/
function glkote_get_interface() {
    return game_interface;
}

/* Return the library interface object that we were passed or created.
   Call this if you want to use, e.g., the same Dialog object that GlkOte
   is using.
*/
function glkote_get_library(val) {
    switch (val) {
    case 'Dialog': return Dialog;
    case 'Blorb': return Blorb;
    }
    /* Unrecognized library name. */
    return null;
}

/* Get the DOM element ids used for various standard elements. The argument
   should be one of 'windowport', 'gameport', 'errorpane', 'errorcontent',
   'loadingpane'.
   By default you will get the same string back. However, if a different
   element ID was set in GlkOte's configuration, you'll get that.
*/
function glkote_get_dom_id(val) {
    switch (val) {
    case 'windowport': return windowport_id;
    case 'gameport': return gameport_id;
    case 'errorpane': return errorpane_id;
    case 'errorcontent': return errorcontent_id;
    case 'loadingpane': return loadingpane_id;
    }
    /* Unrecognized id name; just return the same value back. */
    return val;
}

/* Set the DOM context. This is the jQuery element within which all Glk
   DOM elements are looked up. (#gameport, #windowport, etc.)

   In normal usage this is always undefined (meaning, DOM elements are
   searched for within the entire document). This is a fast case;
   jQuery optimizes for it. However, some apps (not Quixe!) want to 
   detach the Glk DOM and maintain it off-screen. That's possible if you 
   set the DOM context to the detached element. I think (although I have
   not tested) that this configuration is less well-optimized.
*/
function glkote_set_dom_context(val) {
    dom_context = val;
}

/* Return the current DOM context. (Normally undefined.)
*/
function glkote_get_dom_context() {
    return dom_context;
}

/* Stash extra information needed for autosave only.
*/
function glkote_save_allstate() {
    const obj = {
        metrics: {
            width: current_metrics.width,
            height: current_metrics.height
        },
        history: {}
    };

    for (const [winid, win] of windowdic.entries()) {
        if (win.history && win.history.length)
            obj.history[winid] = win.history.slice(0);
        if (win.defcolor) {
            if (obj.defcolor === undefined)
                obj.defcolor = {};
            obj.defcolor[winid] = win.defcolor;
        }
    }

    if (recording && recording_state) {
        obj.recording_sessionid = recording_state.sessionId;
    }
    
    return obj;
}

/* Log the message in the browser's error log, if it has one. (This shows
   up in Safari, in Opera, and in Firefox if you have Firebug installed.)
*/
function glkote_log(msg) {
    if (window.console && console.log)
        console.log(msg);
    else if (window.opera && opera.postError)
        opera.postError(msg);
}

/* Display the red error pane, with a message in it. This is called on
   fatal errors.

   Deliberately does not use any jQuery functionality, because this
   is called when jQuery couldn't be loaded.
*/
function glkote_error(msg) {
    if (!msg)
        msg = '???';

    let el = document.getElementById(errorcontent_id);
    if (!el) return;
    
    remove_children(el);
    el.appendChild(document.createTextNode(msg));

    el = document.getElementById(errorpane_id);
    if (el.className == 'WarningPane')
        el.className = null;
    el.style.display = '';   /* el.show() */
    error_visible = true;

    hide_loading();
}

/* Displays a blue warning pane, with a message in it.

   Unlike glkote_error, a warning can be removed (call glkote_warning with
   no argument). The warning pane is intrusive, so it should be used for
   for conditions that interrupt or suspend normal play. An error overrides
   a warning.

   (Quixe uses this to display an "end of session" message.)
*/
function glkote_warning(msg) {
    if (error_visible)
        return;

    if (!msg) {
        $('#'+errorpane_id).hide();
        return;
    }

    const el = document.getElementById(errorcontent_id);
    if (!el) return;

    remove_children(el);
    el.appendChild(document.createTextNode(msg));

    $('#'+errorpane_id).addClass('WarningPane');
    $('#'+errorpane_id).show();
    hide_loading();
}

/* Cause an immediate input event, of type "external". This invokes
   Game.accept(), just like any other event.
*/
function glkote_extevent(val) {
    send_response('external', null, val);
}

/* If we got a 'retry' result from the game, we wait a bit and then call
   this function to try it again.
*/
function retry_update() {
    retry_timer = null;
    glkote_log('Retrying update...');

    send_response('refresh', null, null);
}

/* Convert a JS number to a CSS-style percentage. */
function percentstr(num) {
    /* Return N*100 to two decimal places. But if it came out as an integer, great. */
    let val = '' + (num * 100);
    if (val == 'NaN') {
        console.log('bad value in percentstr', num);
        return '';
    }
    let pos = val.indexOf('.');
    if (pos >= 0)
        val = val.slice(0, pos+4);
    return val+'%';
}

/* Convert a pair of JS numbers to a CSS-style ratio. Both must be nonzero. */
function ratiostr(wid, hgt) {
    if (!wid || !hgt) {
        console.log('bad value in ratiostr', wid, hgt);
        return '';
    }
    return ''+wid+'/'+hgt;
}
    
/* Hide the loading pane (the spinny compass), if it hasn't already been
   hidden.

   Deliberately does not use any jQuery functionality.
*/
function hide_loading() {
    if (loading_visible == false)
        return;
    loading_visible = false;

    const el = document.getElementById(loadingpane_id);
    if (el) {
        el.style.display = 'none';  /* el.hide() */
    }
}

/* Show the loading pane (the spinny compass), if it isn't already visible.

   Deliberately does not use any jQuery functionality.
*/
function show_loading() {
    if (loading_visible == true)
        return;
    loading_visible = true;

    const el = document.getElementById(loadingpane_id);
    if (el) {
        el.style.display = '';   /* el.show() */
    }
}

/* Remove all children from a DOM element. (Not a jQuery collection!)

   Deliberately does not use any jQuery functionality.
*/
function remove_children(parent) {
    const ls = parent.childNodes;
    while (ls.length > 0) {
        const obj = ls.item(0);
        parent.removeChild(obj);
    }
}

/* Return the last child element of a DOM element. (Ignoring text nodes.)
   If the element has no element children, this returns null.
   This returns a raw DOM element! Remember to $() it if you want to pass
   it to jquery.
*/
function last_child_of(obj) {
    const ls = obj.children();
    if (!ls || !ls.length)
        return null;
    return ls.get(ls.length-1);
}

/* Add text to a DOM element. If GlkOte is configured to detect URLs,
   this does that, converting them into 
   <a href='...' class='External' target='_blank'> tags.
   
   This requires calls to document.createTextNode, because jQuery doesn't
   have a notion of appending literal text. I swear...
*/
function insert_text_detecting(el, val) {
    if (!detect_external_links) {
        el.append(document.createTextNode(val));
        return;
    }

    if (detect_external_links == 'match') {
        /* For 'match', we test the entire span of text to see if it's a URL.
           This is simple and fast. */
        if (regex_external_links.test(val)) {
            const ael = $('<a>',
                          { 'href': val, 'class': 'External', 'target': '_blank' } );
            ael.text(val);
            el.append(ael);
            return;
        }
        /* If not, fall through. */
    }
    else if (detect_external_links == 'search') {
        /* For 'search', we have to look for a URL within the span -- perhaps
           multiple URLs. This is more work, and the regex is more complicated
           too. */
        while (true) {
            const match = regex_external_links.exec(val);
            if (!match)
                break;
            /* Add the characters before the URL, if any. */
            if (match.index > 0) {
                const prefix = val.substring(0, match.index);
                el.append(document.createTextNode(prefix));
            }
            /* Add the URL. */
            const ael = $('<a>',
                          { 'href': match[0], 'class': 'External', 'target': '_blank' } );
            ael.text(match[0]);
            el.append(ael);
            /* Continue searching after the URL. */
            val = val.substring(match.index + match[0].length);
        }
        if (!val.length)
            return;
        /* Add the final string of characters, if there were any. */
    }

    /* Fall-through case. Just add the text. */
    el.append(document.createTextNode(val));
}

/* Get the CanvasRenderingContext2D from a canvas element. 
*/
function canvas_get_2dcontext(canvasel) {
    if (!canvasel || !canvasel.length)
        return undefined;
    const canvas = canvasel.get(0);
    if (canvas && canvas.getContext) {
        return canvas.getContext('2d');
    }
    return undefined;
}

/* This is responsible for drawing the queue of graphics operations.
   It will do simple fills synchronously, but image draws must be
   handled in a callback (because the image data might need to be pulled
   from the server).

   If the loadedimg argument is null, this was called to take care of
   new drawing ops. On an image draw, we call back here with loadedimg
   as the Image DOM object that succeeded (or failed).
*/
function perform_graphics_ops(loadedimg, loadedev) {
    if (graphics_draw_queue.length == 0) {
        glkote_log('perform_graphics_ops called with no queued ops' + (loadedimg ? ' (plus image!)' : ''));
        return;
    }

    /* Look at the first queue entry, execute it, and then shift it off.
       On error we must be sure to shift anyway, or the queue will jam!
       Note that if loadedimg is not null, the first queue entry should
       be a matching 'image' draw. */

    while (graphics_draw_queue.length) {
        const op = graphics_draw_queue[0];
        const win = windowdic.get(op.winid);
        if (!win) {
            glkote_log('perform_graphics_ops: op for nonexistent window ' + op.winid);
            graphics_draw_queue.shift();
            continue;
        }

        const el = $('#'+dom_prefix+'win'+win.id+'_canvas', dom_context);
        const ctx = canvas_get_2dcontext(el);
        if (!ctx) {
            glkote_log('perform_graphics_ops: op for nonexistent canvas ' + win.id);
            graphics_draw_queue.shift();
            continue;
        }

        const optype = op.special;
        
        switch (optype) {
        case 'setcolor':
            /* Set the default color (no visible changes). */
            win.defcolor = op.color;
            break;
        case 'fill':
            /* Both color and geometry are optional here. */
            if (op.color === undefined)
                ctx.fillStyle = win.defcolor;
            else
                ctx.fillStyle = op.color;
            if (op.x === undefined) {
                /* Fill the whole canvas frame. Also set the background color,
                   so that future window resizes look nice. */
                ctx.fillRect(0, 0, win.graphwidth, win.graphheight);
                win.frameel.css('background-color', ctx.fillStyle);
            }
            else {
                ctx.fillRect(op.x, op.y, op.width, op.height);
            }
            ctx.fillStyle = '#000000';
            break;
        case 'image':
            /* This is the tricky case. If this is a successful load callback,
               loadedimg already contains the desired image. If it doesn't, we
               check the cache. If that doesn't have it, we have to create a new
               Image and set up the loading callbacks. */
            const cachekey = (op.url || op.image);
            if (!loadedimg) {
                const oldimg = image_cache[cachekey];
                if (oldimg && oldimg.width > 0 && oldimg.height > 0) {
                    loadedimg = oldimg;
                    loadedev = true;
                }
                else {
                    /* This cached image is broken. I don't know if this can happen,
                       but if it does, drop it. */
                    delete image_cache[cachekey];
                }
            }
            if (!loadedimg) {
                let imgurl = op.url;
                if (Blorb && Blorb.get_image_url) {
                    const newurl = Blorb.get_image_url(op.image);
                    if (newurl)
                        imgurl = newurl;
                }
                const newimg = new Image();
                $(newimg).on('load', function(ev) { perform_graphics_ops(newimg, ev); });
                $(newimg).on('error', function() { perform_graphics_ops(newimg, null); });
                /* Setting the src attribute will trigger one of the above
                   callbacks. */
                newimg.src = imgurl;
                return;
            }
            /* We were called back with an image. Hopefully it loaded ok. Note that
               for the error callback, loadedev is null. */
            if (loadedev) {
                image_cache[cachekey] = loadedimg;
                ctx.drawImage(loadedimg, op.x, op.y, op.width, op.height);
            }
            loadedev = null;
            loadedimg = null;
            /* Either way, continue with the queue. */
            break;
        default:
            glkote_log('Unknown special entry in graphics content: ' + optype);
            break;
        }

        graphics_draw_queue.shift();
    }
}

/* Run a function (no arguments) in timeout seconds. */
function delay_func(timeout, func)
{
    return window.setTimeout(func, timeout*1000);
}

/* Run a function (no arguments) "soon". */
function defer_func(func)
{
    return window.setTimeout(func, 0.01*1000);
}

/* Add a line to the window's command history, and then submit it to
   the game. (This is a utility function used by various keyboard input
   handlers.)
*/
function submit_line_input(win, val, termkey) {
    let historylast = null;
    if (win.history.length)
        historylast = win.history[win.history.length-1];

    /* Store this input in the command history for this window, unless
       the input is blank or a duplicate. */
    if (val && val != historylast) {
        win.history.push(val);
        if (win.history.length > 20) {
            /* Don't keep more than twenty entries. */
            win.history.shift();
        }
    }

    send_response('line', win, val, termkey);
}

/* Invoke the game interface's accept() method, passing along an input
   event, and also including all the information about incomplete line
   inputs.

   This is called by each event handler that can signal a completed input
   event.

   The val and val2 arguments are only used by certain event types, which
   is why most of the invocations pass three arguments instead of four.
*/
function send_response(type, win, val, val2) {
    if (disabled && type != 'specialresponse')
        return;

    if (generation <= generation_sent
        && !(type == 'init' || type == 'refresh')) {
        glkote_log('Not sending repeated generation number: ' + generation);
        return;
    }

    let winid = 0;
    if (win)
        winid = win.id;
    const res = { type: type, gen: generation };
    generation_sent = generation;

    if (type == 'line') {
        res.window = win.id;
        res.value = val;
        if (val2)
            res.terminator = val2;
    }
    else if (type == 'char') {
        res.window = win.id;
        res.value = val;
    }
    else if (type == 'hyperlink') {
        res.window = win.id;
        res.value = val;
    }
    else if (type == 'mouse') {
        res.window = win.id;
        res.x = val;
        res.y = val2;
    }
    else if (type == 'external') {
        res.value = val;
    }
    else if (type == 'specialresponse') {
        res.response = val;
        res.value = val2;
    }
    else if (type == 'debuginput') {
        res.value = val;
    }
    else if (type == 'redraw') {
        res.window = win.id;
    }
    else if (type == 'init') {
        res.metrics = val;
        res.support = ['timer', 'graphics', 'graphicswin', 'graphicsext', 'hyperlinks'];
    }
    else if (type == 'arrange') {
        res.metrics = val;
    }

    /* Save partial inputs, unless this is an event which disables
       or ignores the UI. */
    if (!(type == 'init' || type == 'refresh'
          || type == 'specialresponse' || type == 'debuginput')) {
        for (const win of windowdic.values()) {
            const savepartial = (type != 'line' && type != 'char') 
                  || (win.id != winid);
            if (savepartial && win.input && win.input.type == 'line'
                && win.inputel && win.inputel.val()) {
                let partial = res.partial;
                if (!partial) {
                    partial = {};
                    res.partial = partial;
                }
                partial[win.id] = win.inputel.val();
            }
        }
    }

    if (recording) {
        recording_state.input = res;
        recording_state.timestamp = (new Date().getTime());
    }

    game_interface.accept(res);
}

/* ---------------------------------------------- */

/* Default localization strings (English).
   Note that keys are namespaced. A given map may be shared between
   GlkOte, Dialog, Quixe, etc. */
const localization_basemap = {
    glkote_more: 'More',
    glkote_taphere: 'Tap here to type',
};

/* Localize a key using the provided localization map or the default
   value. */
function localize(key) {
    let val = localization_map[key];
    if (val)
        return val;
    val = localization_basemap[key];
    if (val)
        return val;
    return key;
}
    
/* Take apart the query string of the current URL, and turn it into
   an object map.
   (Adapted from querystring.js by Adam Vandenberg.)
*/
function get_query_params() {
    var map = {};

    var qs = location.search.substring(1, location.search.length);
    if (qs.length) {
        var args = qs.split('&');

        qs = qs.replace(/\+/g, ' ');
        for (var ix = 0; ix < args.length; ix++) {
            var pair = args[ix].split('=');
            var name = decodeURIComponent(pair[0]);
            
            var value = (pair.length==2)
                ? decodeURIComponent(pair[1])
                : name;
            
            map[name] = value;
        }
    }

    return map;
}

/* This is called every time the game updates the screen state. It
   wraps up the update with the most recent input event and sends them
   off to whatever is handling transcript recordings.
*/
function recording_send(arg) {
    recording_state.output = arg;
    recording_state.outtimestamp = (new Date().getTime());

    let send = true;

    /* If the format is not "glkote", we should massage state.input and
       state.output. (Or set send=false to skip this update entirely.) */
    if (recording_state.format == 'simple') {
        const input = recording_state.input;
        const output = recording_state.output;

        let inputtype = null;
        if (input)
            inputtype = input.type;

        if (inputtype == 'line' || inputtype == 'char') {
            recording_state.input = input.value;
        }
        else if (inputtype == 'init' || inputtype == 'external' || inputtype == 'specialresponse' || !inputtype) {
            recording_state.input = '';
        }
        else {
            /* Do not send 'arrange' or 'redraw' events. */
            send = false;
        }

        /* We keep track of which windows are buffer windows. */
        if (output.windows) {
            recording_context.bufferwins = {};
            for (let ix=0; ix<output.windows.length; ix++) {
                if (output.windows[ix].type == 'buffer')
                    recording_context.bufferwins[output.windows[ix].id] = true;
            }
        }

        /* Accumulate all the text that's sent to buffer windows. */
        let buffer = '';

        if (output.content) {
            for (let ix=0; ix<output.content.length; ix++) {
                const content = output.content[ix];
                if (recording_context.bufferwins && recording_context.bufferwins[content.id]) {
                    if (content.text) {
                        for (let jx=0; jx<content.text.length; jx++) {
                            const text = content.text[jx];
                            if (!text.append)
                                buffer = buffer + '\n';
                            if (text.content) {
                                for (let kx=0; kx<text.content.length; kx++) {
                                    const el = text.content[kx];
                                    /* Why did I allow the LINE_DATA_ARRAY to have two
                                       possible formats? Sigh */
                                    if (jQuery.type(el) == 'string') {
                                        kx++;
                                        buffer = buffer + text.content[kx];
                                    }
                                    else {
                                        if (el.text)
                                            buffer = buffer + el.text;
                                    }
                                }
                            }
                        }
                    }
                }
            }      
        }

        recording_state.output = buffer;
    }


    if (send)
        recording_handler(recording_state);

    recording_state.input = null;
    recording_state.output = null;
    recording_state.timestamp = 0;
    recording_state.outtimestamp = 0;
}

/* Send a wrapped-up state off to an AJAX handler. The state is a JSONable
   object containing input, output, and timestamps. The format of the input
   and output depends on the recording parameters.

   (The timestamp field refers to the input time, which is what you generally
   care about. The outtimestamp will nearly always follow very closely. If
   there's a long gap, you know your game has spent a long time computing.)

   If the AJAX request returns an error, this shuts off recording (rather
   than trying again for future commands).
*/
function recording_standard_handler(state) {
    jQuery.ajax(recording_handler_url, {
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(state),
        error: function(jqxhr, textstatus, errorthrown) {
            glkote_log('Transcript recording failed; deactivating. Error ' + textstatus + ': ' + errorthrown);
            recording = false;
        }
    } );
}

/* ---------------------------------------------- */

/* DOM event handlers. */

/* Detect the browser window being resized.

   This event is triggered by several causes:

   - A real window DOM resize event. (This should include "make font
   bigger/smaller".)
   - Autorestore. (The window might be a different size than the autosave
   data expects, so we trigger this.)
   - The magic gameport resize sensor created in create_resize_sensor().
*/
function evhan_doc_resize() {
    /* We don't want to send a whole flurry of these events, just because
       the user is dragging the window-size around. So we set up a short
       timer, and don't do anything until the flurry has calmed down. */

    if (resize_timer != null) {
        window.clearTimeout(resize_timer);
        resize_timer = null;
    }

    resize_timer = delay_func(0.20, doc_resize_real);
}

/* This executes when no new resize events have come along in the past
   0.20 seconds. (But if the UI is disabled, we delay again, because
   the game can't deal with events yet.)

   Note that this sends a Glk "arrange" event, not a "redraw" event.
   Those will follow soon if needed.

   (What actually happens, and I apologize for this, is that the
   "arrange" event causes the game to send new window sizes. The
   accept handler sees a size change for a graphics window and queues
   up a "redraw" event via send_window_redraw.)

   ### We really should distinguish between disabling the UI (delay
   resize events) from shutting down the UI (ignore resize events).
*/
function doc_resize_real() {
    resize_timer = null;

    if (disabled) {
        resize_timer = delay_func(0.20, doc_resize_real);
        return;
    }

    const new_metrics = measure_window();
    if (metrics_match(new_metrics, current_metrics)) {
        /* If the metrics haven't changed, skip the arrange event. Necessary
           on mobile webkit, where the keyboard popping up and down causes
           a same-size resize event.
           (Not true any more given the evhan_viewport_resize() handler
           below. But it's still a good optimization.) */
        return;
    }
    current_metrics = new_metrics;
    send_response('arrange', null, current_metrics);
}

/* Detect the *viewport* being resized, which typically means an
   on-screen keyboard has opened or closed.
   
   (We only set up this handler if is_mobile is set. It is an
   unwarranted assumption that only mobile devices have on-screen
   keyboards! But there's a lot of weird fudging in here. For the time
   being, we only do it if necessary, and "necessary" means mobile
   browsers, close enough.)

   The logic here started as the metrics.ts code (curiousdannii/asyncglk),
   but it's evolved quite a bit based on iOS testing.

   It would be better all around to rely on the viewport meta tag
   "interactive-widget=resizes-content". However, as mid-2024, that
   is Chrome-only (and I think Chrome defaults to "resizes-content"
   anyhow).
*/
function evhan_viewport_resize() {
    if ((visualViewport.scale - 1) > 0.001) {
        /* We've pinch-zoomed in. The visualViewport will represent the
           zoomed-in region, so we can't learn anything useful about the
           keyboard from it. Bail; we'll adjust if the scale ever
           returns to 1.0. */
        return;
    }

    /* Dannii's AsyncGlk code has an iOS 15.0 workaround here, but that bug
       was only extant for a couple of months in fall 2021. */

    /* Only react to visualViewport.height changes... */
    if (current_viewportheight == visualViewport.height) {
        return;
    }

    current_viewportheight = visualViewport.height;

    /* Adjust the top of the gameport so that its height matches the
       viewport height. We are keeping the bottom fixed because iOS
       Safari really wants the content to be bottom-aligned. (If
       we fix the top and shorten the height, Safari persistently scrolls
       down so that the blank space below is visible.)

       We are assuming that the gameport either takes up the full window
       or it has fixed top and bottom margins. (See orig_gameport_margins,
       calculated at startup.) If the page layout is more dynamic than
       that, this will fail.

       Any top margin (navbar, etc) will be hidden once the keyboard is up.
       This is an unfortunate consequence of the bottom-aligned scheme; the
       top margin gets shifted up out of sight.
    */

    /* Ignore tiny height changes. */
    const gameport = $('#'+gameport_id, dom_context);
    const oldheight = gameport.outerHeight();
    let newtop = ($(window).height() - current_viewportheight);
    if (newtop < orig_gameport_margins.top)
        newtop = orig_gameport_margins.top;
    const newreltop = newtop - orig_gameport_margins.parenttop;
    const newheight = $(window).height() - (newtop + orig_gameport_margins.bottom);

    /* Do not react to tiny height changes... */
    if (oldheight-newheight >= -1 && oldheight-newheight <= 1) {
        return;
    }

    gameport.css('top', newreltop+'px');
    gameport.outerHeight(newheight);

    /* The gameport size change triggers the resize sensor, which takes
     care of scheduling an arrange event. */

    /* Since our content is bottom-aligned, we scroll the window down as
       much as possible. In fact, we do it twice, because Safari
       sometimes likes to scroll to the top for its own annoying
       reasons. */
    window.scrollTo(0, newtop);
    defer_func(function() { window.scrollTo(0, newtop); });
}
    
    
/* Send a "redraw" event for the given (graphics) window. This is triggered
   by the accept handler when it sees a graphics window change size.

   (Not actually an event handler, but I put it down here with
   doc_resize_real.)
*/
function send_window_redraw(winid) {
    const win = windowdic.get(winid);

    /* It's not likely that the window has been deleted since this function
       was queued up. But we'll be paranoid. */
    if (!win || win.type != 'graphics')
        return;

    send_response('redraw', win, null);
}

/* Event handler: the devicePixelRatio has changed. (Really we only get
   this for changes across particular thresholds, but I set up a bunch.)
*/
function evhan_doc_pixelreschange() {
    const ratio = window.devicePixelRatio || 1;
    if (ratio != current_devpixelratio) {
        current_devpixelratio = ratio;
        //glkote_log('devicePixelRatio changed to ' + current_devpixelratio);

        /* If we have any graphics windows, we need to redo their size and
           scale, and then hit them with a redraw event. */
        for (const [winid, win] of windowdic.entries()) {
            if (win.type == 'graphics') {
                const el = $('#'+dom_prefix+'win'+win.id+'_canvas', dom_context);
                win.scaleratio = current_devpixelratio / win.backpixelratio;
                //glkote_log('changed canvas to scale ' + win.scaleratio + ' (device ' + current_devpixelratio + ' / backstore ' + win.backpixelratio + ')');
                const ctx = canvas_get_2dcontext(el);
                el.attr('width', win.graphwidth * win.scaleratio);
                el.attr('height', win.graphheight * win.scaleratio);
                el.css('width', (win.graphwidth + 'px'));
                el.css('height', (win.graphheight + 'px'));
                if (ctx) {
                    /* Set scale to win.scaleratio */
                    ctx.setTransform(win.scaleratio, 0, 0, win.scaleratio, 0, 0);
                    ctx.fillStyle = win.defcolor;
                    ctx.fillRect(0, 0, win.graphwidth, win.graphheight);
                    ctx.fillStyle = '#000000';
                }
                win.frameel.css('background-color', win.defcolor);
                /* We have to trigger a redraw event for this window. But we can't do
                   a bunch of them from the same handler. We'll set up a deferred
                   function call. */
                defer_func(function() { send_window_redraw(winid); });
            }  
        }
    }
}

/* Event handler: keypress events on the whole document.

   Move the input focus to whichever window most recently had it.
*/
function evhan_doc_keypress(ev) {
    if (disabled) {
        return;
    }

    let keycode = 0;
    if (ev) keycode = ev.which;

    if (ev.target.tagName.toUpperCase() == 'INPUT') {
        /* If the focus is already on an input field, don't mess with it. */
        return;
    }
    if (ev.target.className.indexOf('CanHaveInputFocus') >= 0) {
        /* If the focus is on an element which insists it's input-like,
           don't mess with that either. This is necessary for input fields
           in shadow DOM and plugins. */
        return;
    }

    if (ev.altKey || ev.metaKey || ev.ctrlKey) {
        /* Don't mess with command key combinations. This is not a perfect
           test, since option-key combos are ordinary (accented) characters
           on Mac keyboards, but it's close enough. */
        return;
    }

    if (windows_paging_count) {
        const win = windowdic.get(last_known_paging);
        if (win) {
            ev.preventDefault();
            const frameel = win.frameel;
            /* Scroll the unseen content to the top. */
            frameel.scrollTop(win.topunseen - current_metrics.buffercharheight);
            const frameheight = frameel.outerHeight();
            win.scrolledtoend = frameel.scrollTop() + frameheight + moreprompt_margin >= frameel.get(0).scrollHeight;
            /* Compute the new topunseen value. */
            const realbottom = buffer_last_line_top_offset(win);
            let newtopunseen = frameel.scrollTop() + frameheight;
            if (newtopunseen > realbottom)
                newtopunseen = realbottom;
            if (win.topunseen < newtopunseen)
                win.topunseen = newtopunseen;
            if (win.needspaging) {
                /* The scroll-down might have cleared needspaging already. But 
                   if not... */
                if (win.scrolledtoend) {
                    win.needspaging = false;
                    const moreel = $('#'+dom_prefix+'win'+win.id+'_moreprompt', dom_context);
                    if (moreel.length)
                        moreel.remove();
                    readjust_paging_focus(true);
                }
            }
            return;
        }
    }

    const win = windowdic.get(last_known_focus);
    if (!win)
        return;
    if (!win.inputel)
        return;

    win.inputel.focus();

    if (win.input.type == 'line') {

        if (keycode == 13) {
            /* Grab the Return/Enter key here. This is the same thing we'd do if
               the input field handler caught it. */
            submit_line_input(win, win.inputel.val(), null);
            /* Safari drops an extra newline into the input field unless we call
               preventDefault() here. */
            ev.preventDefault();
            return;
        }

        if (keycode) {
            /* For normal characters, we fake the normal keypress handling by
               appending the character onto the end of the input field. If we
               didn't call preventDefault() here, Safari would actually do
               the right thing with the keystroke, but Firefox wouldn't. */
            /* This is completely wrong for accented characters (on a Mac
               keyboard), but that's beyond my depth. */
            if (keycode >= 32) {
                const val = String.fromCharCode(keycode);
                win.inputel.val(win.inputel.val() + val);
            }
            ev.preventDefault();
            return;
        }

    }
    else {
        /* In character input, we only grab normal characters. Special keys
           should be left to behave normally (arrow keys scroll the window,
           etc.) (This doesn't work right in Firefox, but it's not disastrously
           wrong.) */
        //### grab arrow keys too? They're common in menus.
        let res = null;
        if (keycode == 13)
            res = 'return';
        else if (keycode == key_codes.KEY_BACKSPACE)
            res = 'delete';
        else if (keycode)
            res = String.fromCharCode(keycode);
        if (res) {
            send_response('char', win, res);
        }
        ev.preventDefault();
        return;
    }
}

/* Event handler: mousedown events on windows.

   Remember which window the user clicked in last, as a hint for setting
   the focus. (Input focus and paging focus are tracked separately.)
*/
function evhan_window_mousedown(ev) {
    const winid = ev.data;
    const win = windowdic.get(winid);
    if (!win)
        return;

    if (win.inputel) {
        last_known_focus = win.id;
    }

    if (win.needspaging)
        last_known_paging = win.id;
    else if (win.inputel)
        last_known_paging = 0;
}

/* Event handler: mouse click events on graphics or grid windows
*/
function evhan_input_mouse_click(ev) {
    const winid = ev.data;
    const win = windowdic.get(winid);
    if (!win)
        return;

    if (ev.button != 0)
        return;
    if (!win.reqmouse)
        return;

    let xpos = 0;
    let ypos = 0;
    if (win.type == 'grid') {
        /* Measure click position relative to the zeroth line of the grid. */
        const lineel = $('#'+dom_prefix+'win'+win.id+'_ln'+0, dom_context);
        if (lineel.length) {
            const linepos = lineel.offset();
            xpos = Math.floor((ev.clientX - linepos.left) / current_metrics.gridcharwidth);
            ypos = Math.floor((ev.clientY - linepos.top) / current_metrics.gridcharheight);
        }
        if (xpos >= win.gridwidth)
            xpos = win.gridwidth-1;
        if (xpos < 0)
            xpos = 0;
        if (ypos >= win.gridheight)
            ypos = win.gridheight-1;
        if (ypos < 0)
            ypos = 0;
    }
    else if (win.type == 'graphics') {
        /* Measure click position relative to the canvas. */
        const canel = $('#'+dom_prefix+'win'+win.id+'_canvas', dom_context);
        if (canel.length) {
            const pos = canel.offset();
            xpos = ev.clientX - pos.left;
            ypos = ev.clientY - pos.top;
        }
        if (xpos >= win.graphwidth)
            xpos = win.graphwidth-1;
        if (xpos < 0)
            xpos = 0;
        if (ypos >= win.graphheight)
            ypos = win.graphheight-1;
        if (ypos < 0)
            ypos = 0;
    }
    else {
        return;
    }

    ev.preventDefault();
    send_response('mouse', win, xpos, ypos);
}

/* Event handler: keydown events on input fields (character input)

   Detect the arrow keys, and a few other special keystrokes, for
   character input. We don't grab *all* keys here, because that would
   include modifier keys (shift, option, etc) -- we don't want to
   count those as character input.
*/
function evhan_input_char_keydown(ev) {
    let keycode = 0;
    if (ev) keycode = ev.keyCode; //### ev.which?
    if (!keycode) return true;

    let res = null;

    /* We don't grab Return/Enter in this function, because Firefox lets
       it go through to the keypress handler (even if we try to block it),
       which results in a double input. */

    switch (keycode) {
    case key_codes.KEY_LEFT:
        res = 'left'; break;
    case key_codes.KEY_RIGHT:
        res = 'right'; break;
    case key_codes.KEY_UP:
        res = 'up'; break;
    case key_codes.KEY_DOWN:
        res = 'down'; break;
    case key_codes.KEY_BACKSPACE:
        res = 'delete'; break;
    case key_codes.KEY_ESC:
        res = 'escape'; break;
    case key_codes.KEY_TAB:
        res = 'tab'; break;
    case key_codes.KEY_PAGEUP:
        res = 'pageup'; break;
    case key_codes.KEY_PAGEDOWN:
        res = 'pagedown'; break;
    case key_codes.KEY_HOME:
        res = 'home'; break;
    case key_codes.KEY_END:
        res = 'end'; break;
    case 112:
        res = 'func1'; break;
    case 113:
        res = 'func2'; break;
    case 114:
        res = 'func3'; break;
    case 115:
        res = 'func4'; break;
    case 116:
        res = 'func5'; break;
    case 117:
        res = 'func6'; break;
    case 118:
        res = 'func7'; break;
    case 119:
        res = 'func8'; break;
    case 120:
        res = 'func9'; break;
    case 121:
        res = 'func10'; break;
    case 122:
        res = 'func11'; break;
    case 123:
        res = 'func12'; break;
    }

    if (res) {
        const winid = $(this).data('winid');
        const win = windowdic.get(winid);
        if (!win || !win.input)
            return true;

        send_response('char', win, res);
        return false;
    }

    return true;
}

/* Event handler: keypress events on input fields (character input)

   Detect all printable characters. (Arrow keys and such don't generate
   a keypress event on all browsers, which is why we grabbed them in
   the keydown handler, above.)
*/
function evhan_input_char_keypress(ev) {
    let keycode = 0;
    if (ev) keycode = ev.which;
    if (!keycode) return false;

    let res;
    if (keycode == 13)
        res = 'return';
    else
        res = String.fromCharCode(keycode);

    const winid = $(this).data('winid');
    const win = windowdic.get(winid);
    if (!win || !win.input)
        return true;

    send_response('char', win, res);
    return false;
}

/* Event handler: input events on input fields (character input)
   The keydown and keypress inputs are unreliable in mobile browsers with
   virtual keyboards. This handler can handle character input for printable
   characters, but not function/arrow keys.
*/
function evhan_input_char_input(ev) {
    const char = ev.target.value[0]
    if (char === '' || char == null) {
        return false;
    }
    var winid = $(this).data('winid');
    var win = windowdic.get(winid);
    if (!win || !win.input) {
        return true;
    }
    ev.target.value = ''
    send_response('char', win, char);
    /* Even though we have emptied the input, Android acts as though it still
       has spaces within it, and won't send backspace keydown events until
       the phantom spaces have all been deleted. Refocusing seems to fix it. */
    if (char === ' ') {
        $(ev.target).trigger('blur').trigger('focus')
    }
    return false;
}

/* Event handler: keydown events on input fields (line input)

   Divert the up and down arrow keys to scroll through the command history
   for this window.
   
   Also divert the page-up/page-down/home/end keys to scroll the pane.
   (Chrome/Safari has this behavior as a default, but Firefox doesn't,
   so we don't rely on it.)
*/
function evhan_input_keydown(ev) {
    let keycode = 0;
    if (ev) keycode = ev.keyCode; //### ev.which?
    if (!keycode) return true;

    if (keycode == key_codes.KEY_UP || keycode == key_codes.KEY_DOWN) {
        const winid = $(this).data('winid');
        const win = windowdic.get(winid);
        if (!win || !win.input)
            return true;

        if (keycode == key_codes.KEY_UP && win.historypos > 0) {
            win.historypos -= 1;
            if (win.historypos < win.history.length)
                this.value = win.history[win.historypos];
            else
                this.value = '';
        }

        if (keycode == key_codes.KEY_DOWN && win.historypos < win.history.length) {
            win.historypos += 1;
            if (win.historypos < win.history.length)
                this.value = win.history[win.historypos];
            else
                this.value = '';
        }

        return false;
    }
    else if (keycode == key_codes.KEY_PAGEDOWN || keycode == key_codes.KEY_PAGEUP || keycode == key_codes.KEY_HOME || keycode == key_codes.KEY_END) {
        const winid = $(this).data('winid');
        const win = windowdic.get(winid);
        if (win) {
            const frameel = win.frameel;
            const frameheight = frameel.outerHeight();
            let newval = 0;
            if (keycode == key_codes.KEY_PAGEDOWN) {
                // Scroll by the window height minus one line.
                newval = frameel.scrollTop() + (frameheight - current_metrics.buffercharheight);
            }
            else if (keycode == key_codes.KEY_PAGEUP) {
                newval = frameel.scrollTop() - (frameheight - current_metrics.buffercharheight);
            }
            else if (keycode == key_codes.KEY_HOME) {
                newval = 0;
            }
            else {
                newval = frameel.get(0).scrollHeight;
            }
            frameel.scrollTop(newval);
            return false;
        }
    }
    else if (terminator_key_values[keycode]) {
        const winid = $(this).data('winid');
        const win = windowdic.get(winid);
        if (!win || !win.input)
            return true;

        if (win.terminators[terminator_key_values[keycode]]) {
            /* This key is listed as a current terminator for this window,
               so we'll submit the line of input. */
            submit_line_input(win, win.inputel.val(), terminator_key_values[keycode]);
            return false;
        }
    }

    return true;
}

/* Event handler: keypress events on input fields (line input)

   Divert the enter/return key to submit a line of input.
*/
function evhan_input_keypress(ev) {
    let keycode = 0;
    if (ev) keycode = ev.which;
    if (!keycode) return true;

    if (keycode == 13) {
        const winid = $(this).data('winid');
        const win = windowdic.get(winid);
        if (!win || !win.input)
            return true;

        submit_line_input(win, this.value, null);
        return false;
    }

    return true;
}

/* Event handler: focus events on input fields

   Notice that the focus has switched to a line/char input field.
*/
function evhan_input_focus(ev) {
    const winid = ev.data;
    const win = windowdic.get(winid);
    if (!win)
        return;

    last_known_focus = winid;
    last_known_paging = winid;
}

/* Event handler: blur events on input fields

   Notice that the focus has switched away from a line/char input field.
   (Currently has no effect, so it's commented out.)
*/
/*function evhan_input_blur(ev) {
    const winid = ev.data;
    const win = windowdic.get(winid);
    if (!win)
        return;
}*/

/* Event handler: scrolling in buffer window 
*/
function evhan_window_scroll(ev) {
    const winid = ev.data;
    const win = windowdic.get(winid);
    if (!win)
        return;

    const frameel = win.frameel;
    const frameheight = frameel.outerHeight();
    
    win.scrolledtoend = frameel.scrollTop() + frameheight + moreprompt_margin >= frameel.get(0).scrollHeight;
    
    if (!win.needspaging)
        return;

    const realbottom = buffer_last_line_top_offset(win);
    let newtopunseen = frameel.scrollTop() + frameheight;
    if (newtopunseen > realbottom)
        newtopunseen = realbottom;
    if (win.topunseen < newtopunseen)
        win.topunseen = newtopunseen;

    if (win.scrolledtoend) {
        win.needspaging = false;
        const moreel = $('#'+dom_prefix+'win'+win.id+'_moreprompt', dom_context);
        if (moreel.length)
            moreel.remove();
        readjust_paging_focus(true);
        return;
    }
}

/* Scroll a buffer window all the way down, removing the MORE prompt.
   This is only used in the autorestore case.
*/
function window_scroll_to_bottom(win) {
    const frameel = win.frameel;

    const frameheight = frameel.outerHeight();
    frameel.scrollTop(frameel.get(0).scrollHeight - frameheight);
    
    win.scrolledtoend = true;

    const realbottom = buffer_last_line_top_offset(win);
    let newtopunseen = frameel.scrollTop() + frameheight;
    if (newtopunseen > realbottom)
        newtopunseen = realbottom;
    if (win.topunseen < newtopunseen)
        win.topunseen = newtopunseen;
    if (win.needspaging) {
        /* The scroll-down might have cleared needspaging already. But 
           if not... */
        if (frameel.scrollTop() + frameheight + moreprompt_margin >= frameel.get(0).scrollHeight) {
            win.needspaging = false;
            const moreel = $('#'+dom_prefix+'win'+win.id+'_moreprompt', dom_context);
            if (moreel.length)
                moreel.remove();
            readjust_paging_focus(true);
        }
    }
}

/* Event handler constructor: report a click on a hyperlink
   (This is a factory that returns an appropriate handler function, for
   stupid Javascript closure reasons.)

   Generate the appropriate event for a hyperlink click. Return false,
   to suppress the default HTML action of hyperlinks.
*/
function build_evhan_hyperlink(winid, linkval) {
    return function() {
        const win = windowdic.get(winid);
        if (!win)
            return false;
        if (!win.reqhyperlink)
            return false;
        send_response('hyperlink', win, linkval);
        return false;
    };
}

/* Event handler for the request_timer timeout that we set in 
   accept_timerrequest().
*/
function evhan_timer_event() {
    if ((!request_timer) || (!request_timer_interval)) {
        /* This callback should have been cancelled before firing, so we
           shouldn't even be here. */
        return;
    }

    /* It's a repeating timer, so set it again. */
    request_timer = window.setTimeout(evhan_timer_event, request_timer_interval);
    
    if (disabled) {
        /* Can't handle the timer while the UI is disabled, so we punt.
           It will fire again someday. */
        return;
    }

    send_response('timer');
}

/* Event handler for the GiDebug command callback. 
*/
function evhan_debug_command(cmd) {
    send_response('debuginput', null, cmd);
}

/* ---------------------------------------------- */

/* End of GlkOte namespace function. Return the object which will
   become the GlkOte global. */
return {
    classname: 'GlkOte',
    version:  '2.3.7',
    init:     glkote_init,
    inited:   glkote_inited,
    update:   glkote_update,
    extevent: glkote_extevent,
    getinterface: glkote_get_interface,
    getlibrary: glkote_get_library,
    getdomid: glkote_get_dom_id,
    getdomcontext: glkote_get_dom_context,
    setdomcontext: glkote_set_dom_context,
    save_allstate : glkote_save_allstate,
    log:      glkote_log,
    warning:  glkote_warning,
    error:    glkote_error
};

};

/* GlkOte is an instance of GlkOteClass, ready to init. */
var GlkOte = new GlkOteClass();

// Node-compatible behavior
try { exports.GlkOte = GlkOte; exports.GlkOteClass = GlkOteClass; } catch (ex) {};

/* End of GlkOte library. */
