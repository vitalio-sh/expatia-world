"""Read only explicitly registered development thread logs, never unrelated chats."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
reg=root/'docs/usage/development-threads.json'
threads=json.loads(reg.read_text()) if reg.exists() else [json.loads((root/'docs/usage/development-baseline.json').read_text())]
result=[]
for t in threads:
 events=[]
 p=Path(t['logPath'])
 if not p.exists():
  result.append({'threadId':t['threadId'],'usage':'unavailable'});continue
 for line in p.open():
  e=json.loads(line)
  if e.get('type')=='event_msg' and e.get('payload',{}).get('type')=='token_count' and e.get('payload',{}).get('info'):
   events.append(e)
 if not events:continue
 first=events[0]['payload']['info'];end=events[-1]['payload']['info']['total_token_usage']
 base=t.get('baseline') or {k:first['total_token_usage'][k]-first['last_token_usage'].get(k,0) for k in first['total_token_usage']}
 result.append({'threadId':t['threadId'],'baseline':base,'end':end,'delta':{k:end[k]-base.get(k,0) for k in end},'measuredThrough':events[-1].get('timestamp')})
sums={}
for t in result:
 for k,v in t.get('delta',{}).items():sums[k]=sums.get(k,0)+v
report={'threads':result,'sumDeltas':sums,'notes':['Each cumulative counter contributes only its last minus start delta.','Cached input is included in input; reasoning is included in output.','Excludes unexposed provider/tool internal tokens and final response after checkpoint.','Actual development billed costs unavailable; provider ledgers separate.']}
(root/'docs/usage/development-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'sumDeltas':sums,'threads':len(result)}))
