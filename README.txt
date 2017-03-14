Quixe -- a Glulx VM interpreter written in Javascript

Quixe Library: version 2.1.6.
Designed by Andrew Plotkin <erkyrath@eblong.com>.
(Storage and heap-management code contributed by Iain Merrick.)
<http://eblong.com/zarf/glulx/quixe/>

Quixe is a pure-Javascript interpreter for the Glulx IF virtual
machine. It can play any Glulx game file (.ulx or .gblorb) in a web
browser. It does not require a server component; it runs entirely in
the browser.

Quixe currently supports text buffer and grid windows, character and line
input, timers, and hyperlinks. Experimental graphics support has just
been added. It does not (yet) support sound or style hints.

You can save and restore games. If your browser supports the HTML5
local-storage feature, the save files will be available from one browser
session to the next.


* Using Quixe

The easiest way to use Quixe is to have Inform 7 build you a game-playing
page. Download the "Quixe.zip" template package (at the URL above), unpack
it, and install it into Inform's template directory. (On a Mac this is
~/Library/Inform/Templates; place the unzipped Quixe folder there.) You
can then add this line to your Inform source code:

  Release along with the "Quixe" interpreter.

You can also copy the files right out of this project. The play.html file
is set up to run Glulxercise, which is not actually an IF game, but uses
the same format. (Glulxercise is a set of unit tests for Quixe.) 

You can copy play.html and all the files it uses. However, play.html
as provided cannot load Glulx files directly. You must convert your
game file using the game2js.py script in the tools directory:

  python tools/game2js.py --giload mystory.ulx > mystory.ulx.js

Then, in play.html, replace the reference to "glulxercise.ulx.js" with
your "mystory.ulx.js" file.

To set up a page that can play any game file on the Internet (as
on the web site), copy play-remote.html.


* Electron

The included version of GlkOte has extra support for the Electron
environment. This is a version of Node.js wrapped up as an application
shell, with extra APIs for native file support. In this environment,
use lib/elkote.min.js instead of lib/glkote.min.js.

If you have no idea what I just said, ignore lib/elkote.min.js.


* Contents

- README.txt       -- this file
- play.html        -- HTML template for a Quixe page
- play-full.html   -- same thing, but using non-compressed Javascript source
- play-remote.html -- Quixe page that plays any story via "?story=..."
- play-remote-full.html   -- same thing, but using non-compressed Javascript
- play-remote-onecol.html -- same thing, but the HTML template gives a fixed
                             column width with a header and footer
- build.py         -- generates the files in lib

- src -- Javascript source code
  - quixe/quixe.js    -- the VM engine core
  - quixe/gi_dispa.js -- Glk layer dispatcher
  - quixe/gi_load.js  -- game file loader (and blorb code)
  - glkote/...        -- copied from the GlkOte project

- lib -- compressed Javascript source code
  - jquery-1.12.4.js     -- standard jQuery library
  - jquery-1.12.4.min.js -- ditto, minified
  (each of the next two files contains several files from the src directory,
  run through rjsmin.py)
  - glkote.min.js        -- glkote files
  - elkote.min.js        -- glkote files (alternate package for Electron)
  - quixe.min.js         -- quixe files

- media -- images, CSS, and layout for play.html et al
  - glkote.css      -- default stylesheet (copied from GlkOte project)
  - dialog.css      -- dialog-box stylesheet (copied from GlkOte project)
  - waiting.gif     -- timer animation (copied from GlkOte project)
  - i7-manifest.txt -- I7 template file; becomes (manifest).txt
  - i7-glkote.css   -- another stylesheet (adjusted to suit i7-manifest)

- stories -- game files
  - glulxercise.ulx.js -- Glulxercise VM unit test

- tools -- random associated scripts and tools
  - rjsmin.py -- Javascript compressor
  - game2js.py -- convert game files to base64 for easier loading


* Version History

- 2.1.### (###)
  - Adopt GlkOte's new timer API (no change in behavior).
  - Change to how whitespace is displayed (ditto).
  - Test localStorage functionality; if not available, fall back to
    Javascript memory.

- 2.1.6 (October 30, 2016)
  - Fix for graphics windows being drawn with a slight extra lower margin.
  - Detect size changes of the gameport (even if the window does not change
    size) and fire the appropriate rearrange event.
  - Adjust the (experimental) debug feature to look for a "Dbug" chunk in
    a Blorb file. (But this does not yet support the current debug format.)
  - Update to jQuery 1.12.4.

- 2.1.5 (June 23, 2016)
  - When MORE paging, display a margin mark at the last-seen position.
  - Graphics windows now display scaled images at full screen resolution
    on all browsers. (Previously, Counterfeit Monkey on a Retina display
    in Chrome was fuzzy.)
  - Hooks for extending the UI in game-specific ways.

- 2.1.4 (March 11, 2016)
  - Autosave option: the interpreter can save state after every command
    and restore it when relaunched.
  - Fixed a bug where local variables were corrupted after restoring a
    saved game. (Did not affect UNDO, only RESTORE.)
  - Fixed a bug where the MORE prompt could get stuck on (particularly when
    you use browser-view zoom).
    
- 2.1.3 (February 5, 2016)
  - Display a "game session has ended" message when the interpreter exits.
  - Changed the behavior of unicode files in local storage. They are now
    byte arrays (UTF8 or BE32) instead of unichar arrays. Legacy saved files
    will not read back correctly. This only affects files created with
    glk_stream_open_file_uni(), so it does *not* affect saved games.
  - Fixed a bug where hyperlinks set on images (in text) would not work.
  - Eevee provides further speed optimizations.

- 2.1.2 (November 22, 2015)
  - Added basic WAI-ARIA support to buffer windows.
  - Fixed a bug where setting a graphics window's color and then clearing
    it (in the same turn) would fail.

- 2.1.1 (June 13, 2015)
  - Restructured generated JS code for better optimization in modern
    browsers. (No more eval() calls!) Thanks to Alex Munroe for pointing
    out the problem and offering solutions. Also everyone else who
    joined in the JS-wonkery discussion.
  - Use Math.imul instead of native multiplication, so that large integer
    multiplies (which overflow 32 bits) are computed correctly.

- 2.1.0 (April 24, 2015)
  - Include GlkOte 2.1.0 (graphics windows; image display; mouse input).
    Thanks to Alex Munroe for original implementation.
  - Remove the #layouttestpane from all the HTML templates.
  - Added the ability to send transcript data to an external server.
  - Fixed a bug where non-ASCII characters in metadata were not properly
    decoded. (This could affect the <title> of the browser window.)

- 2.0.0 (February 12, 2015)
  - Switched from Prototype over to jQuery.
  - Switched from my old ad-hoc license to the MIT license.
  - Added the ability to download a saved-game file.
  - Increased the font size in the included CSS stylesheets.
  - Fixed save bug where the IFhd chunk could appear late in the file
    (violating the Quetzal spec). Also, a bug where odd-length chunks
    were not padded (violating the IFF spec).

- 1.3.1 (March 27, 2014)
  - Added acceleration functions 8 through 13, which work correctly when
    NUM_ATTR_BYTES is changed.

- 1.3.0 (January 3, 2013)
  - Corrected the format of saved-game files. (In previous versions, the
    CMem chunk had the wrong format, and a non-standard QFun chunk was
    stored.) This means that saved games from old versions will not load.
  - Fixed bugs restoring a saved-game file with an active heap.
  - Fixed a bug preventing the game from running if you have Firefox's
    cookies disabled. (Now it will run, but external files will be transient.)
  - Updated the Blorb-resource functions to understand FORM chunks
    (Glk 0.7.4 amendment).

- 1.2.0 (May 7, 2012)
  - Ensure that gi_load.js works no matter what order the javascript
    libraries load.
  - Included GlkOte 1.3.0 (non-support for Glk 0.7.3: expanded sound functions;
    support for Glk 0.7.4: resource streams)
  - Fixed a bug in glk_cancel_hyperlink_event().
  - Fixed a bug where strings in RAM were being incorrectly cached.
  - Experimental debug info support. If a blorb file contains debug data
    (as generated by I6), Quixe can be made to parse it and symbolicate
    stack dumps.

- 1.1.1 (February 17, 2011):
  - Included GlkOte 1.2.3 (support for Glk 0.7.2: date and time functions)

- 1.1.0 (January 22, 2011):
  - The Glulx accelerated-function feature.
  - Better optimization of local variables.
  - Included GlkOte 1.2.2 (support for all the Glk 0.7.1 features: 
    window borders, line input terminator keys, line input echo control, 
    Unicode normalization).

- 1.0.3 (October 14, 2010):
  - Better display and input on iPhone/Android.

- 1.0.2 (August 17, 2010):
  - Floating-point opcodes.

- 1.0.1 (July 28, 2010):
  - Included GlkOte 1.2.0 ("more" paging).
  - Added a "rethrow_exceptions" option, which should make browser
    debugging easier.
  - Fixed the inconsistent font size for the input line.

- 1.0.0 (July 4, 2010):
  - Initial release.


* Permissions

The Quixe, GiDispa, and GiLoad Javascript libraries are copyright 2010-16
by Andrew Plotkin. They are distributed under the MIT license; see the
"LICENSE" file.

This package includes the GlkOte, GlkAPI, and Dialog libraries, also
copyright by Andrew Plotkin under the MIT license.

This package includes the jQuery JavaScript framework, version 1.12.4
Copyright jQuery Foundation and other contributors
Released under the MIT license <http://jquery.org/license>
For details, see the jQuery web site: <http://jquery.com/>

The build script uses rJSmin, version 1.0.10 (which is included
as a build tool). rJSmin was written and is maintained by Andre Malo,
and is freely distributable under the Apache License, Version 2.0.
For details, see the rJSmin web site: <http://opensource.perlig.de/rjsmin/>
