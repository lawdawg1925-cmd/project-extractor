#!/usr/bin/env python3
"""Summarise bench.mjs outputs: python3 tests/bench-report.py OUT1.json [OUT2.json ...] [--fields]"""
import sys, json, collections
args = [a for a in sys.argv[1:] if not a.startswith('--')]
rows = [r for f in args for r in json.load(open(f))]
by = collections.defaultdict(lambda: collections.Counter())
fld = collections.defaultdict(lambda: collections.Counter())
secs = collections.defaultdict(list)
for r in rows:
    secs[r['profile']].append(r['sec'])
    if not r['typeOk']: by[r['profile']]['typeWrong'] += 1
    for k, v in r['res'].items():
        c = v.split(' ')[0]
        by[r['profile']][c] += 1
        fld[(r['profile'], k)][c] += 1
for p in ['orig', 'lowA', 'lowB', 'lowC', 'lowD']:
    if p not in by: continue
    c = by[p]; n = sum(c[x] for x in ['ok', 'verify', 'flagged', 'WRONG', 'miss'])
    read = c['ok'] + c['verify']
    s = secs[p]
    print(f"{p:5} correct {read}/{n} ({100*read/max(1,n):.0f}%)  ok {c['ok']} verify {c['verify']} flagged-wrong {c['flagged']} CONFIDENT-WRONG {c['WRONG']} missing {c['miss']} | blanks falsePos {c['falsePos']} | type wrong {c['typeWrong']} | sec avg {sum(s)/len(s):.1f} max {max(s):.1f}")
if '--fields' in sys.argv:
    keys = sorted({k for (_, k) in fld})
    for k in keys:
        print(f"{k:22}", '  '.join(f"{p}:{fld[(p,k)]['ok']+fld[(p,k)]['verify']}/{sum(fld[(p,k)][x] for x in ['ok','verify','flagged','WRONG','miss'])}{'!'+str(fld[(p,k)]['WRONG']) if fld[(p,k)]['WRONG'] else ''}" for p in ['orig','lowA','lowB','lowC','lowD']))
if '--wrong' in sys.argv:
    for r in rows:
        for k, v in r['res'].items():
            if v.startswith('WRONG') or v.startswith('falsePos'): print('  ', r['file'], r['profile'], k, v)
