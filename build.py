#!/usr/bin/env python

# Quixe build script.
#
# This packs together all the Javascript source into three files, using
# rjsmin. As a special bonus, lines (or part-lines) beginning with
# ';;;' are stripped out. We use this to get rid of debugging log statements
# and assertions.
#
# (Now works under Python 2 or 3; thanks Alex Munroe.)
#
# Previous versions of this script packed Prototype in. We're now based on
# jQuery, but we don't try to include it -- that makes it hard to integrate
# Quixe with other web services. We assume that the host page already has
# jQuery available (version 1.9 or later).

from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import sys
import re
import subprocess

regex_debug = re.compile(b';;;.+$', re.M)


def compress_source(target, srcls):
    print('Writing', target)
    with open(target, 'wb') as targetfl:
        proc = subprocess.Popen([sys.executable, 'tools/rjsmin.py'],
                                stdin=subprocess.PIPE,
                                stdout=targetfl)
        for src in srcls:
            with open(src, 'rb') as fl:
                dat = fl.read()
            dat = regex_debug.sub(b'', dat)
            proc.stdin.write(dat)
        proc.stdin.close()
        ret = proc.wait()
        if (ret):
            raise Exception('Process result code %d' % (ret,))

compress_source(
    'lib/glkote.min.js', [
        'src/glkote/glkote.js',
        'src/glkote/dialog.js',
        'src/glkote/glkapi.js',
        ])

compress_source(
    'lib/elkote.min.js', [
        'src/glkote/glkote.js',
        'src/glkote/electrofs.js',
        'src/glkote/glkapi.js',
        ])

compress_source(
    'lib/quixe.min.js', [
        'src/quixe/quixe.js',
        'src/quixe/gi_dispa.js',
        'src/quixe/gi_load.js',
        ])
