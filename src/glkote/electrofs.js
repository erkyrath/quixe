/* ElectroFS -- a Javascript load/save library for IF interfaces
 * Designed by Andrew Plotkin <erkyrath@eblong.com>
 * <http://eblong.com/zarf/glk/glkote.html>
 * 
 * This Javascript library is copyright 2016 by Andrew Plotkin.
 * It is distributed under the MIT license; see the "LICENSE" file.
 *
 * This is a (mostly-) drop-in replacement for dialog.js for the Electron.io
 * environment. It uses the Node.js "fs" and "path" packages to read and write
 * files, and the Electron.io "dialog" package to present file-selection
 * dialogs.
 *
 * The interface is similar to dialog.js, but not exactly the same. (Sorry!
 * The Atom/Electron API didn't exist when I write dialog.js, or I would
 * have come up with a cleaner abstraction.)
 *
 * This presents itself as a Dialog module. To distinguish it from dialog.js,
 * look at Dialog.streaming, which will be true for electrofs.js and false for
 * dialog.js.
 */

Dialog = function() {

const fs = require('fs-ext');
const path = require('path');
const buffer = require('buffer');
var userpath = require('electron').remote.app.getPath('userData');
var extfilepath = path.join(userpath, 'quixe-files');

/* We try to create a directory for external files at launch time.
   This will usually fail because there's already a directory there.
*/
try {
    fs.mkdirSync(extfilepath);
}
catch (ex) {}

/* Dialog.open(tosave, usage, gameid, callback) -- open a file-choosing dialog
 *
 * The "tosave" flag should be true for a save dialog, false for a load
 * dialog.
 *
 * The "usage" and "gameid" arguments are arbitrary strings which describe the
 * file. These filter the list of files displayed; the dialog will only list
 * files that match the arguments. Pass null to either argument (or both) to
 * skip filtering.
 *
 * The "callback" should be a function. This will be called with a fileref
 * argument (see below) when the user selects a file. If the user cancels the
 * selection, the callback will be called with a null argument.
*/
function dialog_open(tosave, usage, gameid, callback)
{
    const dialog = require('electron').remote.dialog;
    /*### title */
    var opts = {
        filters: filters_for_usage(usage)
    };
    var mainwin = require('electron').remote.getCurrentWindow();
    if (!tosave) {
        opts.properties = ['openFile'];
        dialog.showOpenDialog(mainwin, opts, function(ls) {
                if (!ls || !ls.length) {
                    callback(null);
                }
                else {
                    var ref = { filename:ls[0], usage:usage };
                    callback(ref);
                }
            });
    }
    else {
        dialog.showSaveDialog(mainwin, opts, function(path) {
                if (!path) {
                    callback(null);
                }
                else {
                    var ref = { filename:path, usage:usage };
                    callback(ref);
                }
            });
    }
}

/* Same as in glkapi.js. */
const filemode_Write = 0x01;
const filemode_Read = 0x02;
const filemode_ReadWrite = 0x03;
const filemode_WriteAppend = 0x05;

/* Construct a file-filter list for a given usage type. These lists are
   used by showOpenDialog and showSaveDialog, above. 
*/
function filters_for_usage(val)
{
    switch (val) {
    case 'data': 
        return [ { name: 'Glk Data File', extensions: ['glkdata'] } ];
    case 'save': 
        return [ { name: 'Glk Save File', extensions: ['glksave'] } ];
    case 'transcript': 
        return [ { name: 'Transcript File', extensions: ['txt'] } ];
    case 'command': 
        return [ { name: 'Command File', extensions: ['txt'] } ];
    default:
        return [];
    }
}

/* Dialog.file_construct_ref(filename, usage, gameid) -- create a fileref
 *
 * Create a fileref. This does not create a file; it's just a thing you can use
 * to read an existing file or create a new one. Any unspecified arguments are
 * assumed to be the empty string.
 */
function file_construct_ref(filename, usage, gameid)
{
    if (!filename)
        filename = '';
    if (!usage)
        usage = '';
    if (!gameid)
        gameid = '';
    var path = path.join(extfilepath, filename);
    var ref = { filename:path, usage:usage };
    return ref;
}

/* Dialog.file_ref_exists(ref) -- returns whether the file exists
 */
function file_ref_exists(ref)
{
    try {
        fs.accessSync(ref.filename, fs.F_OK);
        return true;
    }
    catch (ex) {
        return false;
    }
}

/* Dialog.file_remove_ref(ref) -- delete the file, if it exists
 */
function file_remove_ref(ref)
{
    try {
        fs.unlinkSync(ref.filename);
    }
    catch (ex) { }
}

/* Dialog.file_fopen(fmode, ref) -- open a file for reading or writing
 */
function file_fopen(fmode, ref)
{
    /* This object is analogous to a FILE* in C code. Yes, we're 
       reimplementing fopen() for Node.js. I'm not proud. Or tired. 
       The good news is, the logic winds up identical to that in
       the C libraries.
    */

    var fstream = {
        fmode: fmode,
        filename: ref.filename,
        fd: null
    };

    /* The spec says that Write, ReadWrite, and WriteAppend create the
       file if necessary. However, open(filename, "r+") doesn't create
       a file. So we have to pre-create it in the ReadWrite and
       WriteAppend cases. (We use "a" so as not to truncate.) */

    if (fmode == filemode_ReadWrite || fmode == filemode_WriteAppend) {
        try {
            var tempfd = fs.openSync(fstream.filename, "a");
            fs.closeSync(tempfd);
        }
        catch (ex) {
            GlkOte.log('file_fopen: failed to open ' + fstream.filename + ': ' + ex);
            return null;
        }
    }

    /* Another Unix quirk: in r+ mode, you're not supposed to flip from
       reading to writing or vice versa without doing an fseek. We will
       track the most recent operation (as lastop) -- Write, Read, or
       0 if either is legal next. */

    var modestr = null;
    switch (fmode) {
        case filemode_Write:
            modestr = "w";
            break;
        case filemode_Read:
            modestr = "r";
            break;
        case filemode_ReadWrite:
            modestr = "r+";
            break;
        case filemode_WriteAppend:
            /* Can't use "a" here, because then fseek wouldn't work.
               Instead we use "r+" and then fseek to the end. */
            modestr = "r+";
            break;
    }

    try {
        fstream.fd = fs.openSync(fstream.filename, modestr);
    }
    catch (ex) {
        GlkOte.log('file_fopen: failed to open ' + fstream.filename + ': ' + ex);
        return null;
    }

    if (fmode == filemode_WriteAppend) {
        try {
            fs.seekSync(fstream.fd, 0, 2); /* ...to the end. */
        }
        catch (ex) {}
    }

    return fstream;
}

/* Dialog.file_fclose(fstream) -- close a file
 */
function file_fclose(fstream)
{
    if (fstream.fd === null) {
        GlkOte.log('file_fclose: file already closed: ' + fstream.filename);
        return;
    }
    fs.closeSync(fstream.fd);
    fstream.fd = null;
}

/* Dialog.file_fread(fstream, len) -- read a given number of bytes from a file
   Returns a buffer. If end-of-file, returns an empty buffer.
 */
function file_fread(fstream, len)
{
    var buf = new buffer.Buffer(len);
    var count = fs.readSync(fstream.fd, buf, 0, len);
    if (count == len)
        return buf;
    else
        return buf.slice(0, count);
}

/* Dialog.file_fwrite(fstream, str) -- write a string to a file
   The string must contain only byte values (character values 0-255).
   Yes, it is inconsistent that file_fwrite takes strings but file_fread
   returns buffers.
 */
function file_fwrite(fstream, str)
{
    var buf = new buffer.Buffer(str, 'binary');
    var count = fs.writeSync(fstream.fd, buf, 0, buf.length);
    return count;
}

/* Dialog.file_write(dirent, content, israw) -- write data to the file
   This call is intended for the non-streaming API, so it does not
   exist in this version of Dialog.
 */
function file_write(dirent, content, israw)
{
    throw('file_write not implemented in electrofs');
}

/* Dialog.file_read(dirent, israw) -- read data from the file
   This call is intended for the non-streaming API, so it does not
   exist in this version of Dialog.
 */
function file_read(dirent, israw)
{
    throw('file_read not implemented in electrofs');
}

/* End of Dialog namespace function. Return the object which will
   become the Dialog global. */
return {
    streaming: true,
    open: dialog_open,

    file_construct_ref: file_construct_ref,
    file_ref_exists: file_ref_exists,
    file_remove_ref: file_remove_ref,
    file_fopen: file_fopen,
    file_fclose: file_fclose,
    file_fread: file_fread,
    file_fwrite: file_fwrite,
    file_write: file_write,
    file_read: file_read
};

}();

/* End of Dialog library. */
