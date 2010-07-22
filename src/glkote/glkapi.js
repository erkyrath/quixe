/* GlkAPI -- a Javascript Glk API for IF interfaces
 * Designed by Andrew Plotkin <erkyrath@eblong.com>
 * <http://eblong.com/zarf/glk/glkote.html>
 * 
 * This Javascript library is copyright 2010 by Andrew Plotkin. You may
 * copy and distribute it freely, by any means and under any conditions,
 * as long as the code and documentation is not changed. You may also
 * incorporate this code into your own program and distribute that, or
 * modify this code and use and distribute the modified version, as long
 * as you retain a notice in your program or documentation which mentions
 * my name and the URL shown above.
 *
 * This file is a Glk API compatibility layer for glkote.js. It offers a 
 * set of Javascript calls which closely match the original C Glk API;
 * these work by means of glkote.js operations.
 *
 * This API was built for Quixe, which is a pure-Javascript Glulx
 * interpreter. Therefore, the API is a little strange. Notably, it
 * accepts text buffers in the form of arrays of integers, not
 * Javascript strings. Only the Glk calls that explicitly use strings
 * (glk_put_string, etc) accept Javascript native strings.
 *
 * If you are writing an application in pure Javascript, you can use
 * this layer (along with glkote.js). If you are writing a web app which
 * is the front face of a server-side Glk app, ignore this file -- use
 * glkote.js directly.
 */

/* Known problems:

   Some places in the library get confused about Unicode characters
   beyond 0xFFFF. They are handled correctly by streams, but grid windows
   will think they occupy two characters rather than one, which will
   throw off the grid spacing. 

   Also, the glk_put_jstring() function can't handle them at all. Quixe
   printing operations that funnel through glk_put_jstring() -- meaning, 
   most native string printing -- will break up three-byte characters 
   into a UTF-16-encoded pair of two-byte characters. This will come
   out okay in a buffer window, but it will again mess up grid windows,
   and will also double the write-count in a stream.
*/

/* Put everything inside the Glk namespace. */

Glk = function() {

/* The VM interface object. */
var VM = null;

var has_exited = false;
var ui_disabled = false;
var event_generation = 0;
var current_partial_inputs = null;
var current_partial_outputs = null;

/* Initialize the library, initialize the VM, and set it running. (It will 
   run until the first glk_select() or glk_exit() call.)

   The vm_options argument must have a vm_options.vm field, which must be an
   appropriate VM interface object. (For example, Quixe.) This must have
   init() and resume() methods.

   The vm_options argument is also passed through to GlkOte as the game
   interface object. It can be used to affect some GlkOte display options,
   such as window spacing.

   (You do not need to provide a vm_options.accept() function. The Glk
   library sets that up for you.)
*/
function init(vm_options) {
    VM = vm_options.vm;
    if (window.GiDispa)
        GiDispa.set_vm(VM);

    vm_options.accept = accept_ui_event;

    GlkOte.init(vm_options);
}

function accept_ui_event(obj) {
    var box;

    //qlog("### accept_ui_event: " + obj.type + ", gen " + obj.gen);
    if (ui_disabled) {
        /* We've hit glk_exit() or a VM fatal error, or just blocked the UI for
           some modal dialog. */
        qlog("### ui is disabled, ignoring event");
        return;
    }

    if (obj.gen != event_generation) {
      GlkOte.log('Input event had wrong generation number: got ' + obj.gen + ', currently at ' + event_generation);
      return;
    }
    event_generation += 1;

    /* Note any partial inputs; we'll need them if the game cancels a line
       input. This may be undef. */
    current_partial_inputs = obj.partial;

    switch (obj.type) {
    case 'init':
        content_metrics = obj.metrics;
        VM.init();
        break;

    case 'external':
        if (obj.value == 'timer') {
            handle_timer_input();
        }
        break;

    case 'hyperlink':
        handle_hyperlink_input(obj.window, obj.value);
        break;

    case 'char':
        handle_char_input(obj.window, obj.value);
        break;

    case 'line':
        handle_line_input(obj.window, obj.value);
        break;

    case 'arrange':
        content_metrics = obj.metrics;
        box = {
            left: content_metrics.outspacingx,
            top: content_metrics.outspacingy,
            right: content_metrics.width-content_metrics.outspacingx,
            bottom: content_metrics.height-content_metrics.outspacingy
        };
        if (gli_rootwin)
            gli_window_rearrange(gli_rootwin, box);
        handle_arrange_input();
        break;
    }
}

function handle_arrange_input() {
    if (!gli_selectref)
        return;

    gli_selectref.set_field(0, Const.evtype_Arrange);
    gli_selectref.set_field(1, null);
    gli_selectref.set_field(2, 0);
    gli_selectref.set_field(3, 0);

    if (window.GiDispa)
        GiDispa.prepare_resume(gli_selectref);
    gli_selectref = null;
    VM.resume();
}

function handle_timer_input() {
    if (!gli_selectref)
        return;

    gli_selectref.set_field(0, Const.evtype_Timer);
    gli_selectref.set_field(1, null);
    gli_selectref.set_field(2, 0);
    gli_selectref.set_field(3, 0);

    if (window.GiDispa)
        GiDispa.prepare_resume(gli_selectref);
    gli_selectref = null;
    VM.resume();
}

function handle_hyperlink_input(disprock, val) {
    if (!gli_selectref)
        return;

    var win = null;
    for (win=gli_windowlist; win; win=win.next) {
        if (win.disprock == disprock) 
            break;
    }
    if (!win || !win.hyperlink_request)
        return;

    gli_selectref.set_field(0, Const.evtype_Hyperlink);
    gli_selectref.set_field(1, win);
    gli_selectref.set_field(2, val);
    gli_selectref.set_field(3, 0);

    win.hyperlink_request = false;

    if (window.GiDispa)
        GiDispa.prepare_resume(gli_selectref);
    gli_selectref = null;
    VM.resume();
}

function handle_char_input(disprock, input) {
    var charval;

    if (!gli_selectref)
        return;

    var win = null;
    for (win=gli_windowlist; win; win=win.next) {
        if (win.disprock == disprock) 
            break;
    }
    if (!win || !win.char_request)
        return;

    if (input.length == 1) {
        charval = input.charCodeAt(0);
        if (!win.char_request_uni)
            charval = charval & 0xFF;
    }
    else {
        charval = KeystrokeNameMap[input];
        if (!charval)
            charval = Const.keycode_Unknown;
    }

    gli_selectref.set_field(0, Const.evtype_CharInput);
    gli_selectref.set_field(1, win);
    gli_selectref.set_field(2, charval);
    gli_selectref.set_field(3, 0);

    win.char_request = false;
    win.char_request_uni = false;
    win.input_generation = null;

    if (window.GiDispa)
        GiDispa.prepare_resume(gli_selectref);
    gli_selectref = null;
    VM.resume();
}

function handle_line_input(disprock, input) {
    var ix;

    if (!gli_selectref)
        return;

    var win = null;
    for (win=gli_windowlist; win; win=win.next) {
        if (win.disprock == disprock) 
            break;
    }
    if (!win || !win.line_request)
        return;

    if (input.length > win.linebuf.length)
        input = input.slice(0, win.linebuf.length);

    ix = win.style;
    gli_set_style(win.str, Const.style_Input);
    gli_window_put_string(win, input+"\n");
    if (win.echostr)
        glk_put_jstring_stream(win.echostr, input+"\n");
    gli_set_style(win.str, ix);

    for (ix=0; ix<input.length; ix++)
        win.linebuf[ix] = input.charCodeAt(ix);

    gli_selectref.set_field(0, Const.evtype_LineInput);
    gli_selectref.set_field(1, win);
    gli_selectref.set_field(2, input.length);
    gli_selectref.set_field(3, 0);

    if (window.GiDispa)
        GiDispa.unretain_array(win.linebuf);
    win.line_request = false;
    win.line_request_uni = false;
    win.input_generation = null;
    win.linebuf = null;

    if (window.GiDispa)
        GiDispa.prepare_resume(gli_selectref);
    gli_selectref = null;
    VM.resume();
}

function update() {
    var dataobj = { type: 'update', gen: event_generation };
    var winarray = null;
    var contentarray = null;
    var inputarray = null;
    var win, obj, robj, useobj, lineobj, ls, val, ix, cx;
    var initial, lastpos, laststyle, lasthyperlink;

    if (geometry_changed) {
        geometry_changed = false;
        winarray = [];
        for (win=gli_windowlist; win; win=win.next) {
            if (win.type == Const.wintype_Pair)
                continue;

            obj = { id: win.disprock, rock: win.rock };
            winarray.push(obj);

            switch (win.type) {
            case Const.wintype_TextBuffer:
                obj.type = 'buffer';
                break;
            case Const.wintype_TextGrid:
                obj.type = 'grid';
                obj.gridwidth = win.gridwidth;
                obj.gridheight = win.gridheight;
                break;
            }

            obj.left = win.bbox.left;
            obj.top = win.bbox.top;
            obj.width = win.bbox.right - win.bbox.left;
            obj.height = win.bbox.bottom - win.bbox.top;
        }
    }

    for (win=gli_windowlist; win; win=win.next) {
        useobj = false;
        obj = { id: win.disprock };
        if (contentarray == null)
            contentarray = [];

        switch (win.type) {
        case Const.wintype_TextBuffer:
            gli_window_buffer_deaccumulate(win);
            if (win.content.length) {
                obj.text = win.content.slice(0);
                win.content.length = 0;
                useobj = true;
            }
            if (win.clearcontent) {
                obj.clear = true;
                win.clearcontent = false;
                useobj = true;
                if (!obj.text) {
                    obj.text = [];
                }
            }
            break;
        case Const.wintype_TextGrid:
            if (win.gridwidth == 0 || win.gridheight == 0)
                break;
            obj.lines = [];
            for (ix=0; ix<win.gridheight; ix++) {
                lineobj = win.lines[ix];
                if (!lineobj.dirty)
                    continue;
                lineobj.dirty = false;
                ls = [];
                lastpos = 0;
                for (cx=0; cx<win.gridwidth; ) {
                    laststyle = lineobj.styles[cx];
                    lasthyperlink = lineobj.hyperlinks[cx];
                    for (; cx<win.gridwidth 
                             && lineobj.styles[cx] == laststyle
                             && lineobj.hyperlinks[cx] == lasthyperlink; 
                         cx++) { }
                    if (lastpos < cx) {
                        if (!lasthyperlink) {
                            ls.push(StyleNameMap[laststyle]);
                            ls.push(lineobj.chars.slice(lastpos, cx).join(''));
                        }
                        else {
                            robj = { style:StyleNameMap[laststyle], text:lineobj.chars.slice(lastpos, cx).join(''), hyperlink:lasthyperlink };
                            ls.push(robj);
                        }
                        lastpos = cx;
                    }
                }
                obj.lines.push({ line:ix, content:ls });
            }
            useobj = obj.lines.length;
            break;
        }

        if (useobj)
            contentarray.push(obj);
    }

    inputarray = [];
    for (win=gli_windowlist; win; win=win.next) {
        obj = null;
        if (win.char_request) {
            obj = { id: win.disprock, type: 'char', gen: win.input_generation };
            if (win.type == Const.wintype_TextGrid) {
                gli_window_grid_canonicalize(win);
                obj.xpos = win.cursorx;
                obj.ypos = win.cursory;
            }
        }
        if (win.line_request) {
            initial = '';
            if (current_partial_outputs) {
                val = current_partial_outputs[win.disprock];
                if (val)
                    initial = val;
            }
            obj = { id: win.disprock, type: 'line', gen: win.input_generation,
                    maxlen: win.linebuf.length, initial: initial };
            if (win.type == Const.wintype_TextGrid) {
                gli_window_grid_canonicalize(win);
                obj.xpos = win.cursorx;
                obj.ypos = win.cursory;
            }
        }
        if (win.hyperlink_request) {
            if (!obj)
                obj = { id: win.disprock };
            obj.hyperlink = true;
        }
        if (obj)
            inputarray.push(obj);
    }

    dataobj.windows = winarray;
    dataobj.content = contentarray;
    dataobj.input = inputarray;

    if (ui_disabled) {
        //qlog("### disabling ui");
        dataobj.disable = true;
    }

    /* Clean this up; it's only meaningful within one run/update cycle. */
    current_partial_outputs = null;

    GlkOte.update(dataobj);
}

/* This is the handler for a VM fatal error. (Not for an error in our own
   library!) We display the error message, and then push a final display
   update, which kills all input fields in all windows.
*/
function fatal_error(msg) {
    has_exited = true;
    ui_disabled = true;
    GlkOte.error(msg);
    var dataobj = { type: 'update', gen: event_generation, disable: true };
    dataobj.input = [];
    GlkOte.update(dataobj);
}

/* All the numeric constants used by the Glk interface. We push these into
   an object, for tidiness. */

var Const = {
    gestalt_Version : 0,
    gestalt_CharInput : 1,
    gestalt_LineInput : 2,
    gestalt_CharOutput : 3,
      gestalt_CharOutput_CannotPrint : 0,
      gestalt_CharOutput_ApproxPrint : 1,
      gestalt_CharOutput_ExactPrint : 2,
    gestalt_MouseInput : 4,
    gestalt_Timer : 5,
    gestalt_Graphics : 6,
    gestalt_DrawImage : 7,
    gestalt_Sound : 8,
    gestalt_SoundVolume : 9,
    gestalt_SoundNotify : 10,
    gestalt_Hyperlinks : 11,
    gestalt_HyperlinkInput : 12,
    gestalt_SoundMusic : 13,
    gestalt_GraphicsTransparency : 14,
    gestalt_Unicode : 15,

    keycode_Unknown  : 0xffffffff,
    keycode_Left     : 0xfffffffe,
    keycode_Right    : 0xfffffffd,
    keycode_Up       : 0xfffffffc,
    keycode_Down     : 0xfffffffb,
    keycode_Return   : 0xfffffffa,
    keycode_Delete   : 0xfffffff9,
    keycode_Escape   : 0xfffffff8,
    keycode_Tab      : 0xfffffff7,
    keycode_PageUp   : 0xfffffff6,
    keycode_PageDown : 0xfffffff5,
    keycode_Home     : 0xfffffff4,
    keycode_End      : 0xfffffff3,
    keycode_Func1    : 0xffffffef,
    keycode_Func2    : 0xffffffee,
    keycode_Func3    : 0xffffffed,
    keycode_Func4    : 0xffffffec,
    keycode_Func5    : 0xffffffeb,
    keycode_Func6    : 0xffffffea,
    keycode_Func7    : 0xffffffe9,
    keycode_Func8    : 0xffffffe8,
    keycode_Func9    : 0xffffffe7,
    keycode_Func10   : 0xffffffe6,
    keycode_Func11   : 0xffffffe5,
    keycode_Func12   : 0xffffffe4,
    /* The last keycode is always (0x100000000 - keycode_MAXVAL) */
    keycode_MAXVAL   : 28,

    evtype_None : 0,
    evtype_Timer : 1,
    evtype_CharInput : 2,
    evtype_LineInput : 3,
    evtype_MouseInput : 4,
    evtype_Arrange : 5,
    evtype_Redraw : 6,
    evtype_SoundNotify : 7,
    evtype_Hyperlink : 8,

    style_Normal : 0,
    style_Emphasized : 1,
    style_Preformatted : 2,
    style_Header : 3,
    style_Subheader : 4,
    style_Alert : 5,
    style_Note : 6,
    style_BlockQuote : 7,
    style_Input : 8,
    style_User1 : 9,
    style_User2 : 10,
    style_NUMSTYLES : 11,

    wintype_AllTypes : 0,
    wintype_Pair : 1,
    wintype_Blank : 2,
    wintype_TextBuffer : 3,
    wintype_TextGrid : 4,
    wintype_Graphics : 5,

    winmethod_Left  : 0x00,
    winmethod_Right : 0x01,
    winmethod_Above : 0x02,
    winmethod_Below : 0x03,
    winmethod_DirMask : 0x0f,

    winmethod_Fixed : 0x10,
    winmethod_Proportional : 0x20,
    winmethod_DivisionMask : 0xf0,

    fileusage_Data : 0x00,
    fileusage_SavedGame : 0x01,
    fileusage_Transcript : 0x02,
    fileusage_InputRecord : 0x03,
    fileusage_TypeMask : 0x0f,

    fileusage_TextMode   : 0x100,
    fileusage_BinaryMode : 0x000,

    filemode_Write : 0x01,
    filemode_Read : 0x02,
    filemode_ReadWrite : 0x03,
    filemode_WriteAppend : 0x05,

    seekmode_Start : 0,
    seekmode_Current : 1,
    seekmode_End : 2,

    stylehint_Indentation : 0,
    stylehint_ParaIndentation : 1,
    stylehint_Justification : 2,
    stylehint_Size : 3,
    stylehint_Weight : 4,
    stylehint_Oblique : 5,
    stylehint_Proportional : 6,
    stylehint_TextColor : 7,
    stylehint_BackColor : 8,
    stylehint_ReverseColor : 9,
    stylehint_NUMHINTS : 10,

      stylehint_just_LeftFlush : 0,
      stylehint_just_LeftRight : 1,
      stylehint_just_Centered : 2,
      stylehint_just_RightFlush : 3
};

var KeystrokeNameMap = {
    /* The key values are taken from GlkOte's "char" event. A couple of them
       are Javascript keywords, so they're in quotes, but that doesn't affect
       the final structure. */
    left : Const.keycode_Left,
    right : Const.keycode_Right,
    up : Const.keycode_Up,
    down : Const.keycode_Down,
    'return' : Const.keycode_Return,
    'delete' : Const.keycode_Delete,
    escape : Const.keycode_Escape,
    tab : Const.keycode_Tab,
    pageup : Const.keycode_PageUp,
    pagedown : Const.keycode_PageDown,
    home : Const.keycode_Home,
    end : Const.keycode_End
};

var StyleNameMap = {
    0 : 'normal',
    1 : 'emphasized',
    2 : 'preformatted',
    3 : 'header',
    4 : 'subheader',
    5 : 'alert',
    6 : 'note',
    7 : 'blockquote',
    8 : 'input',
    9 : 'user1',
    10 : 'user2'
};

var FileTypeMap = {
    0: 'data',
    1: 'save',
    2: 'transcript',
    3: 'command'
};

/*### reduce the titlecase table to a diff off of the lowercase table? */

/* These tables were generated by casemap.py. */

/* list all the special cases in unicode_upper_table */
var unicode_upper_table = {
 181: 924,  223: [ 83,83 ],  255: 376,  305: 73,  329: [ 700,78 ],
 383: 83,  405: 502,  414: 544,  447: 503,  454: 452,
 457: 455,  460: 458,  477: 398,  496: [ 74,780 ],  499: 497,
 595: 385,  596: 390,  598: 393,  599: 394,  601: 399,
 603: 400,  608: 403,  611: 404,  616: 407,  617: 406,
 623: 412,  626: 413,  629: 415,  640: 422,  643: 425,
 648: 430,  650: 433,  651: 434,  658: 439,  837: 921,
 912: [ 921,776,769 ],  940: 902,  941: 904,  942: 905,  943: 906,
 944: [ 933,776,769 ],  962: 931,  972: 908,  973: 910,  974: 911,
 976: 914,  977: 920,  981: 934,  982: 928,  1008: 922,
 1010: 1017,  1013: 917,  1415: [ 1333,1362 ],  7830: [ 72,817 ],  7831: [ 84,776 ],
 7832: [ 87,778 ],  7833: [ 89,778 ],  7834: [ 65,702 ],  7835: 7776,  8016: [ 933,787 ],
 8018: [ 933,787,768 ],  8020: [ 933,787,769 ],  8022: [ 933,787,834 ],  8048: 8122,  8049: 8123,
 8050: 8136,  8051: 8137,  8052: 8138,  8053: 8139,  8054: 8154,
 8055: 8155,  8056: 8184,  8057: 8185,  8058: 8170,  8059: 8171,
 8060: 8186,  8061: 8187,  8064: [ 7944,921 ],  8065: [ 7945,921 ],  8066: [ 7946,921 ],
 8067: [ 7947,921 ],  8068: [ 7948,921 ],  8069: [ 7949,921 ],  8070: [ 7950,921 ],  8071: [ 7951,921 ],
 8072: [ 7944,921 ],  8073: [ 7945,921 ],  8074: [ 7946,921 ],  8075: [ 7947,921 ],  8076: [ 7948,921 ],
 8077: [ 7949,921 ],  8078: [ 7950,921 ],  8079: [ 7951,921 ],  8080: [ 7976,921 ],  8081: [ 7977,921 ],
 8082: [ 7978,921 ],  8083: [ 7979,921 ],  8084: [ 7980,921 ],  8085: [ 7981,921 ],  8086: [ 7982,921 ],
 8087: [ 7983,921 ],  8088: [ 7976,921 ],  8089: [ 7977,921 ],  8090: [ 7978,921 ],  8091: [ 7979,921 ],
 8092: [ 7980,921 ],  8093: [ 7981,921 ],  8094: [ 7982,921 ],  8095: [ 7983,921 ],  8096: [ 8040,921 ],
 8097: [ 8041,921 ],  8098: [ 8042,921 ],  8099: [ 8043,921 ],  8100: [ 8044,921 ],  8101: [ 8045,921 ],
 8102: [ 8046,921 ],  8103: [ 8047,921 ],  8104: [ 8040,921 ],  8105: [ 8041,921 ],  8106: [ 8042,921 ],
 8107: [ 8043,921 ],  8108: [ 8044,921 ],  8109: [ 8045,921 ],  8110: [ 8046,921 ],  8111: [ 8047,921 ],
 8114: [ 8122,921 ],  8115: [ 913,921 ],  8116: [ 902,921 ],  8118: [ 913,834 ],  8119: [ 913,834,921 ],
 8124: [ 913,921 ],  8126: 921,  8130: [ 8138,921 ],  8131: [ 919,921 ],  8132: [ 905,921 ],
 8134: [ 919,834 ],  8135: [ 919,834,921 ],  8140: [ 919,921 ],  8146: [ 921,776,768 ],  8147: [ 921,776,769 ],
 8150: [ 921,834 ],  8151: [ 921,776,834 ],  8162: [ 933,776,768 ],  8163: [ 933,776,769 ],  8164: [ 929,787 ],
 8165: 8172,  8166: [ 933,834 ],  8167: [ 933,776,834 ],  8178: [ 8186,921 ],  8179: [ 937,921 ],
 8180: [ 911,921 ],  8182: [ 937,834 ],  8183: [ 937,834,921 ],  8188: [ 937,921 ],  64256: [ 70,70 ],
 64257: [ 70,73 ],  64258: [ 70,76 ],  64259: [ 70,70,73 ],  64260: [ 70,70,76 ],  64261: [ 83,84 ],
 64262: [ 83,84 ],  64275: [ 1348,1350 ],  64276: [ 1348,1333 ],  64277: [ 1348,1339 ],  64278: [ 1358,1350 ],
 64279: [ 1348,1341 ]
};
/* add all the regular cases to unicode_upper_table */
(function() {
  var ls, ix, val;
  ls = [
 7936,  7937,  7938,  7939,  7940,  7941,  7942,  7943,
 7952,  7953,  7954,  7955,  7956,  7957,  7968,  7969,
 7970,  7971,  7972,  7973,  7974,  7975,  7984,  7985,
 7986,  7987,  7988,  7989,  7990,  7991,  8000,  8001,
 8002,  8003,  8004,  8005,  8017,  8019,  8021,  8023,
 8032,  8033,  8034,  8035,  8036,  8037,  8038,  8039,
 8112,  8113,  8144,  8145,  8160,  8161,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_upper_table[val] = val+8;
  }
  for (val=257; val<=303; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  for (val=331; val<=375; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  for (val=505; val<=543; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  for (val=1121; val<=1153; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  for (val=1163; val<=1215; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  for (val=1233; val<=1269; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  for (val=7681; val<=7829; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  for (val=7841; val<=7929; val+=2) {
    unicode_upper_table[val] = val-1;
  }
  ls = [
 307,  309,  311,  314,  316,  318,  320,  322,
 324,  326,  328,  378,  380,  382,  387,  389,
 392,  396,  402,  409,  417,  419,  421,  424,
 429,  432,  436,  438,  441,  445,  453,  456,
 459,  462,  464,  466,  468,  470,  472,  474,
 476,  479,  481,  483,  485,  487,  489,  491,
 493,  495,  498,  501,  547,  549,  551,  553,
 555,  557,  559,  561,  563,  985,  987,  989,
 991,  993,  995,  997,  999,  1001,  1003,  1005,
 1007,  1016,  1019,  1218,  1220,  1222,  1224,  1226,
 1228,  1230,  1273,  1281,  1283,  1285,  1287,  1289,
 1291,  1293,  1295,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_upper_table[val] = val-1;
  }
  for (val=8560; val<=8575; val+=1) {
    unicode_upper_table[val] = val-16;
  }
  for (val=9424; val<=9449; val+=1) {
    unicode_upper_table[val] = val-26;
  }
  for (val=97; val<=122; val+=1) {
    unicode_upper_table[val] = val-32;
  }
  for (val=224; val<=246; val+=1) {
    unicode_upper_table[val] = val-32;
  }
  for (val=945; val<=961; val+=1) {
    unicode_upper_table[val] = val-32;
  }
  for (val=1072; val<=1103; val+=1) {
    unicode_upper_table[val] = val-32;
  }
  for (val=65345; val<=65370; val+=1) {
    unicode_upper_table[val] = val-32;
  }
  ls = [
 248,  249,  250,  251,  252,  253,  254,  963,
 964,  965,  966,  967,  968,  969,  970,  971,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_upper_table[val] = val-32;
  }
  for (val=66600; val<=66639; val+=1) {
    unicode_upper_table[val] = val-40;
  }
  for (val=1377; val<=1414; val+=1) {
    unicode_upper_table[val] = val-48;
  }
  for (val=1104; val<=1119; val+=1) {
    unicode_upper_table[val] = val-80;
  }
  unicode_upper_table[1009] = 929;
})();
/* list all the special cases in unicode_lower_table */
var unicode_lower_table = {
 304: [ 105,775 ],  376: 255,  385: 595,  390: 596,  393: 598,
 394: 599,  398: 477,  399: 601,  400: 603,  403: 608,
 404: 611,  406: 617,  407: 616,  412: 623,  413: 626,
 415: 629,  422: 640,  425: 643,  430: 648,  433: 650,
 434: 651,  439: 658,  452: 454,  455: 457,  458: 460,
 497: 499,  502: 405,  503: 447,  544: 414,  902: 940,
 904: 941,  905: 942,  906: 943,  908: 972,  910: 973,
 911: 974,  1012: 952,  1017: 1010,  8122: 8048,  8123: 8049,
 8124: 8115,  8136: 8050,  8137: 8051,  8138: 8052,  8139: 8053,
 8140: 8131,  8154: 8054,  8155: 8055,  8170: 8058,  8171: 8059,
 8172: 8165,  8184: 8056,  8185: 8057,  8186: 8060,  8187: 8061,
 8188: 8179,  8486: 969,  8490: 107,  8491: 229
};
/* add all the regular cases to unicode_lower_table */
(function() {
  var ls, ix, val;
  for (val=1024; val<=1039; val+=1) {
    unicode_lower_table[val] = val+80;
  }
  for (val=1329; val<=1366; val+=1) {
    unicode_lower_table[val] = val+48;
  }
  for (val=66560; val<=66599; val+=1) {
    unicode_lower_table[val] = val+40;
  }
  for (val=65; val<=90; val+=1) {
    unicode_lower_table[val] = val+32;
  }
  for (val=192; val<=214; val+=1) {
    unicode_lower_table[val] = val+32;
  }
  for (val=913; val<=929; val+=1) {
    unicode_lower_table[val] = val+32;
  }
  for (val=1040; val<=1071; val+=1) {
    unicode_lower_table[val] = val+32;
  }
  for (val=65313; val<=65338; val+=1) {
    unicode_lower_table[val] = val+32;
  }
  ls = [
 216,  217,  218,  219,  220,  221,  222,  931,
 932,  933,  934,  935,  936,  937,  938,  939,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_lower_table[val] = val+32;
  }
  for (val=9398; val<=9423; val+=1) {
    unicode_lower_table[val] = val+26;
  }
  for (val=8544; val<=8559; val+=1) {
    unicode_lower_table[val] = val+16;
  }
  for (val=256; val<=302; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  for (val=330; val<=374; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  for (val=504; val<=542; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  for (val=1120; val<=1152; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  for (val=1162; val<=1214; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  for (val=1232; val<=1268; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  for (val=7680; val<=7828; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  for (val=7840; val<=7928; val+=2) {
    unicode_lower_table[val] = val+1;
  }
  ls = [
 306,  308,  310,  313,  315,  317,  319,  321,
 323,  325,  327,  377,  379,  381,  386,  388,
 391,  395,  401,  408,  416,  418,  420,  423,
 428,  431,  435,  437,  440,  444,  453,  456,
 459,  461,  463,  465,  467,  469,  471,  473,
 475,  478,  480,  482,  484,  486,  488,  490,
 492,  494,  498,  500,  546,  548,  550,  552,
 554,  556,  558,  560,  562,  984,  986,  988,
 990,  992,  994,  996,  998,  1000,  1002,  1004,
 1006,  1015,  1018,  1217,  1219,  1221,  1223,  1225,
 1227,  1229,  1272,  1280,  1282,  1284,  1286,  1288,
 1290,  1292,  1294,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_lower_table[val] = val+1;
  }
  ls = [
 7944,  7945,  7946,  7947,  7948,  7949,  7950,  7951,
 7960,  7961,  7962,  7963,  7964,  7965,  7976,  7977,
 7978,  7979,  7980,  7981,  7982,  7983,  7992,  7993,
 7994,  7995,  7996,  7997,  7998,  7999,  8008,  8009,
 8010,  8011,  8012,  8013,  8025,  8027,  8029,  8031,
 8040,  8041,  8042,  8043,  8044,  8045,  8046,  8047,
 8072,  8073,  8074,  8075,  8076,  8077,  8078,  8079,
 8088,  8089,  8090,  8091,  8092,  8093,  8094,  8095,
 8104,  8105,  8106,  8107,  8108,  8109,  8110,  8111,
 8120,  8121,  8152,  8153,  8168,  8169,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_lower_table[val] = val-8;
  }
})();
/* list all the special cases in unicode_title_table */
var unicode_title_table = {
 181: 924,  223: [ 83,115 ],  255: 376,  305: 73,  329: [ 700,78 ],
 383: 83,  405: 502,  414: 544,  447: 503,  452: 453,
 455: 456,  458: 459,  477: 398,  496: [ 74,780 ],  497: 498,
 595: 385,  596: 390,  598: 393,  599: 394,  601: 399,
 603: 400,  608: 403,  611: 404,  616: 407,  617: 406,
 623: 412,  626: 413,  629: 415,  640: 422,  643: 425,
 648: 430,  650: 433,  651: 434,  658: 439,  837: 921,
 912: [ 921,776,769 ],  940: 902,  941: 904,  942: 905,  943: 906,
 944: [ 933,776,769 ],  962: 931,  972: 908,  973: 910,  974: 911,
 976: 914,  977: 920,  981: 934,  982: 928,  1008: 922,
 1010: 1017,  1013: 917,  1415: [ 1333,1410 ],  7830: [ 72,817 ],  7831: [ 84,776 ],
 7832: [ 87,778 ],  7833: [ 89,778 ],  7834: [ 65,702 ],  7835: 7776,  8016: [ 933,787 ],
 8018: [ 933,787,768 ],  8020: [ 933,787,769 ],  8022: [ 933,787,834 ],  8048: 8122,  8049: 8123,
 8050: 8136,  8051: 8137,  8052: 8138,  8053: 8139,  8054: 8154,
 8055: 8155,  8056: 8184,  8057: 8185,  8058: 8170,  8059: 8171,
 8060: 8186,  8061: 8187,  8114: [ 8122,837 ],  8115: 8124,  8116: [ 902,837 ],
 8118: [ 913,834 ],  8119: [ 913,834,837 ],  8126: 921,  8130: [ 8138,837 ],  8131: 8140,
 8132: [ 905,837 ],  8134: [ 919,834 ],  8135: [ 919,834,837 ],  8146: [ 921,776,768 ],  8147: [ 921,776,769 ],
 8150: [ 921,834 ],  8151: [ 921,776,834 ],  8162: [ 933,776,768 ],  8163: [ 933,776,769 ],  8164: [ 929,787 ],
 8165: 8172,  8166: [ 933,834 ],  8167: [ 933,776,834 ],  8178: [ 8186,837 ],  8179: 8188,
 8180: [ 911,837 ],  8182: [ 937,834 ],  8183: [ 937,834,837 ],  64256: [ 70,102 ],  64257: [ 70,105 ],
 64258: [ 70,108 ],  64259: [ 70,102,105 ],  64260: [ 70,102,108 ],  64261: [ 83,116 ],  64262: [ 83,116 ],
 64275: [ 1348,1398 ],  64276: [ 1348,1381 ],  64277: [ 1348,1387 ],  64278: [ 1358,1398 ],  64279: [ 1348,1389 ]
};
/* add all the regular cases to unicode_title_table */
(function() {
  var ls, ix, val;
  ls = [
 7936,  7937,  7938,  7939,  7940,  7941,  7942,  7943,
 7952,  7953,  7954,  7955,  7956,  7957,  7968,  7969,
 7970,  7971,  7972,  7973,  7974,  7975,  7984,  7985,
 7986,  7987,  7988,  7989,  7990,  7991,  8000,  8001,
 8002,  8003,  8004,  8005,  8017,  8019,  8021,  8023,
 8032,  8033,  8034,  8035,  8036,  8037,  8038,  8039,
 8064,  8065,  8066,  8067,  8068,  8069,  8070,  8071,
 8080,  8081,  8082,  8083,  8084,  8085,  8086,  8087,
 8096,  8097,  8098,  8099,  8100,  8101,  8102,  8103,
 8112,  8113,  8144,  8145,  8160,  8161,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_title_table[val] = val+8;
  }
  for (val=257; val<=303; val+=2) {
    unicode_title_table[val] = val-1;
  }
  for (val=331; val<=375; val+=2) {
    unicode_title_table[val] = val-1;
  }
  for (val=505; val<=543; val+=2) {
    unicode_title_table[val] = val-1;
  }
  for (val=1121; val<=1153; val+=2) {
    unicode_title_table[val] = val-1;
  }
  for (val=1163; val<=1215; val+=2) {
    unicode_title_table[val] = val-1;
  }
  for (val=1233; val<=1269; val+=2) {
    unicode_title_table[val] = val-1;
  }
  for (val=7681; val<=7829; val+=2) {
    unicode_title_table[val] = val-1;
  }
  for (val=7841; val<=7929; val+=2) {
    unicode_title_table[val] = val-1;
  }
  ls = [
 307,  309,  311,  314,  316,  318,  320,  322,
 324,  326,  328,  378,  380,  382,  387,  389,
 392,  396,  402,  409,  417,  419,  421,  424,
 429,  432,  436,  438,  441,  445,  454,  457,
 460,  462,  464,  466,  468,  470,  472,  474,
 476,  479,  481,  483,  485,  487,  489,  491,
 493,  495,  499,  501,  547,  549,  551,  553,
 555,  557,  559,  561,  563,  985,  987,  989,
 991,  993,  995,  997,  999,  1001,  1003,  1005,
 1007,  1016,  1019,  1218,  1220,  1222,  1224,  1226,
 1228,  1230,  1273,  1281,  1283,  1285,  1287,  1289,
 1291,  1293,  1295,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_title_table[val] = val-1;
  }
  for (val=8560; val<=8575; val+=1) {
    unicode_title_table[val] = val-16;
  }
  for (val=9424; val<=9449; val+=1) {
    unicode_title_table[val] = val-26;
  }
  for (val=97; val<=122; val+=1) {
    unicode_title_table[val] = val-32;
  }
  for (val=224; val<=246; val+=1) {
    unicode_title_table[val] = val-32;
  }
  for (val=945; val<=961; val+=1) {
    unicode_title_table[val] = val-32;
  }
  for (val=1072; val<=1103; val+=1) {
    unicode_title_table[val] = val-32;
  }
  for (val=65345; val<=65370; val+=1) {
    unicode_title_table[val] = val-32;
  }
  ls = [
 248,  249,  250,  251,  252,  253,  254,  963,
 964,  965,  966,  967,  968,  969,  970,  971,
  ];
  for (ix=0; ix<ls.length; ix++) {
    val = ls[ix];
    unicode_title_table[val] = val-32;
  }
  for (val=66600; val<=66639; val+=1) {
    unicode_title_table[val] = val-40;
  }
  for (val=1377; val<=1414; val+=1) {
    unicode_title_table[val] = val-48;
  }
  for (val=1104; val<=1119; val+=1) {
    unicode_title_table[val] = val-80;
  }
  unicode_title_table[1009] = 929;
})();
/* End of tables generated by casemap.py. */

/* Convert a 32-bit Unicode value to a JS string. */
function CharToString(val) {
    if (val < 0x10000) {
        return String.fromCharCode(val);
    }
    else {
        val -= 0x10000;
        return String.fromCharCode(0xD800 + (val >> 10), 0xDC00 + (val & 0x3FF));
    }
}

/* Given an array, return an array of the same length with all the values
   trimmed to the range 0-255. This may be the same array. */
function TrimArrayToBytes(arr) {
    var ix, newarr;
    var len = arr.length;
    for (ix=0; ix<len; ix++) {
        if (arr[ix] < 0 || arr[ix] >= 0x100) 
            break;
    }
    if (ix == len) {
        return arr;
    }
    newarr = Array(len);
    for (ix=0; ix<len; ix++) {
        newarr[ix] = (arr[ix] & 0xFF);
    }
    return newarr;
}

/* Convert an array of 8-bit values to a JS string, trimming if
   necessary. */
function ByteArrayToString(arr) {
    var ix, newarr;
    var len = arr.length;
    if (len == 0)
        return '';
    for (ix=0; ix<len; ix++) {
        if (arr[ix] < 0 || arr[ix] >= 0x100) 
            break;
    }
    if (ix == len) {
        return String.fromCharCode.apply(this, arr);
    }
    newarr = Array(len);
    for (ix=0; ix<len; ix++) {
        newarr[ix] = String.fromCharCode(arr[ix] & 0xFF);
    }
    return newarr.join('');
}

/* Convert an array of 32-bit Unicode values to a JS string. If they're
   all in the 16-bit range, this is easy; otherwise we have to do
   some munging. */
function UniArrayToString(arr) {
    var ix, val, newarr;
    var len = arr.length;
    if (len == 0)
        return '';
    for (ix=0; ix<len; ix++) {
        if (arr[ix] >= 0x10000) 
            break;
    }
    if (ix == len) {
        return String.fromCharCode.apply(this, arr);
    }
    newarr = Array(len);
    for (ix=0; ix<len; ix++) {
        val = arr[ix];
        if (val < 0x10000) {
            newarr[ix] = String.fromCharCode(val);
        }
        else {
            val -= 0x10000;
            newarr[ix] = String.fromCharCode(0xD800 + (val >> 10), 0xDC00 + (val & 0x3FF));
        }
    }
    return newarr.join('');
}

/* Log the message in the browser's error log, if it has one. (This shows
   up in Safari, in Opera, and in Firefox if you have Firebug installed.)
*/
function qlog(msg) {
    if (window.console && console.log)
        console.log(msg);
    else if (window.opera && opera.postError)
        opera.postError(msg);
}

/* RefBox: Simple class used for "call-by-reference" Glk arguments. The object
   is just a box containing a single value, which can be written and read.
*/
function RefBox() {
    this.value = undefined;
    this.set_value = function(val) {
        this.value = val;
    }
    this.get_value = function() {
        return this.value;
    }
}

/* RefStruct: Used for struct-type Glk arguments. After creating the
   object, you should call push_field() the appropriate number of times,
   to set the initial field values. Then set_field() can be used to
   change them, and get_fields() retrieves the list of all fields.

   (The usage here is loose, since Javascript is forgiving about arrays.
   Really the caller could call set_field() instead of push_field() --
   or skip that step entirely, as long as the Glk function later calls
   set_field() for each field. Which it should.)
*/
function RefStruct(numels) {
    this.fields = [];
    this.push_field = function(val) {
        this.fields.push(val);
    }
    this.set_field = function(pos, val) {
        this.fields[pos] = val;
    }
    this.get_field = function(pos) {
        return this.fields[pos];
    }
    this.get_fields = function() {
        return this.fields;
    }
}

/* Dummy return value, which means that the Glk call is still in progress,
   or will never return at all. This is used by glk_exit() and glk_select().
*/
var DidNotReturn = { dummy: 'Glk call has not yet returned' };

/* This returns a hint for whether the Glk call (by selector number)
   might block or never return. True for glk_exit(), glk_select(),
   and glk_fileref_create_by_prompt().
*/
function call_may_not_return(id) {
    if (id == 0x001 || id == 0x0C0 || id == 0x062)
        return true;
    else
        return false;
}

var strtype_File = 1;
var strtype_Window = 2;
var strtype_Memory = 3;

/* Beginning of linked list of windows. */
var gli_windowlist = null;
var gli_rootwin = null;
/* Set when any window is created, destroyed, or resized. */
var geometry_changed = true; 
/* Received from GlkOte; describes the window size. */
var content_metrics = null;

/* Beginning of linked list of streams. */
var gli_streamlist = null;
/* Beginning of linked list of filerefs. */
var gli_filereflist = null;
/* Beginning of linked list of schannels. */
var gli_schannellist = null;

/* The current output stream. */
var gli_currentstr = null;

/* During a glk_select() block, this is the RefStruct which will contain
   the result. */
var gli_selectref = null;

/* This is used to assigned disprock values to windows, when there is
   no GiDispa layer to provide them. */
var gli_api_display_rocks = 1;

/* A positive number if the timer is set. */
var gli_timer_interval = null; 
var gli_timer_id = null; /* Currently active setTimeout ID */
var gli_timer_started = null; /* When the setTimeout began */

function gli_new_window(type, rock) {
    var win = {};
    win.type = type;
    win.rock = rock;
    win.disprock = undefined;

    win.parent = null;
    win.str = gli_stream_open_window(win);
    win.echostr = null;
    win.style = Const.style_Normal;
    win.hyperlink = 0;

    win.input_generation = null;
    win.linebuf = null;
    win.char_request = false;
    win.line_request = false;
    win.char_request_uni = false;
    win.line_request_uni = false;
    win.hyperlink_request = false;

    /* window-type-specific info is set up in glk_window_open */

    win.prev = null;
    win.next = gli_windowlist;
    gli_windowlist = win;
    if (win.next)
        win.next.prev = win;

    if (window.GiDispa)
        GiDispa.class_register('window', win);
    else
        win.disprock = gli_api_display_rocks++;
    /* We need to assign a disprock even if there's no GiDispa layer,
       because GlkOte differentiates windows by their disprock. */
    geometry_changed = true;

    return win;
}

function gli_delete_window(win) {
    var prev, next;

    if (window.GiDispa)
        GiDispa.class_unregister('window', win);
    geometry_changed = true;
    
    win.echostr = null;
    if (win.str) {
        gli_delete_stream(win.str);
        win.str = null;
    }

    prev = win.prev;
    next = win.next;
    win.prev = null;
    win.next = null;

    if (prev)
        prev.next = next;
    else
        gli_windowlist = next;
    if (next)
        next.prev = prev;

    win.parent = null;
    win.rock = null;
    win.disprock = null;
}

function gli_windows_unechostream(str) {
    var win;
    
    for (win=gli_windowlist; win; win=win.next) {
        if (win.echostr === str)
            win.echostr = null;
    }
}

/* Add a (Javascript) string to the given window's display. */
function gli_window_put_string(win, val) {
    var ix, ch;

    //### might be efficient to split the implementation up into
    //### gli_window_buffer_put_string(), etc, since many functions
    //### know the window type when they call this
    switch (win.type) {
    case Const.wintype_TextBuffer:
        if (win.style != win.accumstyle
            || win.hyperlink != win.accumhyperlink)
            gli_window_buffer_deaccumulate(win);
        win.accum.push(val);
        break;
    case Const.wintype_TextGrid:
        for (ix=0; ix<val.length; ix++) {
            ch = val.charAt(ix);

            /* Canonicalize the cursor position. This is like calling
               gli_window_grid_canonicalize(), but I've inlined it. */
            if (win.cursorx < 0)
                win.cursorx = 0;
            else if (win.cursorx >= win.gridwidth) {
                win.cursorx = 0;
                win.cursory++;
            }
            if (win.cursory < 0)
                win.cursory = 0;
            else if (win.cursory >= win.gridheight)
                break; /* outside the window */

            if (ch == "\n") {
                /* a newline just moves the cursor. */
                win.cursory++;
                win.cursorx = 0;
                continue;
            }

            lineobj = win.lines[win.cursory];
            lineobj.dirty = true;
            lineobj.chars[win.cursorx] = ch;
            lineobj.styles[win.cursorx] = win.style;
            lineobj.hyperlinks[win.cursorx] = win.hyperlink;

            win.cursorx++;
            /* We can leave the cursor outside the window, since it will be
               canonicalized next time a character is printed. */
        }
        break;
    }
}

/* Canonicalize the cursor position. That is, the cursor may have
   been left outside the window area; wrap it if necessary.
*/
function gli_window_grid_canonicalize(win) {
    if (win.cursorx < 0)
        win.cursorx = 0;
    else if (win.cursorx >= win.gridwidth) {
        win.cursorx = 0;
        win.cursory++;
    }
    if (win.cursory < 0)
        win.cursory = 0;
    else if (win.cursory >= win.gridheight)
        return; /* outside the window */
}

/* Take the accumulation of strings (since the last style change) and
   assemble them into a buffer window update. This must be called
   after each style change; it must also be called right before 
   GlkOte.update(). (Actually we call it right before win.accum.push
   if the style has changed -- there's no need to call for *every* style
   change if no text is being pushed out in between.)
*/
function gli_window_buffer_deaccumulate(win) {
    var conta = win.content;
    var stylename = StyleNameMap[win.accumstyle];
    var text, ls, ix, obj, arr;

    if (win.accum.length) {
        text = win.accum.join('');
        ls = text.split('\n');
        for (ix=0; ix<ls.length; ix++) {
            arr = undefined;
            if (ix == 0) {
                if (ls[ix]) {
                    if (conta.length == 0) {
                        arr = [];
                        conta.push({ content: arr, append: true });
                    }
                    else {
                        obj = conta[conta.length-1];
                        if (!obj.content) {
                            arr = [];
                            obj.content = arr;
                        }
                        else {
                            arr = obj.content;
                        }
                    }
                }
            }
            else {
                if (ls[ix]) {
                    arr = [];
                    conta.push({ content: arr });
                }
                else {
                    conta.push({ });
                }
            }
            if (arr !== undefined) {
                if (!win.accumhyperlink) {
                    arr.push(stylename);
                    arr.push(ls[ix]);
                }
                else {
                    arr.push({ style:stylename, text:ls[ix], hyperlink:win.accumhyperlink });
                }
            }
        }
    }

    win.accum.length = 0;
    win.accumstyle = win.style;
    win.accumhyperlink = win.hyperlink;
}

function gli_window_close(win, recurse) {
    var wx;
    
    for (wx=win.parent; wx; wx=wx.parent) {
        if (wx.type == Const.wintype_Pair) {
            if (wx.pair_key === win) {
                wx.pair_key = null;
                wx.pair_keydamage = true;
            }
        }
    }

    if (window.GiDispa && win.linebuf) {
        GiDispa.unretain_array(win.linebuf);
        win.linebuf = null;
    }
    
    switch (win.type) {
        case Const.wintype_Pair: 
            if (recurse) {
                if (win.child1)
                    gli_window_close(win.child1, true);
                if (win.child2)
                    gli_window_close(win.child2, true);
            }
            win.child1 = null;
            win.child2 = null;
            win.pair_key = null;
            break;
        case Const.wintype_TextBuffer: 
            win.accum = null;
            win.content = null;
            break;
        case Const.wintype_TextGrid: 
            win.lines = null;
            break;
    }
    
    gli_delete_window(win);
}

function gli_window_rearrange(win, box) {
    var width, height, oldwidth, oldheight;
    var min, max, diff, splitwid, ix, cx, lineobj;
    var box1, box2, ch1, ch2;

    geometry_changed = true;
    win.bbox = box;

    switch (win.type) {

    case Const.wintype_TextGrid:
        /* Compute the new grid size. */
        width = box.right - box.left;
        height = box.bottom - box.top;
        oldheight = win.gridheight;
        win.gridwidth = Math.max(0, Math.floor((width-content_metrics.gridmarginx) / content_metrics.gridcharwidth));
        win.gridheight = Math.max(0, Math.floor((height-content_metrics.gridmarginy) / content_metrics.gridcharheight));

        /* Now we have to resize the win.lines array, in two dimensions. */
        if (oldheight > win.gridheight) {
            win.lines.length = win.gridheight;
        }
        else if (oldheight < win.gridheight) {
            for (ix=oldheight; ix<win.gridheight; ix++) {
                win.lines[ix] = { chars:[], styles:[], hyperlinks:[], 
                                  dirty:true };
            }
        }
        for (ix=0; ix<win.gridheight; ix++) {
            lineobj = win.lines[ix];
            oldwidth = lineobj.chars.length;
            if (oldwidth > win.gridwidth) {
                lineobj.dirty = true;
                lineobj.chars.length = win.gridwidth;
                lineobj.styles.length = win.gridwidth;
                lineobj.hyperlinks.length = win.gridwidth;
            }
            else if (oldwidth < win.gridwidth) {
                lineobj.dirty = true;
                for (cx=oldwidth; cx<win.gridwidth; cx++) {
                    lineobj.chars[cx] = ' ';
                    lineobj.styles[cx] = Const.style_Normal;
                    lineobj.hyperlinks[cx] = 0;
                }
            }
        }
        break;

    case Const.wintype_Pair:
        if (win.pair_vertical) {
            min = win.bbox.left;
            max = win.bbox.right;
            splitwid = content_metrics.inspacingx;
        }
        else {
            min = win.bbox.top;
            max = win.bbox.bottom;
            splitwid = content_metrics.inspacingy;
        }
        diff = max - min;

        if (win.pair_division == Const.winmethod_Proportional) {
            split = Math.floor((diff * win.pair_size) / 100);
        }
        else if (win.pair_division == Const.winmethod_Fixed) {
            split = 0;
            if (win.pair_key && win.pair_key.type == Const.wintype_TextBuffer) {
                if (!win.pair_vertical) 
                    split = (win.pair_size * content_metrics.buffercharheight + content_metrics.buffermarginy);
                else
                    split = (win.pair_size * content_metrics.buffercharwidth + content_metrics.buffermarginx);
            }
            if (win.pair_key && win.pair_key.type == Const.wintype_TextGrid) {
                if (!win.pair_vertical) 
                    split = (win.pair_size * content_metrics.gridcharheight + content_metrics.gridmarginy);
                else
                    split = (win.pair_size * content_metrics.gridcharwidth + content_metrics.gridmarginx);
            }
            split = Math.ceil(split);
        }
        else {
            /* default behavior for unknown division method */
            split = Math.floor(diff / 2);
        }

        /* Split is now a number between 0 and diff. Convert that to a number
           between min and max; also apply upside-down-ness. */
        if (!win.pair_backward) {
            split = max-split-splitwid;
        }
        else {
            split = min+split;
        }

        /* Make sure it's really between min and max. */
        if (min >= max) {
            split = min;
        }
        else {
            split = Math.min(Math.max(split, min), max-splitwid);
        }

        win.pair_splitpos = split;
        win.pair_splitwidth = splitwid;
        if (win.pair_vertical) {
            box1 = {
                left: win.bbox.left,
                right: win.pair_splitpos,
                top: win.bbox.top,
                bottom: win.bbox.bottom
            };
            box2 = {
                left: box1.right + win.pair_splitwidth,
                right: win.bbox.right,
                top: win.bbox.top,
                bottom: win.bbox.bottom
            };
        }
        else {
            box1 = {
                top: win.bbox.top,
                bottom: win.pair_splitpos,
                left: win.bbox.left,
                right: win.bbox.right
            };
            box2 = {
                top: box1.bottom + win.pair_splitwidth,
                bottom: win.bbox.bottom,
                left: win.bbox.left,
                right: win.bbox.right
            };
        }
        if (!win.pair_backward) {
            ch1 = win.child1;
            ch2 = win.child2;
        }
        else {
            ch1 = win.child2;
            ch2 = win.child1;
        }

        gli_window_rearrange(ch1, box1);
        gli_window_rearrange(ch2, box2);
        break;

    }
}

function gli_new_stream(type, readable, writable, rock) {
    var str = {};
    str.type = type;
    str.rock = rock;
    str.disprock = undefined;

    str.unicode = false;
    str.ref = null;
    str.win = null;
    str.file = null;
    str.buf = null;
    str.bufpos = 0;
    str.buflen = 0;
    str.bufeof = 0;
    str.timer_id = null;
    str.flush_func = null;

    str.readcount = 0;
    str.writecount = 0;
    str.readable = readable;
    str.writable = writable;

    str.prev = null;
    str.next = gli_streamlist;
    gli_streamlist = str;
    if (str.next)
        str.next.prev = str;

    if (window.GiDispa)
        GiDispa.class_register('stream', str);

    return str;
}

function gli_delete_stream(str) {
    var prev, next;
    
    if (str === gli_currentstr) {
        gli_currentstr = null;
    }

    gli_windows_unechostream(str);

    if (str.type == strtype_Memory) {
        if (window.GiDispa)
            GiDispa.unretain_array(str.buf);
    }

    if (window.GiDispa)
        GiDispa.class_unregister('stream', str);

    prev = str.prev;
    next = str.next;
    str.prev = null;
    str.next = null;

    if (prev)
        prev.next = next;
    else
        gli_streamlist = next;
    if (next)
        next.prev = prev;

    str.buf = null;
    str.readable = false;
    str.writable = false;
    str.ref = null;
    str.win = null;
    str.file = null;
    str.rock = null;
    str.disprock = null;
}

function gli_stream_open_window(win) {
    var str;
    str = gli_new_stream(strtype_Window, false, true, 0);
    str.unicode = true;
    str.win = win;
    return str;
}

/* This is called on every write to a file stream. If a file is being
   written intermittently (a transcript file, for example) we'd like to
   flush the output every few seconds, in case the user closes the
   browser without closing the file ("script off").

   We do this by setting a ten-second timer (if there isn't one set already).
   The timer calls a flush method on the stream.
*/
function gli_stream_dirty_file(str) {
    if (str.timer_id === null) {
        if (str.flush_func === null) {
            /* Bodge together a closure to act as a stream method. */
            str.flush_func = function() { gli_stream_flush_file(str); };
        }
        str.timer_id = setTimeout(str.flush_func, 10000);
    }
}

/* Write out the contents of a file stream to the "disk file". Because
   localStorage doesn't support appending, we have to dump the entire
   buffer out.
*/
function gli_stream_flush_file(str) {
    str.timer_id = null;
    Dialog.file_write(str.ref, str.buf);
}

function gli_new_fileref(filename, usage, rock, ref) {
    var fref = {};
    fref.filename = filename;
    fref.rock = rock;
    fref.disprock = undefined;

    fref.textmode = ((usage & Const.fileusage_TextMode) != 0);
    fref.filetype = (usage & Const.fileusage_TypeMask);
    fref.filetypename = FileTypeMap[fref.filetype];
    if (!fref.filetypename) {
        fref.filetypename = 'xxx';
    }

    if (!ref) {
        var gameid = '';
        if (fref.filetype == Const.fileusage_SavedGame)
            gameid = VM.get_signature();
        ref = Dialog.file_construct_ref(fref.filename, fref.filetypename, gameid);
    }
    fref.ref = ref;

    fref.prev = null;
    fref.next = gli_filereflist;
    gli_filereflist = fref;
    if (fref.next)
        fref.next.prev = fref;

    if (window.GiDispa)
        GiDispa.class_register('fileref', fref);

    return fref;
}

function gli_delete_fileref(fref) {
    var prev, next;
    
    if (window.GiDispa)
        GiDispa.class_unregister('fileref', fref);

    prev = fref.prev;
    next = fref.next;
    fref.prev = null;
    fref.next = null;

    if (prev)
        prev.next = next;
    else
        gli_filereflist = next;
    if (next)
        next.prev = prev;

    fref.filename = null;
    fref.ref = null;
    fref.rock = null;
    fref.disprock = null;
}

/* Write one character (given as a Unicode value) to a stream.
   This is called by both the one-byte and four-byte character APIs.
*/
function gli_put_char(str, ch) {
    if (!str || !str.writable)
        throw('gli_put_char: invalid stream');

    if (!str.unicode)
        ch = ch & 0xFF;

    str.writecount += 1;
    
    switch (str.type) {
    case strtype_File:
        gli_stream_dirty_file(str);
        /* fall through to memory... */
    case strtype_Memory:
        if (str.bufpos < str.buflen) {
            str.buf[str.bufpos] = ch;
            str.bufpos += 1;
            if (str.bufpos > str.bufeof)
                str.bufeof = str.bufpos;
        }
        break;
    case strtype_Window:
        if (str.win.line_request)
            throw('gli_put_char: window has pending line request');
        gli_window_put_string(str.win, CharToString(ch));
        if (str.win.echostr)
            gli_put_char(str.win.echostr, ch);
        break;
    }
}

/* Write characters (given as an array of Unicode values) to a stream.
   This is called by both the one-byte and four-byte character APIs.
   The "allbytes" argument is a hint that all the array values are
   already in the range 0-255.
*/
function gli_put_array(str, arr, allbytes) {
    var ix, len, val;

    if (!str || !str.writable)
        throw('gli_put_array: invalid stream');

    if (!str.unicode && !allbytes) {
        arr = TrimArrayToBytes(arr);
        allbytes = true;
    }

    str.writecount += arr.length;
    
    switch (str.type) {
    case strtype_File:
        gli_stream_dirty_file(str);
        /* fall through to memory... */
    case strtype_Memory:
        len = arr.length;
        if (len > str.buflen-str.bufpos)
            len = str.buflen-str.bufpos;
        for (ix=0; ix<len; ix++)
            str.buf[str.bufpos+ix] = arr[ix];
        str.bufpos += len;
        if (str.bufpos > str.bufeof)
            str.bufeof = str.bufpos;
        break;
    case strtype_Window:
        if (str.win.line_request)
            throw('gli_put_array: window has pending line request');
        if (allbytes)
            val = String.fromCharCode.apply(this, arr);
        else
            val = UniArrayToString(arr);
        gli_window_put_string(str.win, val);
        if (str.win.echostr)
            gli_put_array(str.win.echostr, arr, allbytes);
        break;
    }
}

function gli_get_char(str, want_unicode) {
    var ch;

    if (!str || !str.readable)
        return -1;
    
    switch (str.type) {
    case strtype_File:
        /* fall through to memory... */
    case strtype_Memory:
        if (str.bufpos < str.bufeof) {
            ch = str.buf[str.bufpos];
            str.bufpos++;
            str.readcount++;
            if (!want_unicode && ch >= 0x100)
                return 63; // return '?'
            return ch;
        }
        else {
            return -1; // end of stream 
        }
    default:
        return -1;
    }
}

function gli_get_line(str, buf, want_unicode) {
    if (!str || !str.readable)
        return 0;

    var len = buf.length;
    var gotnewline;

    switch (str.type) {
    case strtype_File:
        /* fall through to memory... */
    case strtype_Memory:
        if (len == 0)
            return 0;
        len -= 1; /* for the terminal null */
        if (str.bufpos >= str.bufeof) {
            len = 0;
        }
        else {
            if (str.bufpos + len > str.bufeof) {
                len = str.bufeof - str.bufpos;
            }
        }
        gotnewline = false;
        if (!want_unicode) {
            for (lx=0; lx<len && !gotnewline; lx++) {
                ch = str.buf[str.bufpos++];
                if (!want_unicode && ch >= 0x100)
                    ch = 63; // ch = '?'
                buf[lx] = ch;
                gotnewline = (ch == 10);
            }
        }
        else {
            for (lx=0; lx<len && !gotnewline; lx++) {
                ch = str.buf[str.bufpos++];
                buf[lx] = ch;
                gotnewline = (ch == 10);
            }
        }
        str.readcount += lx;
        return lx;
    default:
        return 0;
    }
}

function gli_get_buffer(str, buf, want_unicode) {
    if (!str || !str.readable)
        return 0;

    var len = buf.length;
    var lx, ch;
    
    switch (str.type) {
    case strtype_File:
        /* fall through to memory... */
    case strtype_Memory:
        if (str.bufpos >= str.bufeof) {
            len = 0;
        }
        else {
            if (str.bufpos + len > str.bufeof) {
                len = str.bufeof - str.bufpos;
            }
        }
        if (!want_unicode) {
            for (lx=0; lx<len; lx++) {
                ch = str.buf[str.bufpos++];
                if (!want_unicode && ch >= 0x100)
                    ch = 63; // ch = '?'
                buf[lx] = ch;
            }
        }
        else {
            for (lx=0; lx<len; lx++) {
                buf[lx] = str.buf[str.bufpos++];
            }
        }
        str.readcount += len;
        return len;
    default:
        return 0;
    }
}

function gli_stream_fill_result(str, result) {
    if (!result)
        return;
    result.set_field(0, str.readcount);
    result.set_field(1, str.writecount);
}

function glk_put_jstring(val, allbytes) {
    glk_put_jstring_stream(gli_currentstr, val, allbytes);
}

function glk_put_jstring_stream(str, val, allbytes) {
    var ix, len;

    if (!str || !str.writable)
        throw('glk_put_jstring: invalid stream');

    str.writecount += val.length;
    
    switch (str.type) {
    case strtype_File:
        gli_stream_dirty_file(str);
        /* fall through to memory... */
    case strtype_Memory:
        len = val.length;
        if (len > str.buflen-str.bufpos)
            len = str.buflen-str.bufpos;
        if (str.unicode || allbytes) {
            for (ix=0; ix<len; ix++)
                str.buf[str.bufpos+ix] = val.charCodeAt(ix);
        }
        else {
            for (ix=0; ix<len; ix++)
                str.buf[str.bufpos+ix] = val.charCodeAt(ix) & 0xFF;
        }
        str.bufpos += len;
        if (str.bufpos > str.bufeof)
            str.bufeof = str.bufpos;
        break;
    case strtype_Window:
        if (str.win.line_request)
            throw('glk_put_jstring: window has pending line request');
        gli_window_put_string(str.win, val);
        if (str.win.echostr)
            glk_put_jstring_stream(str.win.echostr, val, allbytes);
        break;
    }
}

function gli_set_style(str, val) {
    if (!str || !str.writable)
        throw('gli_set_style: invalid stream');

    if (val >= Const.style_NUMSTYLES)
        val = 0;

    if (str.type == strtype_Window) {
        str.win.style = val;
        if (str.win.echostr)
            gli_set_style(str.win.echostr, val);
    }
}

function gli_set_hyperlink(str, val) {
    if (!str || !str.writable)
        throw('gli_set_hyperlink: invalid stream');

    if (str.type == strtype_Window) {
        str.win.hyperlink = val;
        if (str.win.echostr)
            gli_set_hyperlink(str.win.echostr, val);
    }
}

function gli_timer_callback() {
    if (ui_disabled) {
        if (has_exited) {
            /* The game shut down and left us hanging. */
            GlkOte.log("### dropping timer event...");
            gli_timer_id = null;
            return;
        }
        else {
            /* Put off dealing with this for a half-second. */
            GlkOte.log("### procrastinating timer event...");
            gli_timer_id = setTimeout(gli_timer_callback, 500);
            return;
        }
    }
    gli_timer_id = setTimeout(gli_timer_callback, gli_timer_interval);
    gli_timer_started = Date.now();
    GlkOte.extevent('timer');
}

/* The catalog of Glk API functions. */

function glk_exit() {
    /* For safety, this is fast and idempotent. */
    has_exited = true;
    ui_disabled = true;
    gli_selectref = null;
    return DidNotReturn;
}

function glk_tick() {
    /* Do nothing. */
}

function glk_gestalt(sel, val) {
    return glk_gestalt_ext(sel, val, null);
}

function glk_gestalt_ext(sel, val, arr) {
    switch (sel) {

    case 0: // gestalt_Version
        return 0x00000700;

    case 1: // gestalt_CharInput
        /* This is not a terrific approximation. Return false for function
           keys, control keys, and the high-bit non-printables. For
           everything else in the Unicode range, return true. */
        if (val <= Const.keycode_Left && val >= Const.keycode_End)
            return 1;
        if (val >= 0x100000000-Const.keycode_MAXVAL)
            return 0;
        if (val > 0x10FFFF)
            return 0;
        if ((val >= 0 && val < 32) || (val >= 127 && val < 160))
            return 0;
        return 1;

    case 2: // gestalt_LineInput
        /* Same as the above, except no special keys. */
        if (val > 0x10FFFF)
            return 0;
        if ((val >= 0 && val < 32) || (val >= 127 && val < 160))
            return 0;
        return 1;

    case 3: // gestalt_CharOutput
        /* Same thing again. We assume that all printable characters,
           as well as the placeholders for nonprintables, are one character
           wide. */
        if ((val > 0x10FFFF) 
            || (val >= 0 && val < 32) 
            || (val >= 127 && val < 160)) {
            if (arr)
                arr[0] = 1;
            return 0; // gestalt_CharOutput_CannotPrint
        }
        if (arr)
            arr[0] = 1;
        return 2; // gestalt_CharOutput_ExactPrint

    case 4: // gestalt_MouseInput
        return 0;

    case 5: // gestalt_Timer
        return 1;

    case 6: // gestalt_Graphics
        return 0;

    case 7: // gestalt_DrawImage
        return 0;

    case 8: // gestalt_Sound
        return 0;

    case 9: // gestalt_SoundVolume
        return 0;

    case 10: // gestalt_SoundNotify
        return 0;

    case 11: // gestalt_Hyperlinks
        return 1;

    case 12: // gestalt_HyperlinkInput
        if (val == 3 || val == 4) // TextBuffer or TextGrid
            return 1;
        else
            return 0;

    case 13: // gestalt_SoundMusic
        return 0;

    case 14: // gestalt_GraphicsTransparency
        return 0;

    case 15: // gestalt_Unicode
        return 1;

    }

    return 0;
}

function glk_window_iterate(win, rockref) {
    if (!win)
        win = gli_windowlist;
    else
        win = win.next;

    if (win) {
        if (rockref)
            rockref.set_value(win.rock);
        return win;
    }

    if (rockref)
        rockref.set_value(0);
    return null;
}

function glk_window_get_rock(win) {
    if (!win)
        throw('glk_window_get_rock: invalid window');
    return win.rock;
}

function glk_window_get_root() {
    return gli_rootwin;
}

function glk_window_open(splitwin, method, size, wintype, rock) {
    var oldparent, box, val;
    var pairwin, newwin;

    if (!gli_rootwin) {
        if (splitwin)
            throw('glk_window_open: splitwin must be null for first window');

        oldparent = null;
        box = {
            left: content_metrics.outspacingx,
            top: content_metrics.outspacingy,
            right: content_metrics.width-content_metrics.outspacingx,
            bottom: content_metrics.height-content_metrics.outspacingy
        };
    }
    else {
        if (!splitwin)
            throw('glk_window_open: splitwin must not be null');

        val = (method & Const.winmethod_DivisionMask);
        if (val != Const.winmethod_Fixed && val != Const.winmethod_Proportional)
            throw('glk_window_open: invalid method (not fixed or proportional)');

        val = (method & Const.winmethod_DirMask);
        if (val != Const.winmethod_Above && val != Const.winmethod_Below 
            && val != Const.winmethod_Left && val != Const.winmethod_Right) 
            throw('glk_window_open: invalid method (bad direction)');
        
        box = splitwin.bbox;

        oldparent = splitwin.parent;
        if (oldparent && oldparent.type != Const.wintype_Pair) 
            throw('glk_window_open: parent window is not Pair');
    }

    newwin = gli_new_window(wintype, rock);

    switch (newwin.type) {
    case Const.wintype_TextBuffer:
        /* accum is a list of strings of a given style; newly-printed text
           is pushed onto the list. accumstyle is the style of that text.
           Anything printed in a different style (or hyperlink value)
           triggers a call to gli_window_buffer_deaccumulate, which cleans
           out accum and adds the results to the content array. The content
           is in GlkOte format.
        */
        newwin.accum = [];
        newwin.accumstyle = null;
        newwin.accumhyperlink = 0;
        newwin.content = [];
        newwin.clearcontent = false;
        break;
    case Const.wintype_TextGrid:
        /* lines is a list of line objects. A line looks like
           { chars: [...], styles: [...], hyperlinks: [...], dirty: bool }.
        */
        newwin.gridwidth = 0;
        newwin.gridheight = 0;
        newwin.lines = [];
        newwin.cursorx = 0;
        newwin.cursory = 0;
        break;
    case Const.wintype_Blank:
        break;
    case Const.wintype_Pair:
        throw('glk_window_open: cannot open pair window directly')
    default:
        /* Silently return null */
        gli_delete_window(newwin);
        return null;
    }

    if (!splitwin) {
        gli_rootwin = newwin;
        gli_window_rearrange(newwin, box);
    }
    else {
        /* create pairwin, with newwin as the key */
        pairwin = gli_new_window(Const.wintype_Pair, 0);
        pairwin.pair_dir = method & Const.winmethod_DirMask;
        pairwin.pair_division = method & Const.winmethod_DivisionMask;
        pairwin.pair_key = newwin;
        pairwin.pair_keydamage = false;
        pairwin.pair_size = size;
        pairwin.pair_vertical = (pairwin.pair_dir == Const.winmethod_Left || pairwin.pair_dir == Const.winmethod_Right);
        pairwin.pair_backward = (pairwin.pair_dir == Const.winmethod_Left || pairwin.pair_dir == Const.winmethod_Above);

        pairwin.child1 = splitwin;
        pairwin.child2 = newwin;
        splitwin.parent = pairwin;
        newwin.parent = pairwin;
        pairwin.parent = oldparent;

        if (oldparent) {
            if (oldparent.child1 == splitwin)
                oldparent.child1 = pairwin;
            else
                oldparent.child2 = pairwin;
        }
        else {
            gli_rootwin = pairwin;
        }

        gli_window_rearrange(pairwin, box);
    }

    return newwin;
}

function glk_window_close(win, statsref) {
    if (!win)
        throw('glk_window_close: invalid window');

    if (win === gli_rootwin || !win.parent) {
        /* close the root window, which means all windows. */
        
        gli_rootwin = null;
        
        /* begin (simpler) closation */
        
        gli_stream_fill_result(win.str, statsref);
        gli_window_close(win, true); 
    }
    else {
        /* have to jigger parent */
        var pairwin, grandparwin, sibwin, box, wx, keydamage_flag;

        pairwin = win.parent;
        if (win === pairwin.child1)
            sibwin = pairwin.child2;
        else if (win === pairwin.child2)
            sibwin = pairwin.child1;
        else
            throw('glk_window_close: window tree is corrupted');

        box = pairwin.bbox;

        grandparwin = pairwin.parent;
        if (!grandparwin) {
            gli_rootwin = sibwin;
            sibwin.parent = null;
        }
        else {
            if (grandparwin.child1 === pairwin)
                grandparwin.child1 = sibwin;
            else
                grandparwin.child2 = sibwin;
            sibwin.parent = grandparwin;
        }
        
        /* Begin closation */
        
        gli_stream_fill_result(win.str, statsref);

        /* Close the child window (and descendants), so that key-deletion can
            crawl up the tree to the root window. */
        gli_window_close(win, true); 

        /* This probably isn't necessary, but the child *is* gone, so just
            in case. */
        if (win === pairwin.child1) {
            pairwin.child1 = null;
        }
        else if (win === pairwin.child2) {
            pairwin.child2 = null;
        }
        
        /* Now we can delete the parent pair. */
        gli_window_close(pairwin, false);

        keydamage_flag = false;
        for (wx=sibwin; wx; wx=wx.parent) {
            if (wx.type == Const.wintype_Pair) {
                if (wx.pair_keydamage) {
                    keydamage_flag = true;
                    wx.pair_keydamage = false;
                }
            }
        }
        
        if (keydamage_flag) {
            box = content_box;
            gli_window_rearrange(gli_rootwin, box);
        }
        else {
            gli_window_rearrange(sibwin, box);
        }
    }
}

function glk_window_get_size(win, widthref, heightref) {
    if (!win)
        throw('glk_window_get_size: invalid window');

    var wid = 0;
    var hgt = 0;
    var boxwidth, boxheight;

    switch (win.type) {

    case Const.wintype_TextGrid:
        boxwidth = win.bbox.right - win.bbox.left;
        boxheight = win.bbox.bottom - win.bbox.top;
        wid = Math.max(0, Math.floor((boxwidth-content_metrics.gridmarginx) / content_metrics.gridcharwidth));
        hgt = Math.max(0, Math.floor((boxheight-content_metrics.gridmarginy) / content_metrics.gridcharheight));        
        break;

    case Const.wintype_TextBuffer:
        boxwidth = win.bbox.right - win.bbox.left;
        boxheight = win.bbox.bottom - win.bbox.top;
        wid = Math.max(0, Math.floor((boxwidth-content_metrics.buffermarginx) / content_metrics.buffercharwidth));
        hgt = Math.max(0, Math.floor((boxheight-content_metrics.buffermarginy) / content_metrics.buffercharheight));        
        break;

    }

    if (widthref)
        widthref.set_value(wid);
    if (heightref)
        heightref.set_value(hgt);
}

function glk_window_set_arrangement(win, method, size, keywin) {
    var wx, newdir, newvertical, newbackward;

    if (!win)
        throw('glk_window_set_arrangement: invalid window');
    if (win.type != Const.wintype_Pair) 
        throw('glk_window_set_arrangement: not a pair window');

    if (keywin) {
        if (keywin.type == Const.wintype_Pair)
            throw('glk_window_set_arrangement: keywin cannot be a pair window');
        for (wx=keywin; wx; wx=wx.parent) {
            if (wx == win)
                break;
        }
        if (!wx)
            throw('glk_window_set_arrangement: keywin must be a descendant');
    }

    newdir = method & Const.winmethod_DirMask;
    newvertical = (newdir == Const.winmethod_Left || newdir == Const.winmethod_Right);
    newbackward = (newdir == Const.winmethod_Left || newdir == Const.winmethod_Above);
    if (!keywin)
        keywin = win.pair_key;

    if (newvertical && !win.pair_vertical)
        throw('glk_window_set_arrangement: split must stay horizontal');
    if (!newvertical && win.pair_vertical)
        throw('glk_window_set_arrangement: split must stay vertical');

    if (keywin && keywin.type == Const.wintype_Blank
        && (method & Const.winmethod_DivisionMask) == Const.winmethod_Fixed) 
        throw('glk_window_set_arrangement: a blank window cannot have a fixed size');

    if ((newbackward && !win.pair_backward) || (!newbackward && win.pair_backward)) {
        /* switch the children */
        wx = win.child1;
        win.child1 = win.child2;
        win.child2 = wx;
    }

    /* set up everything else */
    win.pair_dir = newdir;
    win.pair_division = (method & Const.winmethod_DivisionMask);
    win.pair_key = keywin;
    win.pair_size = size;

    win.pair_vertical = (win.pair_dir == Const.winmethod_Left || win.pair_dir == Const.winmethod_Right);
    win.pair_backward = (win.pair_dir == Const.winmethod_Left || win.pair_dir == Const.winmethod_Above);

    gli_window_rearrange(win, win.bbox);
}

function glk_window_get_arrangement(win, methodref, sizeref, keywinref) {
    if (!win)
        throw('glk_window_get_arrangement: invalid window');
    if (win.type != Const.wintype_Pair) 
        throw('glk_window_get_arrangement: not a pair window');

    if (sizeref)
        sizeref.set_value(win.pair_size);
    if (keywinref)
        keywinref.set_value(win.pair_key);
    if (methodref)
        methodref.set_value(win.pair_dir | win.pair_division);
}

function glk_window_get_type(win) {
    if (!win)
        throw('glk_window_get_type: invalid window');
    return win.type;
}

function glk_window_get_parent(win) {
    if (!win)
        throw('glk_window_get_parent: invalid window');
    return win.parent;
}

function glk_window_clear(win) {
    var ix, cx, lineobj;

    if (!win)
        throw('glk_window_clear: invalid window');
    
    if (win.line_request) {
        throw('glk_window_clear: window has pending line request');
    }

    switch (win.type) {
    case Const.wintype_TextBuffer:
        win.accum.length = 0;
        win.accumstyle = null;
        win.accumhyperlink = 0;
        win.content.length = 0;
        win.clearcontent = true;
        break;
    case Const.wintype_TextGrid:
        win.cursorx = 0;
        win.cursory = 0;
        for (ix=0; ix<win.gridheight; ix++) {
            lineobj = win.lines[ix];
            lineobj.dirty = true;
            for (cx=0; cx<win.gridwidth; cx++) {
                lineobj.chars[cx] = ' ';
                lineobj.styles[cx] = Const.style_Normal;
                lineobj.hyperlinks[cx] = 0;
            }
        }
        break;
    }
}

function glk_window_move_cursor(win, xpos, ypos) {
    if (!win)
        throw('glk_window_move_cursor: invalid window');
    
    if (win.type == Const.wintype_TextGrid) {
        /* No bounds-checking; we canonicalize when we print. */
        win.cursorx = xpos;
        win.cursory = ypos;
    }
    else {
        throw('glk_window_move_cursor: not a grid window');
    }
}

function glk_window_get_stream(win) {
    if (!win)
        throw('glk_window_get_stream: invalid window');
    return win.str;
}

function glk_window_set_echo_stream(win, str) {
    if (!win)
        throw('glk_window_set_echo_stream: invalid window');
    win.echostr = str;
}

function glk_window_get_echo_stream(win) {
    if (!win)
        throw('glk_window_get_echo_stream: invalid window');
    return win.echostr;
}

function glk_set_window(win) {
    if (!win)
        gli_currentstr = null;
    else
        gli_currentstr = win.str;
}

function glk_window_get_sibling(win) {
    var parent, sib;
    if (!win)
        throw('glk_window_get_sibling: invalid window');
    parent = win.parent;
    if (!parent)
        return null;
    if (win === parent.child1)
        return parent.child2;
    else if (win === parent.child2)
        return parent.child1;
    else
        throw('glk_window_get_sibling: window tree is corrupted');
}

function glk_stream_iterate(str, rockref) {
    if (!str)
        str = gli_streamlist;
    else
        str = str.next;

    if (str) {
        if (rockref)
            rockref.set_value(str.rock);
        return str;
    }

    if (rockref)
        rockref.set_value(0);
    return null;
}

function glk_stream_get_rock(str) {
    if (!str)
        throw('glk_stream_get_rock: invalid stream');
    return str.rock;
}

function glk_stream_open_file(fref, fmode, rock) {
    if (!fref)
        throw('glk_stream_open_file: invalid fileref');

    var str;

    if (fmode != Const.filemode_Read 
        && fmode != Const.filemode_Write 
        && fmode != Const.filemode_ReadWrite 
        && fmode != Const.filemode_WriteAppend) 
        throw('glk_stream_open_file: illegal filemode');

    if (fmode == Const.filemode_Read && !Dialog.file_ref_exists(fref.ref))
        throw('glk_stream_open_file: file not found for reading: ' + fref.ref.filename);

    var content = null;
    if (fmode != Const.filemode_Write) {
        content = Dialog.file_read(fref.ref);
    }
    if (content == null) {
        content = [];
        if (fmode != Const.filemode_Read) {
            /* We just created this file. (Or perhaps we're in Write mode and
               we're truncating.) Write immediately, to create it and get the
               creation date right. */
            Dialog.file_write(fref.ref, '', true);
        }
    }
    if (content.length == null) 
        throw('glk_stream_open_file: data read had no length');

    str = gli_new_stream(strtype_File, 
        (fmode != Const.filemode_Write), 
        (fmode != Const.filemode_Read), 
        rock);
    str.unicode = false;
    str.ref = fref.ref;

    str.buf = content;
    str.buflen = 0xFFFFFFFF; /* enormous */
    if (fmode == Const.filemode_Write)
        str.bufeof = 0;
    else
        str.bufeof = content.length;
    if (fmode == Const.filemode_WriteAppend)
        str.bufpos = str.bufeof;
    else
        str.bufpos = 0;

    return str;
}

function glk_stream_open_memory(buf, fmode, rock) {
    var str;

    if (fmode != Const.filemode_Read 
        && fmode != Const.filemode_Write 
        && fmode != Const.filemode_ReadWrite) 
        throw('glk_stream_open_memory: illegal filemode');

    str = gli_new_stream(strtype_Memory, 
        (fmode != Const.filemode_Write), 
        (fmode != Const.filemode_Read), 
        rock);
    str.unicode = false;

    if (buf) {
        str.buf = buf;
        str.buflen = buf.length;
        str.bufpos = 0;
        if (fmode == Const.filemode_Write)
            str.bufeof = 0;
        else
            str.bufeof = str.buflen;
        if (window.GiDispa)
            GiDispa.retain_array(buf);
    }

    return str;
}

function glk_stream_close(str, result) {
    if (!str)
        throw('glk_stream_close: invalid stream');

    if (str.type == strtype_Window)
        throw('glk_stream_close: cannot close window stream');

    if (str.type == strtype_File && str.writable) {
        if (!(str.timer_id === null)) {
            clearTimeout(str.timer_id);
            str.timer_id = null;
        }
        Dialog.file_write(str.ref, str.buf);
    }

    gli_stream_fill_result(str, result);
    gli_delete_stream(str);
}

function glk_stream_set_position(str, pos, seekmode) {
    if (!str)
        throw('glk_stream_set_position: invalid stream');

    switch (str.type) {
    case strtype_File:
        //### check if file has been modified? This is a half-decent time.
        /* fall through to memory... */
    case strtype_Memory:
        if (seekmode == Const.seekmode_Current) {
            pos = str.bufpos + pos;
        }
        else if (seekmode == Const.seekmode_End) {
            pos = str.bufeof + pos;
        }
        else {
            /* pos = pos */
        }
        if (pos < 0)
            pos = 0;
        if (pos > str.bufeof)
            pos = str.bufeof;
        str.bufpos = pos;
    }
}

function glk_stream_get_position(str) {
    if (!str)
        throw('glk_stream_get_position: invalid stream');

    switch (str.type) {
    case strtype_File:
        /* fall through to memory... */
    case strtype_Memory:
        return str.bufpos;
    default:
        return 0;
    }
}

function glk_stream_set_current(str) {
    gli_currentstr = str;
}

function glk_stream_get_current() {
    return gli_currentstr;
}

function glk_fileref_create_temp(usage, rock) {
    var timestamp = new Date().getTime();
    var filename = "_temp_" + timestamp + "_" + Math.random();
    filename = filename.replace('.', '');
    fref = gli_new_fileref(filename, usage, rock, null);
    return fref;
}

function glk_fileref_create_by_name(usage, filename, rock) {
    fref = gli_new_fileref(filename, usage, rock, null);
    return fref;
}

function glk_fileref_create_by_prompt(usage, fmode, rock) {
    var writable = (fmode != Const.filemode_Read);
    var filetype = (usage & Const.fileusage_TypeMask);
    var filetypename = FileTypeMap[filetype];
    if (!filetypename) {
        filetypename = 'xxx';
    }

    /* Set up a callback closure, which hangs on to the usage and rock
       values from this context. This will be called when the Dialog
       operation is completed. */
    var callback = function(ref) {
        if (gli_selectref)
            return;
        ui_disabled = false;
        event_generation += 1;
        var fref = null;
        if (ref) {
            fref = gli_new_fileref(ref.filename, usage, rock, ref);
        }
        if (window.GiDispa)
            GiDispa.prepare_resume(fref);
        VM.resume();
    }

    try {
        var gameid = '';
        if (filetype == Const.fileusage_SavedGame)
            gameid = VM.get_signature();
        Dialog.open(writable, filetypename, gameid, callback);
    }
    catch (ex) {
        GlkOte.log('Unable to select file: ' + ex);
        return null;
    }

    ui_disabled = true;
    gli_selectref = null;
    return DidNotReturn;
}

function glk_fileref_destroy(fref) {
    if (!fref)
        throw('glk_fileref_destroy: invalid fileref');
    gli_delete_fileref(fref);
}

function glk_fileref_iterate(fref, rockref) {
    if (!fref)
        fref = gli_filereflist;
    else
        fref = fref.next;

    if (fref) {
        if (rockref)
            rockref.set_value(fref.rock);
        return fref;
    }

    if (rockref)
        rockref.set_value(0);
    return null;
}

function glk_fileref_get_rock(fref) {
    if (!fref)
        throw('glk_fileref_get_rock: invalid fileref');
    return fref.rock;
}

function glk_fileref_delete_file(fref) {
    if (!fref)
        throw('glk_fileref_delete_file: invalid fileref');
    Dialog.file_remove_ref(fref.ref);
}

function glk_fileref_does_file_exist(fref) {
    if (!fref)
        throw('glk_fileref_does_file_exist: invalid fileref');
    if (Dialog.file_ref_exists(fref.ref))
        return 1;
    else
        return 0;
}

function glk_fileref_create_from_fileref(usage, oldfref, rock) {
    if (!oldfref)
        throw('glk_fileref_create_from_fileref: invalid fileref');
    
    var fref = gli_new_fileref(oldfref.filename, usage, rock, null);
    return fref;
}

function glk_put_char(ch) {
    gli_put_char(gli_currentstr, ch & 0xFF);
}

function glk_put_char_stream(str, ch) {
    gli_put_char(str, ch & 0xFF);
}

function glk_put_string(val) {
    glk_put_jstring_stream(gli_currentstr, val, true);
}

function glk_put_string_stream(str, val) {
    glk_put_jstring_stream(str, val, true);
}

function glk_put_buffer(arr) {
    arr = TrimArrayToBytes(arr);
    gli_put_array(gli_currentstr, arr, true);
}

function glk_put_buffer_stream(str, arr) {
    arr = TrimArrayToBytes(arr);
    gli_put_array(str, arr, true);
}

function glk_set_style(val) {
    gli_set_style(gli_currentstr, val);
}

function glk_set_style_stream(str, val) {
    gli_set_style(str, val);
}

function glk_get_char_stream(str) {
    if (!str)
        throw('glk_get_char_stream: invalid stream');
    return gli_get_char(str, false);
}

function glk_get_line_stream(str, buf) {
    if (!str)
        throw('glk_get_line_stream: invalid stream');
    return gli_get_line(str, buf, false);
}

function glk_get_buffer_stream(str, buf) {
    if (!str)
        throw('glk_get_buffer_stream: invalid stream');
    return gli_get_buffer(str, buf, false);
}

function glk_char_to_lower(val) {
    if (val >= 0x41 && val <= 0x5A)
        return val + 0x20;
    if (val >= 0xC0 && val <= 0xDE && val != 0xD7)
        return val + 0x20;
    return val;
}

function glk_char_to_upper(val) {
    if (val >= 0x61 && val <= 0x7A)
        return val - 0x20;
    if (val >= 0xE0 && val <= 0xFE && val != 0xF7)
        return val - 0x20;
    return val;
}

/* Style hints are not supported. We will use the new style system. */
function glk_stylehint_set(wintype, styl, hint, value) { }
function glk_stylehint_clear(wintype, styl, hint) { }
function glk_style_distinguish(win, styl1, styl2) {
    return 0;
}
function glk_style_measure(win, styl, hint, resultref) {
    if (resultref)
        resultref.set_value(0);
    return 0;
}

function glk_select(eventref) {
    gli_selectref = eventref;
    return DidNotReturn;
}

function glk_select_poll(eventref) {
    /* Because the Javascript interpreter is single-threaded, the
       gli_timer_callback function cannot have run since the last
       glk_select call. */

    eventref.set_field(0, Const.evtype_None);
    eventref.set_field(1, null);
    eventref.set_field(2, 0);
    eventref.set_field(3, 0);

    if (gli_timer_interval && !(gli_timer_id === null)) {
        var now = Date.now();
        if (now - gli_timer_started > gli_timer_interval) {
            /* We're past the timer interval, even though the callback
               hasn't run. Let's pretend it has, reset it, and return
               a timer event. */
            clearTimeout(gli_timer_id);
            gli_timer_id = setTimeout(gli_timer_callback, gli_timer_interval);
            gli_timer_started = Date.now();

            eventref.set_field(0, Const.evtype_Timer);
        }
    }
}

function glk_request_line_event(win, buf, initlen) {
    if (!win)
        throw('glk_request_line_event: invalid window');
    if (win.char_request || win.line_request)
        throw('glk_request_line_event: window already has keyboard request');

    if (win.type == Const.wintype_TextBuffer 
        || win.type == Const.wintype_TextGrid) {
        if (initlen) {
            /* This will be copied into the next update. */
            var ls = buf.slice(0, initlen);
            if (!current_partial_outputs)
                current_partial_outputs = {};
            current_partial_outputs[win.disprock] = ByteArrayToString(ls);
        }
        win.line_request = true;
        win.line_request_uni = false;
        win.input_generation = event_generation;
        win.linebuf = buf;
        if (window.GiDispa)
            GiDispa.retain_array(buf);
    }
    else {
        throw('glk_request_line_event: window does not support keyboard input');
    }
}

function glk_cancel_line_event(win, eventref) {
    if (!win)
        throw('glk_cancel_line_event: invalid window');

    if (!win.line_request) {
        if (eventref) {
            eventref.set_field(0, Const.evtype_None);
            eventref.set_field(1, null);
            eventref.set_field(2, 0);
            eventref.set_field(3, 0);
        }
        return;
    }

    var input = "";
    var ix, val;

    if (current_partial_inputs) {
        val = current_partial_inputs[win.disprock];
        if (val) 
            input = val;
    }

    if (input.length > win.linebuf.length)
        input = input.slice(0, win.linebuf.length);

    ix = win.style;
    gli_set_style(win.str, Const.style_Input);
    gli_window_put_string(win, input+"\n");
    if (win.echostr)
        glk_put_jstring_stream(win.echostr, input+"\n");
    gli_set_style(win.str, ix);

    for (ix=0; ix<input.length; ix++)
        win.linebuf[ix] = input.charCodeAt(ix);

    if (eventref) {
        eventref.set_field(0, Const.evtype_LineInput);
        eventref.set_field(1, win);
        eventref.set_field(2, input.length);
        eventref.set_field(3, 0);
    }

    if (window.GiDispa)
        GiDispa.unretain_array(win.linebuf);
    win.line_request = false;
    win.line_request_uni = false;
    win.input_generation = null;
    win.linebuf = null;
}

function glk_request_char_event(win) {
    if (!win)
        throw('glk_request_char_event: invalid window');
    if (win.char_request || win.line_request)
        throw('glk_request_char_event: window already has keyboard request');

    if (win.type == Const.wintype_TextBuffer 
        || win.type == Const.wintype_TextGrid) {
        win.char_request = true;
        win.char_request_uni = false;
        win.input_generation = event_generation;
    }
    else {
        throw('glk_request_char_event: window does not support keyboard input');
    }
}

function glk_cancel_char_event(win) {
    if (!win)
        throw('glk_cancel_char_event: invalid window');

    win.char_request = false;
    win.char_request_uni = false;
}

function glk_request_mouse_event(win) {
   if (!win)
        throw('glk_request_mouse_event: invalid window');
   /* Not supported. */
}

function glk_cancel_mouse_event(win) {
   if (!win)
        throw('glk_cancel_mouse_event: invalid window');
   /* Not supported. */
}

function glk_request_timer_events(msec) {
    if (!(gli_timer_id === null)) {
        clearTimeout(gli_timer_id);
        gli_timer_id = null;
        gli_timer_started = null;
    }

    if (!msec) {
        gli_timer_interval = null;
    }
    else {
        gli_timer_interval = msec;
        gli_timer_id = setTimeout(gli_timer_callback, gli_timer_interval);
        gli_timer_started = Date.now();
    }
}

/* Graphics functions are not currently supported. */

function glk_image_get_info(imgid, widthref, heightref) {
    if (widthref)
        widthref.set_value(0);
    if (heightref)
        heightref.set_value(0);
    return 0;
}

function glk_image_draw(win, imgid, val1, val2) {
    if (!win)
        throw('glk_image_draw: invalid window');
    return 0;
}

function glk_image_draw_scaled(win, imgid, val1, val2, width, height) {
    if (!win)
        throw('glk_image_draw_scaled: invalid window');
    return 0;
}

function glk_window_flow_break(win) {
    if (!win)
        throw('glk_window_flow_break: invalid window');
}

function glk_window_erase_rect(win, left, top, width, height) {
    if (!win)
        throw('glk_window_erase_rect: invalid window');
}

function glk_window_fill_rect(win, color, left, top, width, height) {
    if (!win)
        throw('glk_window_fill_rect: invalid window');
}

function glk_window_set_background_color(win, color) {
    if (!win)
        throw('glk_window_set_background_color: invalid window');
}


function glk_schannel_iterate(schan, rockref) {
    if (!schan)
        schan = gli_schannellist;
    else
        schan = schan.next;

    if (schan) {
        if (rockref)
            rockref.set_value(schan.rock);
        return schan;
    }

    if (rockref)
        rockref.set_value(0);
    return null;
}

function glk_schannel_get_rock(schan) {
    if (!schan)
        throw('glk_schannel_get_rock: invalid schannel');
    return schan.rock;
}

function glk_schannel_create(rock) {
    return null;
}

function glk_schannel_destroy(schan) {
    throw('glk_schannel_destroy: invalid schannel');
}

function glk_schannel_play(schan, sndid) {
    throw('glk_schannel_play: invalid schannel');
}

function glk_schannel_play_ext(schan, sndid, repeats, notify) {
    throw('glk_schannel_play_ext: invalid schannel');
}

function glk_schannel_stop(schan) {
    throw('glk_schannel_stop: invalid schannel');
}

function glk_schannel_set_volume(schan, vol) {
    throw('glk_schannel_set_volume: invalid schannel');
}

function glk_sound_load_hint(sndid, flag) {
}

function glk_set_hyperlink(val) {
    gli_set_hyperlink(gli_currentstr, val);
}

function glk_set_hyperlink_stream(str, val) {
    gli_set_hyperlink(str, val);
}

function glk_request_hyperlink_event(win) {
    if (!win)
        throw('glk_request_hyperlink_event: invalid window');
    if (win.type == Const.wintype_TextBuffer 
        || win.type == Const.wintype_TextGrid) {
        win.hyperlink_request = true;
    }
}

function glk_cancel_hyperlink_event(win) {
    if (!win)
        throw('glk_cancel_hyperlink_event: invalid window');
    if (win.type == Const.wintype_TextBuffer 
        || win.type == Const.wintype_TextGrid) {
        win.hyperlink_request = true;
    }
}

function glk_buffer_to_lower_case_uni(arr, numchars) {
    var ix, jx, pos, val, origval;
    var arrlen = arr.length;
    var src = arr.slice(0, numchars);

    if (arrlen < numchars)
        throw('buffer_to_lower_case_uni: numchars exceeds array length');

    pos = 0;
    for (ix=0; ix<numchars; ix++) {
        origval = src[ix];
        val = unicode_lower_table[origval];
        if (val === undefined) {
            arr[pos] = origval;
            pos++;
        }
        else if (!(val instanceof Array)) {
            arr[pos] = val;
            pos++;
        }
        else {
            for (jx=0; jx<val.length; jx++) {
                arr[pos] = val[jx];
                pos++;
            }
        }
    }

    /* in case we stretched the array */
    arr.length = arrlen;

    return pos;
}

function glk_buffer_to_upper_case_uni(arr, numchars) {
    var ix, jx, pos, val, origval;
    var arrlen = arr.length;
    var src = arr.slice(0, numchars);

    if (arrlen < numchars)
        throw('buffer_to_upper_case_uni: numchars exceeds array length');

    pos = 0;
    for (ix=0; ix<numchars; ix++) {
        origval = src[ix];
        val = unicode_upper_table[origval];
        if (val === undefined) {
            arr[pos] = origval;
            pos++;
        }
        else if (!(val instanceof Array)) {
            arr[pos] = val;
            pos++;
        }
        else {
            for (jx=0; jx<val.length; jx++) {
                arr[pos] = val[jx];
                pos++;
            }
        }
    }

    /* in case we stretched the array */
    arr.length = arrlen;

    return pos;
}

function glk_buffer_to_title_case_uni(arr, numchars, lowerrest) {
    var ix, jx, pos, val, origval;
    var arrlen = arr.length;
    var src = arr.slice(0, numchars);

    if (arrlen < numchars)
        throw('buffer_to_title_case_uni: numchars exceeds array length');

    pos = 0;

    if (numchars == 0)
        return 0;

    ix = 0;
    {
        origval = src[ix];
        val = unicode_title_table[origval];
        if (val === undefined) {
            arr[pos] = origval;
            pos++;
        }
        else if (!(val instanceof Array)) {
            arr[pos] = val;
            pos++;
        }
        else {
            for (jx=0; jx<val.length; jx++) {
                arr[pos] = val[jx];
                pos++;
            }
        }
    }
    
    if (!lowerrest) {
        for (ix=1; ix<numchars; ix++) {
            origval = src[ix];
            arr[pos] = origval;
            pos++;
        }
    }
    else {
        for (ix=1; ix<numchars; ix++) {
            origval = src[ix];
            val = unicode_lower_table[origval];
            if (val === undefined) {
                arr[pos] = origval;
                pos++;
            }
            else if (!(val instanceof Array)) {
                arr[pos] = val;
                pos++;
            }
            else {
                for (jx=0; jx<val.length; jx++) {
                    arr[pos] = val[jx];
                    pos++;
                }
            }
        }
    }

    /* in case we stretched the array */
    arr.length = arrlen;

    return pos;
}

function glk_put_char_uni(ch) {
    gli_put_char(gli_currentstr, ch);
}

function glk_put_string_uni(val) {
    glk_put_jstring_stream(gli_currentstr, val, false);
}

function glk_put_buffer_uni(arr) {
    gli_put_array(gli_currentstr, arr, false);
}

function glk_put_char_stream_uni(str, ch) {
    gli_put_char(str, ch);
}

function glk_put_string_stream_uni(str, val) {
    glk_put_jstring_stream(str, val, false);
}

function glk_put_buffer_stream_uni(str, arr) {
    gli_put_array(str, arr, false);
}

function glk_get_char_stream_uni(str) {
    if (!str)
        throw('glk_get_char_stream_uni: invalid stream');
    return gli_get_char(str, true);
}

function glk_get_buffer_stream_uni(str, buf) {
    if (!str)
        throw('glk_get_buffer_stream_uni: invalid stream');
    return gli_get_buffer(str, buf, true);
}

function glk_get_line_stream_uni(str, buf) {
    if (!str)
        throw('glk_get_line_stream_uni: invalid stream');
    return gli_get_line(str, buf, true);
}

function glk_stream_open_file_uni(fref, fmode, rock) {
    if (!fref)
        throw('glk_stream_open_file_uni: invalid fileref');

    var str;

    if (fmode != Const.filemode_Read 
        && fmode != Const.filemode_Write 
        && fmode != Const.filemode_ReadWrite 
        && fmode != Const.filemode_WriteAppend) 
        throw('glk_stream_open_file_uni: illegal filemode');

    if (fmode == Const.filemode_Read && !Dialog.file_ref_exists(fref.ref))
        throw('glk_stream_open_file_uni: file not found for reading: ' + fref.ref.filename);

    var content = null;
    if (fmode != Const.filemode_Write) {
        content = Dialog.file_read(fref.ref);
    }
    if (content == null) {
        content = [];
        if (fmode != Const.filemode_Read) {
            /* We just created this file. (Or perhaps we're in Write mode and
               we're truncating.) Write immediately, to create it and get the
               creation date right. */
            Dialog.file_write(fref.ref, '', true);
        }
    }

    str = gli_new_stream(strtype_File, 
        (fmode != Const.filemode_Write), 
        (fmode != Const.filemode_Read), 
        rock);
    str.unicode = true;
    str.ref = fref.ref;

    str.buf = content;
    str.buflen = 0xFFFFFFFF; /* enormous */
    if (fmode == Const.filemode_Write)
        str.bufeof = 0;
    else
        str.bufeof = content.length;
    if (fmode == Const.filemode_WriteAppend)
        str.bufpos = str.bufeof;
    else
        str.bufpos = 0;

    return str;
}

function glk_stream_open_memory_uni(buf, fmode, rock) {
    var str;

    if (fmode != Const.filemode_Read 
        && fmode != Const.filemode_Write 
        && fmode != Const.filemode_ReadWrite) 
        throw('glk_stream_open_memory: illegal filemode');

    str = gli_new_stream(strtype_Memory, 
        (fmode != Const.filemode_Write), 
        (fmode != Const.filemode_Read), 
        rock);
    str.unicode = true;

    if (buf) {
        str.buf = buf;
        str.buflen = buf.length;
        str.bufpos = 0;
        if (fmode == Const.filemode_Write)
            str.bufeof = 0;
        else
            str.bufeof = str.buflen;
        if (window.GiDispa)
            GiDispa.retain_array(buf);
    }

    return str;
}

function glk_request_char_event_uni(win) {
    if (!win)
        throw('glk_request_char_event: invalid window');
    if (win.char_request || win.line_request)
        throw('glk_request_char_event: window already has keyboard request');

    if (win.type == Const.wintype_TextBuffer 
        || win.type == Const.wintype_TextGrid) {
        win.char_request = true;
        win.char_request_uni = true;
    }
    else {
        throw('glk_request_char_event: window does not support keyboard input');
    }
}

function glk_request_line_event_uni(win, buf, initlen) {
    if (!win)
        throw('glk_request_line_event: invalid window');
    if (win.char_request || win.line_request)
        throw('glk_request_line_event: window already has keyboard request');

    if (win.type == Const.wintype_TextBuffer 
        || win.type == Const.wintype_TextGrid) {
        if (initlen) {
            /* This will be copied into the next update. */
            var ls = buf.slice(0, initlen);
            if (!current_partial_outputs)
                current_partial_outputs = {};
            current_partial_outputs[win.disprock] = UniArrayToString(ls);
        }
        win.line_request = true;
        win.line_request_uni = true;
        win.input_generation = event_generation;
        win.linebuf = buf;
        if (window.GiDispa)
            GiDispa.retain_array(buf);
    }
    else {
        throw('glk_request_line_event: window does not support keyboard input');
    }
}

/* End of Glk namespace function. Return the object which will
   become the Glk global. */
return {
    version: '0.2.0', /* GlkApi version */
    init : init,
    update : update,
    fatal_error : fatal_error,
    byte_array_to_string : ByteArrayToString,
    uni_array_to_string : UniArrayToString,
    Const : Const,
    RefBox : RefBox,
    RefStruct : RefStruct,
    DidNotReturn : DidNotReturn,
    call_may_not_return : call_may_not_return,

    glk_put_jstring : glk_put_jstring,
    glk_put_jstring_stream : glk_put_jstring_stream,

    glk_exit : glk_exit,
    glk_tick : glk_tick,
    glk_gestalt : glk_gestalt,
    glk_gestalt_ext : glk_gestalt_ext,
    glk_window_iterate : glk_window_iterate,
    glk_window_get_rock : glk_window_get_rock,
    glk_window_get_root : glk_window_get_root,
    glk_window_open : glk_window_open,
    glk_window_close : glk_window_close,
    glk_window_get_size : glk_window_get_size,
    glk_window_set_arrangement : glk_window_set_arrangement,
    glk_window_get_arrangement : glk_window_get_arrangement,
    glk_window_get_type : glk_window_get_type,
    glk_window_get_parent : glk_window_get_parent,
    glk_window_clear : glk_window_clear,
    glk_window_move_cursor : glk_window_move_cursor,
    glk_window_get_stream : glk_window_get_stream,
    glk_window_set_echo_stream : glk_window_set_echo_stream,
    glk_window_get_echo_stream : glk_window_get_echo_stream,
    glk_set_window : glk_set_window,
    glk_window_get_sibling : glk_window_get_sibling,
    glk_stream_iterate : glk_stream_iterate,
    glk_stream_get_rock : glk_stream_get_rock,
    glk_stream_open_file : glk_stream_open_file,
    glk_stream_open_memory : glk_stream_open_memory,
    glk_stream_close : glk_stream_close,
    glk_stream_set_position : glk_stream_set_position,
    glk_stream_get_position : glk_stream_get_position,
    glk_stream_set_current : glk_stream_set_current,
    glk_stream_get_current : glk_stream_get_current,
    glk_fileref_create_temp : glk_fileref_create_temp,
    glk_fileref_create_by_name : glk_fileref_create_by_name,
    glk_fileref_create_by_prompt : glk_fileref_create_by_prompt,
    glk_fileref_destroy : glk_fileref_destroy,
    glk_fileref_iterate : glk_fileref_iterate,
    glk_fileref_get_rock : glk_fileref_get_rock,
    glk_fileref_delete_file : glk_fileref_delete_file,
    glk_fileref_does_file_exist : glk_fileref_does_file_exist,
    glk_fileref_create_from_fileref : glk_fileref_create_from_fileref,
    glk_put_char : glk_put_char,
    glk_put_char_stream : glk_put_char_stream,
    glk_put_string : glk_put_string,
    glk_put_string_stream : glk_put_string_stream,
    glk_put_buffer : glk_put_buffer,
    glk_put_buffer_stream : glk_put_buffer_stream,
    glk_set_style : glk_set_style,
    glk_set_style_stream : glk_set_style_stream,
    glk_get_char_stream : glk_get_char_stream,
    glk_get_line_stream : glk_get_line_stream,
    glk_get_buffer_stream : glk_get_buffer_stream,
    glk_char_to_lower : glk_char_to_lower,
    glk_char_to_upper : glk_char_to_upper,
    glk_stylehint_set : glk_stylehint_set,
    glk_stylehint_clear : glk_stylehint_clear,
    glk_style_distinguish : glk_style_distinguish,
    glk_style_measure : glk_style_measure,
    glk_select : glk_select,
    glk_select_poll : glk_select_poll,
    glk_request_line_event : glk_request_line_event,
    glk_cancel_line_event : glk_cancel_line_event,
    glk_request_char_event : glk_request_char_event,
    glk_cancel_char_event : glk_cancel_char_event,
    glk_request_mouse_event : glk_request_mouse_event,
    glk_cancel_mouse_event : glk_cancel_mouse_event,
    glk_request_timer_events : glk_request_timer_events,
    glk_image_get_info : glk_image_get_info,
    glk_image_draw : glk_image_draw,
    glk_image_draw_scaled : glk_image_draw_scaled,
    glk_window_flow_break : glk_window_flow_break,
    glk_window_erase_rect : glk_window_erase_rect,
    glk_window_fill_rect : glk_window_fill_rect,
    glk_window_set_background_color : glk_window_set_background_color,
    glk_schannel_iterate : glk_schannel_iterate,
    glk_schannel_get_rock : glk_schannel_get_rock,
    glk_schannel_create : glk_schannel_create,
    glk_schannel_destroy : glk_schannel_destroy,
    glk_schannel_play : glk_schannel_play,
    glk_schannel_play_ext : glk_schannel_play_ext,
    glk_schannel_stop : glk_schannel_stop,
    glk_schannel_set_volume : glk_schannel_set_volume,
    glk_sound_load_hint : glk_sound_load_hint,
    glk_set_hyperlink : glk_set_hyperlink,
    glk_set_hyperlink_stream : glk_set_hyperlink_stream,
    glk_request_hyperlink_event : glk_request_hyperlink_event,
    glk_cancel_hyperlink_event : glk_cancel_hyperlink_event,
    glk_buffer_to_lower_case_uni : glk_buffer_to_lower_case_uni,
    glk_buffer_to_upper_case_uni : glk_buffer_to_upper_case_uni,
    glk_buffer_to_title_case_uni : glk_buffer_to_title_case_uni,
    glk_put_char_uni : glk_put_char_uni,
    glk_put_string_uni : glk_put_string_uni,
    glk_put_buffer_uni : glk_put_buffer_uni,
    glk_put_char_stream_uni : glk_put_char_stream_uni,
    glk_put_string_stream_uni : glk_put_string_stream_uni,
    glk_put_buffer_stream_uni : glk_put_buffer_stream_uni,
    glk_get_char_stream_uni : glk_get_char_stream_uni,
    glk_get_buffer_stream_uni : glk_get_buffer_stream_uni,
    glk_get_line_stream_uni : glk_get_line_stream_uni,
    glk_stream_open_file_uni : glk_stream_open_file_uni,
    glk_stream_open_memory_uni : glk_stream_open_memory_uni,
    glk_request_char_event_uni : glk_request_char_event_uni,
    glk_request_line_event_uni : glk_request_line_event_uni
};

}();

/* End of Glk library. */
