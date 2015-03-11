/* GiLoad -- a game-file loader for Quixe
 * Designed by Andrew Plotkin <erkyrath@eblong.com>
 * <http://eblong.com/zarf/glulx/quixe/>
 *
 * This Javascript library is copyright 2010-2015 by Andrew Plotkin.
 * It is distributed under the MIT license; see the "LICENSE" file.
 *
 * This library loads a game image (by one of several possible methods)
 * and then starts up the display layer and game engine. It also extracts
 * data from a Blorb image, if that's what's provided.
 *
 * (This code makes use of the jQuery library, which therefore must be
 * available.)
 *
 * When you are putting together a Quixe installation page, you call
 * GiLoad.load_run() to get the game started. You should do this in the
 * document's "onload" handler, or later. (If you call it before "onload"
 * time, it may not work.)
 *
 * You can do this in a couple of different ways:
 *
 * GiLoad.load_run(OPTIONS) -- load and run the game using the options
 *   passed as the argument. If OPTIONS is null or not provided, the
 *   global "game_options" object is considered. (The various options are
 *   described below.)
 *
 * GiLoad.load_run(OPTIONS, IMAGE, IMAGE_FORMAT) -- run the game with the
 *   given options. The IMAGE argument should be the game file itself
 *   (a glulx or blorb file). IMAGE_FORMAT describes how the game file
 *   is encoded:
 *     "base64": a base64-encoded binary file
 *     "raw": a binary file stored in a string
 *     "array": an array of (numeric) byte values
 *   Again, if OPTIONS is null, the global "game_options" object is
 *   considered.
 *
 * These are the game options. Most have default values, so you only have
 * to declare the ones you want to change.
 *
 *   use_query_story: If this is true, you (or the player) can use a
 *     "?story=..." URL parameter to load any game file. If it is false,
 *     this parameter is ignored. (default: true)
 *   set_page_title: If true, the loader will change the document title
 *     to describe the game being loaded. If false, the document title
 *     will be left alone. (default: true)
 *   default_story: The URL of the game file to load, if not otherwise
 *     provided.
 *   proxy_url: The URL of the web-app service which is used to convert
 *     binary data to Javascript, if the browser needs that. (default:
 *     http://zcode.appspot.com/proxy/)
 *   vm: The game engine interface object. (default: Quixe)
 *   io: The display layer interface object. (default: Glk)
 *
 *   You can also include any of the display options used by the GlkOte
 *   library, such as gameport, windowport, spacing, ...
 *   And also the interpreter options used by the Quixe library, such as
 *   rethrow_exceptions, ...
 *
 * GiLoad.find_data_chunk(NUM) -- this finds the Data chunk of the
 *   given number from the blorb file. The returned object looks like
 *   { data:[...], type:"..." } (where the type is TEXT or BINA).
 *   If there was no such chunk, or if the game was loaded from a non-
 *   blorb file, this returns undefined.
 *
 * GiLoad.get_metadata(FIELD) -- this returns a metadata field (a
 *   string) from the iFiction <bibliographic> section. If there is
 *   no such field, or if the game was loaded from a non-blorb
 *   file, this returns undefined.
 */

/* Put everything inside the GiLoad namespace. */
GiLoad = function() {

/* Start with the defaults. These can be modified later by the game_options
   defined in the HTML file.

   Note that the "vm" and "io" entries are not filled in here, because
   we don't know whether the Quixe or Glk libraries were loaded before
   this one. We'll fill them in at load_run() time.
*/
var all_options = {
    vm: null,              // default game engine (Quixe)
    io: null,              // default display layer (Glk)
    spacing: 4,            // default spacing between windows
    use_query_story: true, // use the ?story= URL parameter (if provided)
    default_story: null,   // story URL to use if not otherwise set
    set_page_title: true,  // set the window title to the game name
    proxy_url: 'http://zcode.appspot.com/proxy/'
};

var gameurl = null;  /* The URL we are loading. */
var metadata = {}; /* Title, author, etc -- loaded from Blorb */
var datachunks = {}; /* Indexed by filenum -- loaded from Blorb */

/* Begin the loading process. This is what you call to start a game;
   it takes care of starting the Glk and Quixe modules, when the game
   file is available.
*/
function load_run(optobj, image, image_format) {

    /* Set the default entries for the interface objects that come from
       other libraries. (If no such libraries have been loaded, then
       these do nothing, but game_options can still supply these entries.) */
    all_options.vm = window.Quixe;
    all_options.io = window.Glk;

    if (!optobj)
        optobj = window.game_options;
    if (optobj)
        jQuery.extend(all_options, optobj);

    /* The first question is, what's the game file URL? */

    gameurl = null;

    if (all_options.use_query_story) {
        /* Use ?story= URL parameter, if present and accepted. */
        var qparams = get_query_params();
        gameurl = qparams['story'];
    }

    if (!gameurl && image) {
        /* The story data is already loaded -- it's not an a URL at all.
           Decode it, and then fire it off. */
        GlkOte.log('### trying pre-loaded load (' + image_format + ')...');
        switch (image_format) {
        case 'base64':
            image = decode_base64(image);
            break;
        case 'raw':
            image = decode_text(image);
            break;
        case 'array':
            /* Leave image alone */
            break;
        default:
            all_options.io.fatal_error("Could not decode story file data: " + image_format);
            return;
        }

        start_game(image);
        return;
    }

    if (!gameurl) {
        /* Go with the "default_story" option parameter, if present. */
        gameurl = all_options.default_story;
    }

    if (!gameurl) {
        all_options.io.fatal_error("No story file specified!");
        return;
    }

    GlkOte.log('### gameurl: ' + gameurl); //###
    /* The gameurl is now known. (It should not change after this point.)
       The next question is, how do we load it in? */

    /* If an image file was passed in, we didn't use it. So we might as
       well free its memory at this point. */
    image = null;
    image_format = null;

    /* The logic of the following code is adapted from Parchment's
       file.js. It's probably obsolete at this point -- I suspect
       that binary_supported and crossorigin_supported will wind up
       true in all modern browsers. Why throw away code, though... */

    var xhr = new XMLHttpRequest(); /* ### not right on IE? */
    var binary_supported = (xhr.overrideMimeType !== undefined);
    /* I'm told that Opera's overrideMimeType() doesn't work, but
       I'm not inclined to worry about it these days. */
    var crossorigin_supported = (xhr.withCredentials !== undefined);
    xhr = null;

    var regex_urldomain = /^(file:|(\w+:)?\/\/[^\/?#]+)/;
    var page_domain = regex_urldomain.exec(location)[0];
    var data_exec = regex_urldomain.exec(gameurl);
    var is_relative = data_exec ? false : true;
    var data_domain = data_exec ? data_exec[0] : page_domain;

    var same_origin = (page_domain == data_domain);
    if (navigator.userAgent.match(/chrome/i) && data_domain == 'file:') {
        /* Chrome enforces a stricter same-origin policy for file: URLs --
           it doesn't want to trawl your hard drive for random files.
           Other browsers may pick this up someday, but for now, it's
           only Chrome. */
        same_origin = false;
    }

    /* Crude test for whether the URL is a Javascript file -- just
       check for a ".js" suffix. */
    var old_js_url = gameurl.match(/[.]js$/i);

    GlkOte.log('### is_relative=' + is_relative + ', same_origin=' + same_origin + ', binary_supported=' + binary_supported + ', crossorigin_supported=' + crossorigin_supported);

    if (old_js_url && same_origin) {
        /* Old-fashioned Javascript file -- the output of Parchment's
           zcode2js tool. When loaded and eval'ed, this will call
           a global function processBase64Zcode() with base64 data
           as the argument. */
        GlkOte.log('### trying old-fashioned load...');
        window.processBase64Zcode = function(val) {
            start_game(decode_base64(val));
        };
        jQuery.ajax(gameurl, {
                'type': 'GET',
                dataType: 'script',
                cache: true,
                error: function(jqxhr, textstatus, errorthrown) {
                    all_options.io.fatal_error("The story could not be loaded. (" + gameurl + "): Error " + textstatus + ": " + errorthrown);
                }
        });
        return;
    }

    if (old_js_url) {
        /* Javascript file in a different domain. We'll insert it as a <script>
           tag; that will force it to load, and invoke a processBase64Zcode()
           function as above. */
        GlkOte.log('### trying script load...');
        window.processBase64Zcode = function(val) {
            start_game(decode_base64(val));
        };
        var headls = $('head');
        if (!headls.length) {
            all_options.io.fatal_error("This page has no <head> element!");
            return;
        }
        var script = $('<script>',
            { src:gameurl, 'type':"text/javascript" });
        /* jQuery is now sensitive about this, and will not allow it as
          a Chrome work-around. We use a raw DOM method instead. */
        // headls.append(script);
        headls.get(0).appendChild(script.get(0));
        return;
    }

    if (binary_supported && same_origin) {
        /* We can do an Ajax GET of the binary data. */
        GlkOte.log('### trying binary load...');
        jQuery.ajax(gameurl, {
                'type': 'GET',
                    beforeSend: function(jqxhr, settings) {
                    /* This ensures that the data doesn't get decoded or
                       munged in any way. */
                    jqxhr.overrideMimeType('text/plain; charset=x-user-defined');
                },
                success: function(response, textstatus, errorthrown) {
                    start_game(decode_raw_text(response));
                },
                error: function(jqxhr, textstatus, errorthrown) {
                    all_options.io.fatal_error("The story could not be loaded. (" + gameurl + "): Error " + textstatus + ": " + errorthrown);
                }
        });
        return;
    }

    if (data_domain == 'file:') {
        /* All the remaining options go through the proxy. But the proxy
           can't get at the local hard drive, so it's hopeless.
           (This case occurs only on Chrome, with its restrictive
           same-origin-file: policy.) */
        all_options.io.fatal_error("The story could not be loaded. (" + gameurl + "): A local file cannot be sent to the proxy.");
        return;
    }

    /* All the remaining options go through the proxy. But the proxy doesn't
       understand relative URLs, so we absolutize it if necessary. */
    var absgameurl = gameurl;
    if (is_relative) {
        absgameurl = absolutize(gameurl);
        GlkOte.log('### absolutize ' + gameurl + ' to ' + absgameurl);
    }

    if (crossorigin_supported) {
        /* Either we can't load binary data, or the data is on a different
           domain. Either way, we'll go through the proxy, which will
           convert it to base64 for us. The proxy gives the right headers
           to make cross-origin Ajax work. */
        GlkOte.log('### trying proxy load... (' + all_options.proxy_url + ')');
        jQuery.ajax(all_options.proxy_url, {
                'type': 'GET',
                data: { encode: 'base64', url: absgameurl },
                error: function(jqxhr, textstatus, errorthrown) {
                    /* I would like to display the responseText here, but
                       most servers return a whole HTML page, and that doesn't
                       fit into fatal_error. */
                    all_options.io.fatal_error("The story could not be loaded. (" + gameurl + "): Error " + textstatus + ": " + errorthrown);
                },
                success: function(response, textstatus, errorthrown) {
                    start_game(decode_base64(response));
                }
        });
        return;
    }

    if (true) {
        /* Cross-origin Ajax isn't available. We can still use the proxy,
           but we'll have to insert a <script> tag to do it. */
        var fullurl = all_options.proxy_url + '?encode=base64&callback=processBase64Zcode&url=' + absgameurl;
        GlkOte.log('### trying proxy-script load... (' + fullurl + ')');
        window.processBase64Zcode = function(val) {
            start_game(decode_base64(val));
        };
        var headls = $('head');
        if (!headls.length) {
            all_options.io.fatal_error("This page has no <head> element!");
            return;
        }
        var script = $('<script>',
            { src:fullurl, 'type':"text/javascript" });
        headls.append(script);
        return;
    }

    all_options.io.fatal_error("The story could not be loaded. (" + gameurl + "): I don't know how to load this data.");
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

/* I learned this terrible trick for turning a relative URL absolute.
   It's supposed to work on all browsers, if you don't go mad.
   (This uses DOM methods rather than jQuery.)
*/
function absolutize(url) {
    var div = document.createElement('div');
    div.innerHTML = '<a></a>';
    div.firstChild.href = url;
    div.innerHTML = div.innerHTML;
    return div.firstChild.href;
}

/* Return a metadata field, or undefined if there is no such field
   (or if no metadata was loaded).
*/
function get_metadata(val) {
    return metadata[val];
}

/* Return the Data chunk with the given number, or undefined if there
   is no such chunk. (This is used by the glk_stream_open_resource()
   functions.)
*/
function find_data_chunk(val) {
    return datachunks[val];
}

/* Look through a Blorb file (provided as a byte array) and return the
   Glulx game file chunk (ditto). If no such chunk is found, returns
   null.

   This also loads the IFID metadata into the metadata object, and
   caches DATA chunks where we can reach them later.
*/
function unpack_blorb(image) {
    var len = image.length;
    var ix;
    var rindex = [];
    var result = null;
    var pos = 12;

    while (pos < len) {
        var chunktype = String.fromCharCode(image[pos+0], image[pos+1], image[pos+2], image[pos+3]);
        pos += 4;
        var chunklen = (image[pos+0] << 24) | (image[pos+1] << 16) | (image[pos+2] << 8) | (image[pos+3]);
        pos += 4;

        if (chunktype == "RIdx") {
            var npos = pos;
            var numchunks = (image[npos+0] << 24) | (image[npos+1] << 16) | (image[npos+2] << 8) | (image[npos+3]);
            npos += 4;
            for (ix=0; ix<numchunks; ix++) {
                var chunkusage = String.fromCharCode(image[npos+0], image[npos+1], image[npos+2], image[npos+3]);
                npos += 4;
                var chunknum = (image[npos+0] << 24) | (image[npos+1] << 16) | (image[npos+2] << 8) | (image[npos+3]);
                npos += 4;
                var chunkpos = (image[npos+0] << 24) | (image[npos+1] << 16) | (image[npos+2] << 8) | (image[npos+3]);
                npos += 4;
                rindex.push( { usage:chunkusage, num:chunknum, pos:chunkpos } );
            }
        }
        if (chunktype == "IFmd") {
            var arr = image.slice(pos, pos+chunklen);
            var dat = String.fromCharCode.apply(this, arr);
            var met = $('<metadata>').html(dat);
            var bibels = met.find('bibliographic').children();
            if (bibels.length) {
                var el;
                for (ix=0; ix<bibels.length; ix++) {
                    el = bibels[ix];
                    metadata[el.tagName.toLowerCase()] = el.textContent;
                }
            }
        }

        pos += chunklen;
        if (pos & 1)
            pos++;
    }

    for (ix=0; ix<rindex.length; ix++) {
        var el = rindex[ix];
        pos = el.pos;
        var chunktype = String.fromCharCode(image[pos+0], image[pos+1], image[pos+2], image[pos+3]);
        pos += 4;
        var chunklen = (image[pos+0] << 24) | (image[pos+1] << 16) | (image[pos+2] << 8) | (image[pos+3]);
        pos += 4;

        if (el.usage == "Exec" && el.num == 0 && chunktype == "GLUL") {
            result = image.slice(pos, pos+chunklen);
        }
        if (el.usage == "Data" && (chunktype == "TEXT" || chunktype == "BINA")) {
            datachunks[el.num] = { data:image.slice(pos, pos+chunklen), type:chunktype };
        }
        if (el.usage == "Data" && (chunktype == "FORM")) {
            datachunks[el.num] = { data:image.slice(pos-8, pos+chunklen), type:"BINA" };
        }
    }

    return result;
}

/* Convert a byte string into an array of numeric byte values. */
function decode_raw_text(str) {
    var arr = Array(str.length);
    var ix;
    for (ix=0; ix<str.length; ix++) {
        arr[ix] = str.charCodeAt(ix) & 0xFF;
    }
    return arr;
}

/* Convert a base64 string into an array of numeric byte values. Some
   browsers supply an atob() function that does this; on others, we
   have to implement decode_base64() ourselves.
*/
if (window.atob) {
    decode_base64 = function(base64data) {
        var data = atob(base64data);
        var image = Array(data.length);
        var ix;

        for (ix=0; ix<data.length; ix++)
            image[ix] = data.charCodeAt(ix);

        return image;
    }
}
else {
    /* No atob() in Internet Explorer, so we have to invent our own.
       This implementation is adapted from Parchment. */
    var b64decoder = (function() {
            var b64encoder = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
            var out = [];
            var ix;
            for (ix=0; ix<b64encoder.length; ix++)
                out[b64encoder.charAt(ix)] = ix;
            return out;
        })();

    decode_base64 = function(base64data) {
        var out = [];
        var c1, c2, c3, e1, e2, e3, e4;
        var i = 0, len = base64data.length;
        while (i < len) {
            e1 = b64decoder[base64data.charAt(i++)];
            e2 = b64decoder[base64data.charAt(i++)];
            e3 = b64decoder[base64data.charAt(i++)];
            e4 = b64decoder[base64data.charAt(i++)];
            c1 = (e1 << 2) + (e2 >> 4);
            c2 = ((e2 & 15) << 4) + (e3 >> 2);
            c3 = ((e3 & 3) << 6) + e4;
            out.push(c1, c2, c3);
        }
        if (e4 == 64)
            out.pop();
        if (e3 == 64)
            out.pop();
        return out;
    }
}

/* Start the game (after de-blorbing, if necessary).
   This is invoked by whatever callback received the loaded game file.
*/
function start_game(image) {
    if (image.length == 0) {
        all_options.io.fatal_error("No game file was loaded. (Zero-length response.)");
        return;
    }

    if (image[0] == 0x46 && image[1] == 0x4F && image[2] == 0x52 && image[3] == 0x4D) {
        try {
            image = unpack_blorb(image);
        }
        catch (ex) {
            all_options.io.fatal_error("Blorb file could not be parsed: " + ex);
            return;
        }
        if (!image) {
            all_options.io.fatal_error("Blorb file contains no Glulx game!");
            return;
        }
    }

    {
        var title = null;
        if (metadata)
            title = metadata.title;
        if (!title && gameurl)
            title = gameurl.slice(gameurl.lastIndexOf("/") + 1);
        if (!title)
            title = 'Game';

        if (!all_options.recording_label)
            all_options.recording_label = title;

        if (all_options.set_page_title)
            document.title = title + " - Quixe";
    }

    /* Pass the game image file along to the VM engine. */
    all_options.vm.prepare(image, all_options);

    /* Now fire up the display library. This will take care of starting
       the VM engine, once the window is properly set up. */
    all_options.io.init(all_options);
}

/* End of GiLoad namespace function. Return the object which will
   become the GiLoad global. */
return {
    load_run: load_run,
    find_data_chunk: find_data_chunk,
    get_metadata: get_metadata
};

}();

/* End of GiLoad library. */
