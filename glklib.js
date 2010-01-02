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
    this.get_fields = function() {
        return this.fields;
    }
}

/* Beginning of linked list of windows. */
var gli_windowlist = null;
var gli_rootwin = null;
var content_box = null; //###?

/* Beginning of linked list of streams. */
var gli_streamlist = null;
/* Beginning of linked list of filerefs. */
var gli_filereflist = null;

function gli_new_window(type, rock) {
    var win = {};
    win.type = type;
    win.rock = rock;
    win.disprock = undefined;

    win.parent = null;
    win.str = null; //### gli_stream_open_window(win);
    win.echostr = null;

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

function glk_exit() { /*###*/ }
function glk_tick() { /*###*/ }
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
function glk_set_window(a1) { /*###*/ }
function glk_window_get_sibling(a1) { /*###*/ }
function glk_stream_iterate(a1, a2) { /*###*/ }
function glk_stream_get_rock(a1) { /*###*/ }
function glk_stream_open_file(a1, a2, a3) { /*###*/ }
function glk_stream_open_memory(a1, a2, a3) { /*###*/ }
function glk_stream_close(a1, a2) { /*###*/ }
function glk_stream_set_position(a1, a2, a3) { /*###*/ }
function glk_stream_get_position(a1) { /*###*/ }
function glk_stream_set_current(a1) { /*###*/ }
function glk_stream_get_current() { /*###*/ }
function glk_fileref_create_temp(a1, a2) { /*###*/ }
function glk_fileref_create_by_name(a1, a2, a3) { /*###*/ }
function glk_fileref_create_by_prompt(a1, a2, a3) { /*###*/ }
function glk_fileref_destroy(a1) { /*###*/ }
function glk_fileref_iterate(a1, a2) { /*###*/ }
function glk_fileref_get_rock(a1) { /*###*/ }
function glk_fileref_delete_file(a1) { /*###*/ }
function glk_fileref_does_file_exist(a1) { /*###*/ }
function glk_fileref_create_from_fileref(a1, a2, a3) { /*###*/ }
function glk_put_char(a1) { /*###*/ }
function glk_put_char_stream(a1, a2) { /*###*/ }
function glk_put_string(a1) { /*###*/ }
function glk_put_string_stream(a1, a2) { /*###*/ }
function glk_put_buffer(a1) { /*###*/ }
function glk_put_buffer_stream(a1, a2) { /*###*/ }
function glk_set_style(a1) { /*###*/ }
function glk_set_style_stream(a1, a2) { /*###*/ }
function glk_get_char_stream(a1) { /*###*/ }
function glk_get_line_stream(a1, a2) { /*###*/ }
function glk_get_buffer_stream(a1, a2) { /*###*/ }
function glk_char_to_lower(a1) { /*###*/ }
function glk_char_to_upper(a1) { /*###*/ }
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
function glk_put_char_uni(a1) { /*###*/ }
function glk_put_string_uni(a1) { /*###*/ }
function glk_put_buffer_uni(a1) { /*###*/ }
function glk_put_char_stream_uni(a1, a2) { /*###*/ }
function glk_put_string_stream_uni(a1, a2) { /*###*/ }
function glk_put_buffer_stream_uni(a1, a2) { /*###*/ }
function glk_get_char_stream_uni(a1) { /*###*/ }
function glk_get_buffer_stream_uni(a1, a2) { /*###*/ }
function glk_get_line_stream_uni(a1, a2) { /*###*/ }
function glk_stream_open_file_uni(a1, a2, a3) { /*###*/ }
function glk_stream_open_memory_uni(a1, a2, a3) { /*###*/ }
function glk_request_char_event_uni(a1) { /*###*/ }
function glk_request_line_event_uni(a1, a2, a3) { /*###*/ }

/* ### change to a namespace */
Glk = {
    Const : Const,
    RefBox : RefBox,
    RefStruct : RefStruct,

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

