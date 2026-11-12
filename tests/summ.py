import sys,json
for l in sys.stdin:
  if not l.startswith('{'): continue
  d=json.loads(l); print(d['name'],d['bpm'],d['beatF'],d['beatOffsetMs'],d['meter'],d['downbeatOk'],d['key'],d['chordRoot'],d['chordFull'],d['ms'])
