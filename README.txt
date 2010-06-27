Quixe -- a Glulx VM interpreter written in Javascript

Quixe Library: version 0.1.0.
Designed by Andrew Plotkin <erkyrath@eblong.com>.
(Storage and heap-management code contributed by Iain Merrick.)
<http://eblong.com/zarf/glulx/quixe/>

* Contents

- README.txt     -- this file
- play.html      -- HTML template for a Quixe page
- play-full.html -- same thing, but using non-compressed Javascript source
- build.py       -- generates the files in lib

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

- media -- images, CSS, and layout for play.html
  - glkote.css      -- default stylesheet (copied from GlkOte project)
  - dialog.css      -- dialog-box stylesheet (copied from GlkOte project)
  - waiting.gif     -- timer animation (copied from GlkOte project)
  - i7-manifest.txt -- I7 template file; becomes (manifest).txt

- stories -- game files
  - glulxercise.ulx.js -- Glulxercise VM unit test

- tools -- random associated scripts and tools
  - yuicompressor-2.4.2.jar -- Javascript compressor
  - zcode2js.py -- convert game files to base64 for easier loading

* Permissions

The Quixe and GiDispa Javascript libraries are copyright 2010 by
Andrew Plotkin. You may copy and distribute them freely, by any means
and under any conditions, as long as the code and documentation is not
changed. You may also incorporate this code into your own program and
distribute that, or modify this code and use and distribute the
modified version, as long as you retain a notice in your program or
documentation which mentions my name and the URL shown above.

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
