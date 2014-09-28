#!/usr/bin/env python

# Quixe build script.
#
# This packs together all the Javascript source into two files, using
# rjsmin. As a special bonus, lines (or part-lines) beginning with
# ';;;' are stripped out. We use this to get rid of debugging log statements
# and assertions.

import sys
import re
import subprocess

regex_debug = re.compile(';;;.+$', re.M)

def compress_source(target, srcls):
    print 'Writing', target
    targetfl = open(target, 'w')
    proc = subprocess.Popen(['python', 'tools/rjsmin.py'],
                            stdin=subprocess.PIPE,
                            stdout=targetfl)
    for src in srcls:
        fl = open(src)
        dat = fl.read()
        dat = regex_debug.sub('', dat)
        fl.close()
        proc.stdin.write(dat)
    proc.stdin.close()
    ret = proc.wait()
    if (ret):
        raise Exception('Process result code %d' % (ret,))
    targetfl.close()

compress_source(
    'lib/glkote.min.js', [
        'src/prototype-1.6.1.js',
        'src/audiofile.js',
        'src/glkote/glkote.js',
        'src/glkote/dialog.js',
        'src/glkote/glkapi.js',
        ])

compress_source(
    'lib/quixe.min.js', [
        'src/quixe/quixe.js',
        'src/quixe/gi_dispa.js',
        'src/quixe/gi_load.js',
        ])

