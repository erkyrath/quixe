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

/* The VM interface object. */
var VM = null;

/* Initialize the library, initialize the VM, and set it running. (It will 
   run until the first glk_select() or glk_exit() call.)

   The argument must be an appropriate VM interface object. (For example, 
   Quixe.) It must have init() and resume() methods. 
*/
function init(vm_api) {
    VM = vm_api;
    if (window.GiDispa)
        GiDispa.set_vm(VM);
    VM.init();
}

function update() {
    var win, text, el;

    //### replace with GlkOte work
    for (win=gli_windowlist; win; win=win.next) {
        if (win.type == Const.wintype_TextBuffer) {
            text = win.accum.join("");
            if (text.length) {
                qlog("### update text: " + text.length + " chars: " + text);
                win.accum.length = 0;
                el = document.getElementById('story');
                el.appendChild(document.createTextNode(text));
            }
        }
    }
}

/* All the numeric constants used by the Glk interface. We push these into
   an object, for tidiness. */

var Const = {
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
      stylehint_just_RightFlush : 3,
};

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
   might block or never return. True for glk_exit() and glk_select().
*/
function call_may_not_return(id) {
    if (id == 1 || id == 192)
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
var content_box = null; //###?

/* Beginning of linked list of streams. */
var gli_streamlist = null;
/* Beginning of linked list of filerefs. */
var gli_filereflist = null;

/* The current output stream. */
var gli_currentstr = null;

function gli_new_window(type, rock) {
    var win = {};
    win.type = type;
    win.rock = rock;
    win.disprock = undefined;

    win.parent = null;
    win.str = gli_stream_open_window(win);
    win.echostr = null;

    switch (win.type) {
    case Const.wintype_TextBuffer:
        win.accum = [];
        break;
    }

    win.prev = null;
    win.next = gli_windowlist;
    gli_windowlist = win;
    if (win.next)
        win.next.prev = win;

    if (window.GiDispa)
        GiDispa.class_register('window', win);

    return win;
}

function gli_delete_window(win) {
    var prev, next;

    if (window.GiDispa)
        GiDispa.class_unregister('window', win);
    
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
    switch (win.type) {
    case Const.wintype_TextBuffer:
        win.accum.push(val);
        break;
    case Const.wintype_TextGrid:
        //###
        break;
    }
}

function gli_new_stream(type, readable, writable, rock) {
    var str = {};
    str.type = type;
    str.rock = rock;
    str.disprock = undefined;

    str.unicode = false;
    str.win = null;
    str.file = null;
    str.buf = null;
    str.bufpos = 0;
    str.buflen = 0;
    str.bufeof = 0;

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
    str.win = null;
    str.file = null;
}

function gli_stream_open_window(win) {
    var str;
    str = gli_new_stream(strtype_Window, false, true, 0);
    str.unicode = true;
    str.win = win;
    return str;
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
    case strtype_File:
        throw('gli_put_char: file streams not supported');
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
    case strtype_File:
        throw('gli_put_array: file streams not supported');
    }
}

function gli_stream_fill_result(str, result) {
    if (!result)
        return;
    result.set_field(0, str.readcount);
    result.set_field(1, str.writecount);
}

function glk_put_jstring(val) {
    glk_put_jstring_stream(gli_currentstr, val);
}

function glk_put_jstring_stream(str, val) {
    var ix, len;

    if (!str || !str.writable)
        throw('gli_put_jstring: invalid stream');

    str.writecount += val.length;
    
    switch (str.type) {
    case strtype_Memory:
        len = val.length;
        if (len > str.buflen-str.bufpos)
            len = str.buflen-str.bufpos;
        if (str.unicode) {
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
            throw('gli_put_jstring: window has pending line request');
        gli_window_put_string(str.win, val);
        if (str.win.echostr)
            glk_put_jstring_stream(str.win.echostr, val);
        break;
    case strtype_File:
        throw('gli_put_jstring: file streams not supported');
    }
}

/* The catalog of Glk API functions. */

function glk_exit() {
    //### set a library-exited flag?
    return DidNotReturn;
}

function glk_tick() {
    /* Do nothing. */
}

function glk_gestalt(a1, a2) { /*###*/ }
function glk_gestalt_ext(a1, a2, a3) { /*###*/ }

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
        box = content_box;
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
    //#### subtype data

    if (!splitwin) {
        gli_rootwin = newwin;
        //### gli_window_rearrange(newwin, box);
    }
    else {
        /* create pairwin, with newwin as the key */
        pairwin = gli_new_window(Const.wintype_Pair, 0);
        //#### subtype data

        //####

        //### gli_window_rearrange(pairwin, box);
    }

    return newwin;
}

function glk_window_close(a1, a2) { /*###*/ }
function glk_window_get_size(a1, a2, a3) { /*###*/ }
function glk_window_set_arrangement(a1, a2, a3, a4) { /*###*/ }
function glk_window_get_arrangement(a1, a2, a3, a4) { /*###*/ }

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

function glk_window_clear(a1) { /*###*/ }
function glk_window_move_cursor(a1, a2, a3) { /*###*/ }
function glk_window_get_stream(a1) { /*###*/ }
function glk_window_set_echo_stream(a1, a2) { /*###*/ }
function glk_window_get_echo_stream(a1) { /*###*/ }

function glk_set_window(win) {
    if (!win)
        gli_currentstr = null;
    else
        gli_currentstr = win.str;
}

function glk_window_get_sibling(a1) { /*###*/ }

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
    throw('glk_stream_open_file: file streams not supported');
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

    gli_stream_fill_result(str, result);
    gli_delete_stream(str);
}

function glk_stream_set_position(a1, a2, a3) { /*###*/ }
function glk_stream_get_position(a1) { /*###*/ }

function glk_stream_set_current(str) {
    gli_currentstr = str;
}

function glk_stream_get_current() {
    return gli_currentstr;
}

function glk_fileref_create_temp(a1, a2) { /*###*/ }
function glk_fileref_create_by_name(a1, a2, a3) { /*###*/ }
function glk_fileref_create_by_prompt(a1, a2, a3) { /*###*/ }
function glk_fileref_destroy(a1) { /*###*/ }
function glk_fileref_iterate(a1, a2) { /*###*/ }
function glk_fileref_get_rock(a1) { /*###*/ }
function glk_fileref_delete_file(a1) { /*###*/ }
function glk_fileref_does_file_exist(a1) { /*###*/ }
function glk_fileref_create_from_fileref(a1, a2, a3) { /*###*/ }

function glk_put_char(ch) {
    gli_put_char(gli_currentstr, ch & 0xFF);
}

function glk_put_char_stream(str, ch) {
    gli_put_char(str, ch & 0xFF);
}

function glk_put_string(arr) {
    arr = TrimArrayToBytes(arr);
    gli_put_array(gli_currentstr, arr, true);
}

function glk_put_string_stream(str, arr) {
    arr = TrimArrayToBytes(arr);
    gli_put_array(str, arr, true);
}

// function glk_put_buffer(arr) { }
glk_put_buffer = glk_put_string;
// function glk_put_buffer_stream(str, arr) { }
glk_put_buffer_stream = glk_put_string_stream;

function glk_set_style(a1) { /*###*/ }
function glk_set_style_stream(a1, a2) { /*###*/ }
function glk_get_char_stream(a1) { /*###*/ }
function glk_get_line_stream(a1, a2) { /*###*/ }
function glk_get_buffer_stream(a1, a2) { /*###*/ }

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

function glk_stylehint_set(a1, a2, a3, a4) { /*###*/ }
function glk_stylehint_clear(a1, a2, a3) { /*###*/ }
function glk_style_distinguish(a1, a2, a3) { /*###*/ }
function glk_style_measure(a1, a2, a3, a4) { /*###*/ }
function glk_select(a1) { /*###*/ }
function glk_select_poll(a1) { /*###*/ }
function glk_request_line_event(a1, a2, a3) { /*###*/ }
function glk_cancel_line_event(a1, a2) { /*###*/ }
function glk_request_char_event(a1) { /*###*/ }
function glk_cancel_char_event(a1) { /*###*/ }
function glk_request_mouse_event(a1) { /*###*/ }
function glk_cancel_mouse_event(a1) { /*###*/ }
function glk_request_timer_events(a1) { /*###*/ }
function glk_image_get_info(a1, a2, a3) { /*###*/ }
function glk_image_draw(a1, a2, a3, a4) { /*###*/ }
function glk_image_draw_scaled(a1, a2, a3, a4, a5, a6) { /*###*/ }
function glk_window_flow_break(a1) { /*###*/ }
function glk_window_erase_rect(a1, a2, a3, a4, a5) { /*###*/ }
function glk_window_fill_rect(a1, a2, a3, a4, a5, a6) { /*###*/ }
function glk_window_set_background_color(a1, a2) { /*###*/ }
function glk_schannel_iterate(a1, a2) { /*###*/ }
function glk_schannel_get_rock(a1) { /*###*/ }
function glk_schannel_create(a1) { /*###*/ }
function glk_schannel_destroy(a1) { /*###*/ }
function glk_schannel_play(a1, a2) { /*###*/ }
function glk_schannel_play_ext(a1, a2, a3, a4) { /*###*/ }
function glk_schannel_stop(a1) { /*###*/ }
function glk_schannel_set_volume(a1, a2) { /*###*/ }
function glk_sound_load_hint(a1, a2) { /*###*/ }
function glk_set_hyperlink(a1) { /*###*/ }
function glk_set_hyperlink_stream(a1, a2) { /*###*/ }
function glk_request_hyperlink_event(a1) { /*###*/ }
function glk_cancel_hyperlink_event(a1) { /*###*/ }
function glk_buffer_to_lower_case_uni(a1, a2) { /*###*/ }
function glk_buffer_to_upper_case_uni(a1, a2) { /*###*/ }
function glk_buffer_to_title_case_uni(a1, a2, a3) { /*###*/ }

function glk_put_char_uni(ch) {
    gli_put_char(gli_currentstr, ch);
}

function glk_put_string_uni(arr) {
    gli_put_array(gli_currentstr, arr, false);
}

// function glk_put_buffer_uni(a1) { }
glk_put_buffer_uni = glk_put_string_uni;

function glk_put_char_stream_uni(str, ch) {
    gli_put_char(str, ch);
}

function glk_put_string_stream_uni(str, arr) {
    gli_put_array(str, arr, false);
}

// function glk_put_buffer_stream_uni(str, arr) { }
glk_put_buffer_stream_uni = glk_put_string_stream_uni;

function glk_get_char_stream_uni(a1) { /*###*/ }
function glk_get_buffer_stream_uni(a1, a2) { /*###*/ }
function glk_get_line_stream_uni(a1, a2) { /*###*/ }

function glk_stream_open_file_uni(fref, fmode, rock) {
    throw('glk_stream_open_file_uni: file streams not supported');
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

function glk_request_char_event_uni(a1) { /*###*/ }
function glk_request_line_event_uni(a1, a2, a3) { /*###*/ }

/* ### change to a namespace */
Glk = {
    init : init,
    update : update,
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
    glk_request_line_event_uni : glk_request_line_event_uni,
};

