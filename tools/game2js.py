#!/usr/bin/env python

"""
    game2js.py

    This utility converts a Z-code or Glulx story file into a Javascript 
    file for use by Parchment or Quixe. (It also works on Blorb files
    containing Z-code or Glulx data.)

    Usage is as follows (Python 2 and 3 both work):

        python game2js.py <game-file>

    The result is printed to stdout, so you'll probably want to pipe
    the output to a file, e.g.:

        python game2js.py mystory.ulx > mystory.ulx.js

    By default, this generates base64 data wrapped in the legacy
    processBase64Zcode() function call. This is suitable for use in
    a "&story=..." URL, or the default_story option of a page.

    If you use the --giload option:

        python game2js.py --giload mystory.ulx > mystory.ulx.js

    ...then this will generate base64 data wrapped in a GiLoad.load_run()
    function call, set as an onload handler. This is suitable for
    embedding as a <script> line in the page; it is how the I7 interpreter
    template works.
"""
from __future__ import print_function

import os
import sys
import base64

format = 'base64z'
args = sys.argv[1:]

if ('--giload' in args):
    args.remove('--giload')
    format = 'giload'

if len(args) != 1:
    print(__import__("__main__").__doc__)
    sys.exit(-1)

fl = open(args[0], "rb")
contents = fl.read()
fl.close()

enc = base64.b64encode(contents).decode()

if (format == 'base64z'):
    print("processBase64Zcode('%s');" % (enc,))
elif (format == 'giload'):
    print("$(document).ready(function() {")
    print("  GiLoad.load_run(null, '%s', 'base64');" % (enc,))
    print("});")

