#!/usr/bin/env python

"""
    zcode2js.py

    This utility converts a z-code (or glulx) story file into a Javascript 
    file for use by Parchment or Quixe.

    Usage is as follows:

        python zcode2js.py <game-file>

    The result is printed to stdout, so you'll probably want to pipe
    the output to a file, e.g.:

        python zcode2js.py mystory.z5 > mystory.z5.js

    By default, this generates base64 data wrapped in the legacy
    processBase64Zcode() function call. This is suitable for use in
    a "&story=..." URL, or the default_story option of a page.

    If you use the --giload option:

        python zcode2js.py --giload mystory.z5 > mystory.z5.js

    ...then this will generate base64 data wrapped in a GiLoad.load_run()
    function call, set as an onload handler. This is suitable for
    embedding as a <script> line in the page; it is how the I7 interpreter
    template works.
"""

import os
import sys
import base64

format = 'base64z'
args = sys.argv[1:]

if ('--giload' in args):
    args.remove('--giload')
    format = 'giload'

if len(args) != 1:
    print __import__("__main__").__doc__
    sys.exit(-1)

fl = open(args[0], "rb")
contents = fl.read()
fl.close()

enc = base64.b64encode(contents)

if (format == 'base64z'):
    print "processBase64Zcode('%s');" % (enc,)
elif (format == 'giload'):
    print "Event.observe(window, 'load', function() {"
    print "  GiLoad.load_run(null, '%s', 'base64');" % (enc,)
    print "});"

