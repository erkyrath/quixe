Quixe -- a Glulx VM interpreter written in Javascript

Quixe Library: version 1.1.1.
Designed by Andrew Plotkin <erkyrath@eblong.com>.
(Storage and heap-management code contributed by Iain Merrick.)
<http://eblong.com/zarf/glulx/quixe/>

Quixe is a pure-Javascript interpreter for the Glulx IF virtual
machine. It can play any Glulx game file (.ulx or .gblorb) in a web
browser. It does not require a server component; it runs entirely in
the browser.

Quixe currently supports text buffer and grid windows, character and line
input, timers, and hyperlinks. It does not (yet) support graphics, sound,
or style hints.

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

* Contents

- README.txt       -- this file
- play.html        -- HTML template for a Quixe page
- play-full.html   -- same thing, but using non-compressed Javascript source
- play-remote.html -- Quixe page that plays any story via "?story=..."
- play-remote-full.html -- same thing, but using non-compressed Javascript
- build.py         -- generates the files in lib

- src -- Javascript source code
  - quixe/quixe.js    -- the VM engine core
  - quixe/gi_dispa.js -- Glk layer dispatcher
  - quixe/gi_load.js  -- game file loader (and blorb code)
  - glkote/...        -- copied from the GlkOte project

- lib -- compressed Javascript source code
  (each file contains several files from the src directory, run through
  yuicompressor)
  - glkote.min.js -- prototype and glkote files
  - quixe.min.js  -- quixe files

- media -- images, CSS, and layout for play.html et al
  - glkote.css      -- default stylesheet (copied from GlkOte project)
  - dialog.css      -- dialog-box stylesheet (copied from GlkOte project)
  - waiting.gif     -- timer animation (copied from GlkOte project)
  - i7-manifest.txt -- I7 template file; becomes (manifest).txt
  - i7-glkote.css   -- another stylesheet (adjusted to suit i7-manifest)

- stories -- game files
  - glulxercise.ulx.js -- Glulxercise VM unit test

- tools -- random associated scripts and tools
  - yuicompressor-2.4.2.jar -- Javascript compressor
  - game2js.py -- convert game files to base64 for easier loading


* Version History

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

The Quixe, GiDispa, and GiLoad Javascript libraries are copyright 2010 by
Andrew Plotkin. You may copy and distribute them freely, by any means
and under any conditions, as long as the code and documentation is not
changed. You may also incorporate this code into your own program and
distribute that, or modify this code and use and distribute the
modified version, as long as you retain a notice in your program or
documentation which mentions my name and the URL shown above.

This package includes the GlkOte, GlkAPI, and Dialog libraries, also
copyright by Andrew Plotkin under the same terms.

This package includes the Prototype JavaScript framework, version 1.6.1
(c) 2005-2009 Sam Stephenson
Prototype is freely distributable under the terms of an MIT-style license.
For details, see the Prototype web site: <http://www.prototypejs.org/>

The build script uses the YUI Compressor, version 2.4.2 (which is included
as a build tool). The YUI Compressor was written and is maintained by:
Julien Lecomte <jlecomte@yahoo-inc.com>
Copyright (c) 2007-2009, Yahoo! Inc. All rights reserved.
All code specific to YUI Compressor is issued under a BSD license.
YUI Compressor extends and implements code from Mozilla's Rhino project.
Rhino is issued under the Mozilla Public License (MPL), and MPL applies
to the Rhino source and binaries that are distributed with YUI Compressor.
For source and other details: <http://developer.yahoo.com/yui/compressor/>
