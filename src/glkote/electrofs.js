Dialog = function() {

const fs = require('fs');
const path = require('path');
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
function dialog_open(tosave, usage, gameid, callback) {
    const dialog = require('electron').remote.dialog;
    /*### title */
    var opts = {
        filters: filters_for_usage(usage) 
    };
    var diacallback = function(ls) {
        if (ls.length == 0)
            callback(null);
        else
            callback({ filename:ls[0], usage:usage });
    };
    var mainwin = require('electron').remote.getCurrentWindow();
    if (!tosave) {
        opts.properties = ['openFile'];
        dialog.showOpenDialog(mainwin, opts, diacallback);
    }
    else {
        dialog.showSaveDialog(mainwin, opts, diacallback);
    }
}

const Const = {
    filemode_Write : 0x01,
    filemode_Read : 0x02,
    filemode_ReadWrite : 0x03,
    filemode_WriteAppend : 0x05
};

function filters_for_usage(val) {
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
function file_construct_ref(filename, usage, gameid) {
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
function file_ref_exists(ref) {
    console.log('### file_ref_exists', ref);
    //###
}

/* Dialog.file_remove_ref(ref) -- delete the file, if it exists
 */
function file_remove_ref(ref) {
    console.log('### file_remove_ref', ref);
    //###
}

/* ###
 */
function file_open(fmode, ref) {
    console.log('### file_open', ref);

    var fstream = null;
    if (fmode == Const.filemode_Read) {
        fstream = fs.createReadStream(ref, {
                flags: 'r',
                autoClose: false
            });
    }
    else {
        //### other modes, other flags
        fstream = fs.createWriteStream(ref, {
                flags: 'w'
            });
    }
    return fstream;
}

/* Dialog.file_write(dirent, content, israw) -- write data to the file
 */
function file_write(dirent, content, israw) {
    throw('file_write not implemented in electrofs');
}

/* Dialog.file_read(dirent, israw) -- read data from the file
 */
function file_read(dirent, israw) {
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
    file_open: file_open,
    file_write: file_write,
    file_read: file_read
};

}();

/* End of Dialog library. */
