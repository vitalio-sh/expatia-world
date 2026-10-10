#!/usr/bin/env python3
"""One bounded Seedance pilot. Submit once; subsequent calls only resume.
Official API: https://docs.gmicloud.ai/inference-engine/api-reference/video-api-reference
"""
import json,sys,urllib.request,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'public/art/meridian'; JOB=OUT/'seedance-job.json'
k=next(s.split('=',1)[1].strip().strip('\"\'') for s in (ROOT/'.env.local').read_text().splitlines() if s.startswith('GMI_CLOUD_API_KEY='))
base='https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey'
def req(path,body=None):
 r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+k,'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(r,timeout=100))
def save(d): JOB.write_text(json.dumps(d,indent=2)+'\n')
if not JOB.exists():
 if '--submit' not in sys.argv: raise SystemExit('Explicit --submit needed for new paid job')
 im=OUT/'pip-chroma-input.png'; raw=im.read_bytes()
 u=req('/upload-url',{'file_type':'png'})
 urllib.request.urlopen(urllib.request.Request(u['upload_url'],data=raw,method='PUT',headers={'Content-Type':'image/png'}),timeout=100).close()
 prompt='Locked orthographic camera. Animate only this one whole rust-orange maintenance robot, keeping the same design, feet position, framing, illumination and flat pure green background throughout. Quiet weary idle loop: 0 to 1 second still; 1 to 2 seconds a subtle heavy shoulder sigh, head lowers very slightly; 2 to 3 seconds a slow eye blink and head gently returns; 3 to 4 seconds returns exactly to original posture. Both arms stay relaxed. Body never turns or walks. Keep complete feet and antenna in frame. Small slow movements suitable for a 64 pixel game sprite. No new objects, no camera motion, no shadow on the green screen. Green stays exactly uniform.'
 payload=dict(prompt=prompt,first_frame=u['public_url'],last_frame=u['public_url'],duration=4,resolution='480p',ratio='adaptive',seed=42,watermark=False,generate_audio=False,web_search=False)
 job=dict(model='seedance-2-5-260628',status='reserved',reservation_usd=2,actual_usd=None,source_sha256=hashlib.sha256(raw).hexdigest(),parameters=payload,acceptance='pending',note='One paid pilot only; reserve is a budget ceiling, not a quoted actual charge.')
 save(job)
 try:
  r=req('/requests',{'model':job['model'],'payload':payload});job.update({x:r[x] for x in ('request_id','status') if x in r});save(job)
 except Exception:
  job['status']='uncertain';save(job);raise SystemExit('Submission uncertain; reconcile provider history before retry. No automatic resubmit.')
else:
 job=json.loads(JOB.read_text())
 if not job.get('request_id'):raise SystemExit('Uncertain reserved job; do not resubmit')
 r=req('/requests/'+job['request_id']);job['status']=r.get('status');job['outcome']=r.get('outcome');save(job)
 if job.get('outcome',{}):
  url=job['outcome'].get('video_url')
  if url and not (OUT/'pip-idle-source.mp4').exists():urllib.request.urlretrieve(url,OUT/'pip-idle-source.mp4')
print(json.dumps({x:job.get(x) for x in ('request_id','status','actual_usd','reservation_usd')}))
