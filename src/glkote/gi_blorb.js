'use strict';

/* Blorb -- a Blorb file decoder for GlkOte
 * Designed by Andrew Plotkin <erkyrath@eblong.com>
 * <http://eblong.com/zarf/glk/glkote.html>
 *
 * This library is really more general than the name implies. It
 * can load resources from a Blorb file (given as a byte array), but
 * it can also store an arbitrary collection of resources (given as
 * JS objects). The GlkOte library (and other interpreter libraries)
 * can then access the resources through the Blorb API.
 *
 * This means it is possible to store your resource info as JSON
 * and allow the interpreter to load it directly, with no Blorb decoding
 * necessary.
 *
 * Library API:
 *
 * Blorb.init(data, opts): Read the data and extract the resources.
 *   Options:
 *   - format: The data format. See below.
 *   - retainuses: Which usage types to retain data (chunk.content)
 *     for.
 *
 *   (Note: All of the calls below return null if a resource or field
 *   could not be found. Also, they will all safely return null if the
 *   library has not been initialized.)
 *
 * Blorb.get_chunk(USAGE, NUM): Find a chunk by usage and number.
 *
 * Blorb.get_exec_data(TYPE): Find the 'exec' (executable game file)
 *   chunk and return it. If TYPE is given, this checks that the
 *   game file is of that type ('ZCOD' or 'GLUL'). If it does not match,
 *   returns null.
 *
 * Blorb.get_data_chunk(NUM): Find the 'data' chunk of the given 
 *   number from the Blorb file. The returned object looks like
 *   { data:[...], type:str, binary:bool }
 *
 * Blorb.get_metadata(FIELD): Return a metadata field (a string)
 *   from the iFiction <identification> and <bibliographic> sections.
 *
 * Blorb.get_cover_pict(): Return the number of the image resource
 *   which contains the cover art. If there is no cover art, this
 *   returns null.
 *
 * Blorb.get_image_info(NUM): Return an object describing an image,
 *   or null. The result will contain (at least) image (number), width,
 *   height, and type ('png' or 'jpeg').
 *
 * Blorb.get_debug_info(): Return an array containing debug info, or
 *   null.
 *
 * Blorb.get_image_url(NUM): Return a URL describing an image, or null.
 *   If the image comes from Blorb data, this will be a data: URL.
 *
 * --------------------------------------------------------------------
 *
 * * Loading a Blorb file
 *
 * Resources are indexed by *usage* and *number*. Usage is a string;
 * these currently include 'pict', 'snd', 'exec' (for executable
 * game file), 'data' (arbitrary data). The number can be any
 * non-negative integer. (The numbers do not have to be consecutive.)
 *
 * The pair (usage, usagenum) should be unique within the resource
 * collection.
 *
 * The Blorb spec (https://eblong.com/zarf/blorb/) uses the same structure.
 * When you load a Blorb file, the resources get imported directly.
 * (The usage codes aren't exactly the same, but you don't have to worry
 * about this.) To do this, call
 *
 *   Blorb.init(array, { format:'blorbbytes' });
 *
 * In this form, the resource info (i.e. the objects returned by
 * get_image_info()) will include Blorb data fields as well as
 * image, type, width, and height.
 *
 * Each chunk object will have a content field which contains an array
 * of bytes (integers 0-255) representing the resource data. These
 * arrays are extracted from the Blorb file.
 *
 * It's possible that you might not need all of these content arrays.
 * (GlkOte currently doesn't support sound, so you probably don't need to
 * save all the sound data.) You can customize this by providing
 * retainuses in the init() options. The retainuses option may be true
 * (keep all content arrays), false (keep none of them), or a dict
 * { pict:bool, snd:bool, data:bool, exec:bool }.
 *
 * * Non-Blorb use
 *
 * To provide resources directly, create a JS array that looks like:
 *
 * [
 *   {
 *     usage: 'pict',
 *     usagenum: 5,
 *     type: 'jpeg',  // 'jpeg' or 'png'
 *     imagesize: { width:100, height:200 },  // only for 'pict' resources
 *     url: URL,
 *     // you may alternately provide the image data as content:bytearray;
 *     // the library can convert that into a data: URL.
 *     alttext: 'Alternate text',  // optional
 *     coverimage: true  // if this is the cover image (one at most please)
 *   },
 *   {
 *     usage: 'exec',
 *     usagenum: 0,  // executable chunk must have num 0
 *     content: bytearray
 *   },
 *   {
 *     usage: 'data',
 *     usagenum: 1,
 *     binary: bool,
 *     content: bytearray
 *   },
 *   // ... more resources...
 * ]
 *
 * Then call
 *
 *   Blorb.init(resourcearray);
 *
 * If your data consists only of images, you can use this simpler format:
 *
 * {
 *   5: {  // usagenum is the object key
 *     // usage:'pict' is assumed
 *     type: 'jpeg',  // 'jpeg' or 'png'
 *     width:100, height:200,  // note separate fields
 *     url: URL,
 *     // you may alternately provide the image data as content:bytearray;
 *     // the library can convert that into a data: URL.
 *     alttext: 'Alternate text',  // optional
 *     coverimage: true  // if this is the cover image (one at most please)
 *   },
 *   // ... more resources...
 * }
 * 
 * For this key-map format, call
 *
 *   Blorb.init(map, { format:'infomap' });
 *
 * Note that when you are providing resource objects, any fields you add
 * will be passed through unchanged to get_image_info(). This means that
 * you can do a lot that this library wasn't really designed for! It
 * also means that the library internals are more exposed than my
 * crusty software-engineer soul desires. (E.g., the blorb fields
 * leaking out, as noted above.) Try not to cut yourself.
 *
 */

/* All state is contained in BlorbClass. */
var BlorbClass = function() {

var inited = false;
var metadata = {}; /* Title, author, etc -- loaded from Blorb */
var coverimageres = undefined; /* Image resource number of the cover art */
var debug_info = null; /* gameinfo.dbg file -- loaded from Blorb */
var blorbchunks = {}; /* Indexed by "USE:NUMBER" -- loaded from Blorb */

/* Load the resource data, according to opts.format.

   This also loads the IFID metadata into the metadata object, and
   caches other data we might want.
*/
function blorb_init(data, opts) {
    if (inited) {
        throw new Error('Blorb: already inited');
    }
    
    var format = null;
    var retainuses = true; // by default, retain all
    if (opts && opts.format !== undefined)
        format = opts.format;
    if (opts && opts.retainuses !== undefined)
        retainuses = opts.retainuses;

    if (format == 'infomap') {
        /* This is the old-style map of image resources. (See the
           image_info_map option in gi_load.js, or resourcemap.js as
           generated by blorbtool.py.)
           We will convert this into an array of chunks. */
        var chunkls = [];
        /* Map of { imagenum: { image, url, width, height, alttext } } */
        var pat_numeric = new RegExp('^[0-9]+$');
        for (var key in data) {
            /* Only consider keys that are simple integers. */
            if (!(''+key).match(pat_numeric)) {
                continue;
            }
            var chunk = Object.assign({}, data[key]);
            var usagenum = 1*key;
            if (chunk.image !== undefined && chunk.image != usagenum) {
                /* This is an error, but there's not much we can do except
                   ignore it. */
            }
            delete chunk.image;
            chunk.usage = 'pict';
            chunk.usagenum = usagenum;

            /* If separate width/height fields were provided, combine them
               into an imagesize object. */
            if (chunk.width !== undefined && chunk.height !== undefined) {
                chunk.imagesize = { width:chunk.width, height:chunk.height };
            }
            delete chunk.width;
            delete chunk.height;

            chunkls.push(chunk);
        }

        format = null;
        data = chunkls;
        /* Fall through to next case! */
    }
    
    if (!format) {
        /* An array of resources. */
        for (var obj of data) {
            var chunk = Object.assign({}, obj);
            var key = chunk.usage + ':' + chunk.usagenum;

            if (chunk.usage == 'pict' && chunk.coverimage) {
                if (coverimageres == null) {
                    coverimageres = chunk.usagenum;
                }
            }

            //TODO: The older resource-loader absolutized the URLs (chunk.url) here. I don't remember why. Important?
            
            blorbchunks[key] = chunk;
        }
        
        inited = true;
        return;
    }

    if (format != 'blorbbytes') {
        throw new Error('Blorb: unrecognized format');
    }

    var alttexts = {}; /* Indexed by "BLORBUSE:NUMBER" */

    /* Blorb data in an array of bytes. */

    var image = data;
    var len = image.length;
    var ix;
    var rindex = [];
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
                rindex.push( { blorbusage:chunkusage, usagenum:chunknum, blorbpos:chunkpos } );
            }
        }
        if (chunktype == "IFmd") {
            var arr = image.slice(pos, pos+chunklen);
            var dat = encode_utf8_text(arr);
            /* We shove the <identification> and <bibliographic> fields
               into a single object, which is crude but works fine
               in practice. */
            /* Note that if a tag appears twice, we prefer the first version.
               This should only matter for 'ifid'. */
            /* TODO: Handle this in some way that doesn't rely on jQuery. */
            var met = $('<metadata>').html(dat);
            var identels = met.find('identification').children();
            if (identels.length) {
                var el;
                for (ix=0; ix<identels.length; ix++) {
                    el = identels[ix];
                    var key = el.tagName.toLowerCase();
                    if (!metadata[key])
                        metadata[key] = el.textContent;
                }
            }
            var bibels = met.find('bibliographic').children();
            if (bibels.length) {
                var el;
                for (ix=0; ix<bibels.length; ix++) {
                    el = bibels[ix];
                    var key = el.tagName.toLowerCase();
                    if (!metadata[key])
                        metadata[key] = el.textContent;
                }
            }
        }
        if (chunktype == "Dbug") {
            /* Because this is enormous, we only save it if the option
               is set to use it. */
            if (all_options.debug_info_chunk) {
                var arr = image.slice(pos, pos+chunklen);
                debug_info = arr;
            }
        }
        if (chunktype == "Fspc") {
            var npos = pos;
            coverimageres = (image[npos+0] << 24) | (image[npos+1] << 16) | (image[npos+2] << 8) | (image[npos+3]);
        }
        if (chunktype == "RDes") {
            var npos = pos;
            var numentries = (image[npos+0] << 24) | (image[npos+1] << 16) | (image[npos+2] << 8) | (image[npos+3]);
            npos += 4;
            for (ix=0; ix<numentries; ix++) {
                var rdusage = String.fromCharCode.apply(this, image.slice(npos, npos+4));
                npos += 4;
                var rdnumber = (image[npos+0] << 24) | (image[npos+1] << 16) | (image[npos+2] << 8) | (image[npos+3]);
                npos += 4;
                var rdlen = (image[npos+0] << 24) | (image[npos+1] << 16) | (image[npos+2] << 8) | (image[npos+3]);
                npos += 4;
                var rdtext = encode_utf8_text(image.slice(npos, npos+rdlen));
                npos += rdlen;
                alttexts[rdusage+':'+rdnumber] = rdtext;
            }
        }

        pos += chunklen;
        if (pos & 1)
            pos++;
    }

    /* We don't want to retain the original Blorb image in memory; it's
       enormous. We'll split out the addressable chunks (those with
       usages) and retain those individually. Still enormous, but less
       so.

       (It's probably a waste to save the cover image -- that probably
       won't ever be used by the game. But it might be.) 
    */

    for (ix=0; ix<rindex.length; ix++) {
        var el = rindex[ix];
        pos = el.blorbpos;
        var chunktype = String.fromCharCode(image[pos+0], image[pos+1], image[pos+2], image[pos+3]);
        pos += 4;
        var chunklen = (image[pos+0] << 24) | (image[pos+1] << 16) | (image[pos+2] << 8) | (image[pos+3]);
        pos += 4;

        el.blorbtype = chunktype;
        el.blorblen = chunklen;

        if (el.blorbusage == 'Pict') {
            el.usage = 'pict';
            
            if (el.blorbtype == 'JPEG')
                el.type = 'jpeg';
            else if (el.blorbtype == 'PNG ')
                el.type = 'png';
            else
                el.type = '????';
        }
        else if (el.blorbusage == 'Snd ') {
            el.usage = 'sound';
        }
        else if (el.blorbusage == 'Exec') {
            el.usage = 'exec';
        }
        else if (el.blorbusage == 'Data') {
            el.usage = 'data';
            
            el.binary = false;
            // IFF sub-chunks count as binary.
            if (el.blorbtype == 'BINA' || el.blorbtype == 'FORM')
                el.binary = true;
        }
        else {
            el.usage = '????';
        }
        
        /* Add the alt-text, if available. */
        var rdtext = alttexts[el.blorbusage + ':' + el.usagenum];
        if (rdtext)
            el.alttext = rdtext;
        
        el.content = null;

        /* Copy the chunk data, but only if it matches retainuses. */
        var grab = true;
        if (retainuses === true || retainuses === false)
            grab = retainuses;
        else
            grab = retainuses[el.usage];

        if (grab) {
            if (chunktype == "FORM") {
                el.content = image.slice(pos-8, pos+chunklen);
            }
            else {
                el.content = image.slice(pos, pos+chunklen);
            }
        }
        
        blorbchunks[el.usage+':'+el.usagenum] = el;
    }

    inited = true;
}

function is_inited()
{
    return inited;
}

function get_library(val)
{
    /* This module doesn't rely on any others. */
    return null;
}

/* Return the game file chunk. Returns null if there is none.
   If type is provided ('ZCOD' or 'GLUL'), the game file is checked
   against that type; will return null if the game file is the wrong
   type.
*/
function get_exec_data(gametype)
{
    var chunk = blorbchunks['exec:0'];
    if (!chunk) {
        return null;
    }

    if (gametype && chunk.blorbtype != gametype) {
        return null;
    }

    return chunk.content;
}
    
/* Return a metadata field.
*/
function get_metadata(val) {
    return metadata[val];
}

/* Return the resource number of the image resource containing the
   cover art, or null if not available.
*/
function get_cover_pict() {
    return coverimageres;
}

/* Return the gameinfo.dbg file (as an array of bytes), if it was
   loaded.
*/
function get_debug_info() {
    return debug_info;
}

/* Return a chunk given its usage string and number. */
function get_chunk(usage, num) {
    var chunk = blorbchunks[usage+':'+num];
    if (!chunk) {
        return null;
    }
    return chunk;
}

/* Return information describing an image. This might be loaded from static
   data or from a Blorb file.
   
   The return value will be null or an object:
   { image:VAL, type:STRING, alttext:STRING, width:NUMBER, height:NUMBER }

   (The alttext and type may be absent if not supplied.)
*/
function get_image_info(val) {
    var chunk = blorbchunks['pict:'+val];
    if (!chunk) {
        return null;
    }
    
    /* Extract the image size, if we don't have it cached already.
       We could do this by creating an Image DOM element and measuring
       it, but that could be slow. Instead, we'll parse the PNG or
       JPEG data directly. It's easier than it sounds! */
    if (chunk.imagesize === undefined && chunk.content) {
        var imgsize = undefined;
        if (chunk.type == 'jpeg') {
            imgsize = find_dimensions_jpeg(chunk.content);
        }
        else if (chunk.type == 'png') {
            imgsize = find_dimensions_png(chunk.content);
        }
        if (imgsize) {
            chunk.imagesize = imgsize;
        }
    }
    
    var img = Object.assign({}, chunk); // copy
    
    /* Add image-specific fields that the caller will want. */
    img.image = val;
    if (chunk.imagesize) {
        img.width = chunk.imagesize.width;
        img.height = chunk.imagesize.height;
    }

    return img;
}

/* Return a URL representing an image. This might be loaded from static
   data or from a Blorb file.

   The return value will be null or a URL. It might be a "data:..." URL.
*/
function get_image_url(val) {
    var chunk = blorbchunks['pict:'+val];
    if (!chunk) {
        return null;
    }
    
    if (chunk.url) {
        return chunk.url;
    }
    if (chunk.dataurl) {
        return chunk.dataurl;
    }

    /* Convert content into a dataurl, if available. */
    var info = get_image_info(val);
    if (info && chunk.content) {
        var mimetype = 'application/octet-stream';
        if (chunk.type == 'jpeg')
            mimetype = 'image/jpeg';
        else if (chunk.type == 'png')
            mimetype = 'image/png';
        var b64dat = encode_base64(chunk.content);
        // Cache the dataurl for next time.
        chunk.dataurl = 'data:'+mimetype+';base64,'+b64dat;
        return chunk.dataurl;
    }

    /* Can't find anything. */
    return null;
}

/* Return the 'data' chunk with the given number, or null if there
   is no such chunk. (This is used by the glk_stream_open_resource()
   functions.)
*/
function get_data_chunk(val) {
    var chunk = blorbchunks['data:'+val];
    if (!chunk)
        return null;

    return { data:chunk.content, binary:chunk.binary };
}

/* Convert an array of numeric byte values into a base64 string. */
function encode_base64(image)
{
    /* There's a limit on how much can be piped into .apply() at a 
       time -- that is, JS interpreters choke on too many arguments
       in a function call. 16k is a conservative limit. */
    var blocks = [];
    var imglen = image.length;
    for (var ix = 0; ix < imglen; ix += 16384) {
        blocks.push(String.fromCharCode.apply(String, image.slice(ix, ix + 16384)));
    }
    
    return btoa(blocks.join(''));
};

/* Convert an array of numeric byte values (containing UTF-8 encoded text)
   into a string.
*/
function encode_utf8_text(arr) {
    var res = [];
    var ch;
    var pos = 0;

    while (pos < arr.length) {
        var val0, val1, val2, val3;
        if (pos >= arr.length)
            break;
        val0 = arr[pos];
        pos++;
        if (val0 < 0x80) {
            ch = val0;
        }
        else {
            if (pos >= arr.length)
                break;
            val1 = arr[pos];
            pos++;
            if ((val1 & 0xC0) != 0x80)
                break;
            if ((val0 & 0xE0) == 0xC0) {
                ch = (val0 & 0x1F) << 6;
                ch |= (val1 & 0x3F);
            }
            else {
                if (pos >= arr.length)
                    break;
                val2 = arr[pos];
                pos++;
                if ((val2 & 0xC0) != 0x80)
                    break;
                if ((val0 & 0xF0) == 0xE0) {
                    ch = (((val0 & 0xF)<<12)  & 0x0000F000);
                    ch |= (((val1 & 0x3F)<<6) & 0x00000FC0);
                    ch |= (((val2 & 0x3F))    & 0x0000003F);
                }
                else if ((val0 & 0xF0) == 0xF0) {
                    if (pos >= arr.length)
                        break;
                    val3 = arr[pos];
                    pos++;
                    if ((val3 & 0xC0) != 0x80)
                        break;
                    ch = (((val0 & 0x7)<<18)   & 0x1C0000);
                    ch |= (((val1 & 0x3F)<<12) & 0x03F000);
                    ch |= (((val2 & 0x3F)<<6)  & 0x000FC0);
                    ch |= (((val3 & 0x3F))     & 0x00003F);
                }
                else {
                    break;
                }
            }
        }
        res.push(ch);
    }

    return String.fromCharCode.apply(this, res);
}

/* Given a PNG file, extract its dimensions. Return a {width,height}
   object, or undefined on error. 
*/
function find_dimensions_png(arr) {
    var pos = 0;
    if (arr[0] != 0x89 || String.fromCharCode.apply(this, arr.slice(1,4)) != 'PNG') {
        //console.log('find_dimensions_png: PNG signature does not match');
        return undefined;
    }
    pos += 8;
    while (pos < arr.length) {
        var chunklen = (arr[pos+0] << 24) | (arr[pos+1] << 16) | (arr[pos+2] << 8) | (arr[pos+3]);
        pos += 4;
        var chunktype = String.fromCharCode.apply(this, arr.slice(pos,pos+4));
        pos += 4;
        if (chunktype == 'IHDR') {
            var res = {};
            res.width  = (arr[pos+0] << 24) | (arr[pos+1] << 16) | (arr[pos+2] << 8) | (arr[pos+3]);
            pos += 4;
            res.height = (arr[pos+0] << 24) | (arr[pos+1] << 16) | (arr[pos+2] << 8) | (arr[pos+3]);
            pos += 4;
            return res;
        }
        pos += chunklen;
        pos += 4; /* skip CRC */
    }

    //console.log('find_dimensions_png: no PNG header block found');
    return undefined;
}

/* Given a JPEG file, extract its dimensions. Return a {width,height}
   object, or undefined on error. 
*/
function find_dimensions_jpeg(arr) {
    var pos = 0;
    while (pos < arr.length) {
        if (arr[pos] != 0xFF) {
            //console.log('find_dimensions_jpeg: marker is not 0xFF');
            return undefined;
        }
        while (arr[pos] == 0xFF) 
            pos += 1;
        var marker = arr[pos];
        pos += 1;
        if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
            /* marker type has no data */
            continue;
        }
        var chunklen = (arr[pos+0] << 8) | (arr[pos+1]);
        if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC8) {
            if (chunklen < 7) {
                //console.log('find_dimensions_jpeg: SOF block is too small');
                return undefined;
            }
            var res = {};
            res.height = (arr[pos+3] << 8) | (arr[pos+4]);
            res.width  = (arr[pos+5] << 8) | (arr[pos+6]);
            return res;
        }
        pos += chunklen;
    }

    //console.log('find_dimensions_jpeg: no SOF marker found');
    return undefined;
}

/* End of Blorb namespace function. Return the object which will
   become the Blorb global. */
return {
    classname: 'Blorb',
    init: blorb_init,
    inited: is_inited,
    getlibrary: get_library,

    get_chunk: get_chunk,
    get_exec_data: get_exec_data,
    get_data_chunk: get_data_chunk,
    get_metadata: get_metadata,
    get_cover_pict: get_cover_pict,
    get_debug_info: get_debug_info,
    get_image_info: get_image_info,
    get_image_url: get_image_url
};

};

/* I'm breaking the rule about creating a predefined instance. This is
   only used by GiLoad, which always creates a new instance.
*/
// var Blorb = new BlorbClass();

// Node-compatible behavior
try { exports.BlorbClass = BlorbClass; } catch (ex) {};

/* End of Blorb library. */
