#!/usr/bin/env python3
"""Resume-safe GMI Seedance production. Signed media URLs never enter logs/manifests."""
import argparse, concurrent.futures, hashlib, json, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art-work/source'
JOBS = ROOT / 'docs/art/jobs'
BASE = 'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey'
MODEL = 'seedance-2-5-260628'

def key():
    return next(s.split('=', 1)[1].strip().strip('\"\'') for s in (ROOT / '.env.local').read_text().splitlines() if s.startswith('GMI_CLOUD_API_KEY='))

def request(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + key(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=100) as response:
        return json.load(response)

def sanitize(value):
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items() if k not in ('org_id','user_id') and not any(s in k.lower() for s in ('url','payload','api_key','authorization','prompt'))}
    if isinstance(value, list): return [sanitize(v) for v in value]
    if isinstance(value, str) and value.startswith(('http:', 'https:')): return '[media URL omitted]'
    return value

def prompt(character, state):
    identity = 'coral jacket courier with parcel, tan satchel and dark trousers' if character == 'courier' else 'teal sweater woman resident with cream trousers and phone'
    base = f'Locked orthographic overhead RPG sprite camera. The reference is FOUR separately spaced directional views of the SAME {identity}, in four equal columns. Preserve all four identical costume references, their respective directions (south front, west left, north back, east right), fixed centers, feet baseline, framing and scale. Animate every separate character view simultaneously. Preserve crisp original pixel-art texture and colors. Uniform pure bright green #00FF00 chroma background stays exactly flat, no shadows, no ground, no additional objects. Whole head and feet always remain in each original column. The four figures never approach each other, translate across the image, or change facing. Camera has zero pan, zoom, rotation or parallax. '
    if state == 'walk':
        return base + 'Four-second seamless WALK IN PLACE loop: four complete natural step pairs, alternating planted feet and raised swinging feet, knees bend, hips transfer weight subtly, free arm counter-swings, hair and clothing have tiny follow-through. Each figure marches in its OWN pictured facing direction without changing its screen center. This is visible articulated walking with alternating legs, not a standing sprite bouncing. Courier secures parcel against chest, resident keeps phone low. At 4 seconds all return exactly to reference stance and begin the next cycle seamlessly. No blur, no walking translation, no face or clothing morphing.'
    return base + 'Four-second subtle IDLE loop: 0-1 seconds neutral relaxed breathing; 1-2 seconds one gentle blink and tiny shoulder rise; 2-3 seconds shoulder settles and hair gently follows; 3-4 seconds returns exactly to original pose. Feet stay fully planted at the same baseline. Arms remain in their reference pose. No walking or turning, no exaggerated bouncing. Minimal movement readable on a small phone sprite.'

def submit(name, character, state):
    JOBS.mkdir(parents=True, exist_ok=True)
    path = JOBS / f'{name}.json'
    if path.exists(): return resume(name)
    raw = (OUT / f'{character}-chroma.png').read_bytes()
    params = dict(prompt=prompt(character, state), duration=4, resolution='480p', ratio='adaptive', seed=4201 if character=='courier' else 4202, watermark=False, generate_audio=False, web_search=False)
    job = dict(name=name, provider='GMI Cloud', model=MODEL, state=state, character=character, source=f'art-work/source/{character}-chroma.png', source_sha256=hashlib.sha256(raw).hexdigest(), parameters=params, status='reserved', request_id=None, submitted_at=time.time(), pricing={'catalogUnitsPerSecond':231000,'estimatedCatalogUnits':924000,'currencyConversion':'unavailable','actualCharge':'unavailable'}, acceptance='pending')
    path.write_text(json.dumps(job, indent=2)+'\n')
    try:
        upload = request('/upload-url', {'file_type':'png'})
        with urllib.request.urlopen(urllib.request.Request(upload['upload_url'], data=raw, method='PUT', headers={'Content-Type':'image/png'}), timeout=100): pass
        payload = dict(params, first_frame=upload['public_url'], last_frame=upload['public_url'])
        response = request('/requests', {'model':MODEL,'payload':payload})
        job.update({k:response[k] for k in ['request_id','status'] if k in response})
        job['submissionResponse']=sanitize(response)
        path.write_text(json.dumps(job, indent=2)+'\n')
        return {k:job.get(k) for k in ['name','request_id','status']}
    except Exception as error:
        job['status']='uncertain'; job['errorType']=type(error).__name__
        path.write_text(json.dumps(job, indent=2)+'\n')
        return dict(name=name,status='uncertain',errorType=type(error).__name__)

def resume(name):
    path = JOBS / f'{name}.json'; job=json.loads(path.read_text())
    if not job.get('request_id'): return dict(name=name,status=job['status'],note='Reconcile provider history before submitting any replacement.')
    response=request('/requests/'+job['request_id'])
    job['status']=response.get('status'); job['lastCheckedAt']=time.time(); job['returnedMetadata']=sanitize(response)
    video_url=(response.get('outcome') or {}).get('video_url')
    target=OUT / f'{name}.mp4'
    if video_url and not target.exists():
        urllib.request.urlretrieve(video_url,target)
        job['video']=str(target.relative_to(ROOT));job['video_sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
    for field in ['price','cost','billing','usage','credits','charged_amount']:
        if field in response: job['pricing']['returned_'+field]=sanitize(response[field])
    path.write_text(json.dumps(job,indent=2)+'\n')
    return {k:job.get(k) for k in ['name','request_id','status','video']}

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--submit',action='store_true');args=parser.parse_args()
    names=[(f'{c}-{s}',c,s) for c in ['courier','resident'] for s in ['idle','walk']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures=[pool.submit(submit,n,c,s) if args.submit else pool.submit(resume,n) for n,c,s in names]
        for future in concurrent.futures.as_completed(futures):print(json.dumps(future.result()),flush=True)
