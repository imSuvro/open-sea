# safe replace: python tools/edit.py file  (reads pairs from stdin as JSON [[old,new],...]); fails loudly if a pattern is missing
import sys, json
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
for old, new in json.load(sys.stdin):
    if old not in s: print('MISSING:', old[:90]); sys.exit(1)
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s); print('ok', p)
