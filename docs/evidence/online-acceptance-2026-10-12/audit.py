from pathlib import Path
import json,hashlib
from urllib.parse import urlsplit
root=Path('/workspace/acceptance-evidence'); reports=[]; seen={}; requests=[]; failures=[];errors=[]
for group in ['tests','examples']:
 for p in sorted((root/group).glob('*/network.json')):
  d=json.loads(p.read_text());req=[e for e in d['events'] if e['kind']=='request']; requests+=req; failures+=d['failed'];errors+=d['errors'];reports.append({'test':d['title'],'requests':len(req),'errors':d['errors'],'failed':d['failed']})
  for e in d['events']:
   if e['kind']=='response':seen[e['url']]=e
assets=[]
for url,e in sorted(seen.items()):
 path=urlsplit(url).path;f=Path('/workspace/EmuC51/dist')/(path.lstrip('/') or 'index.html')
 sha=hashlib.sha256(f.read_bytes()).hexdigest() if f.is_file() else None
 assets.append({'url':url,'status':e['status'],'observedSha256':e.get('sha256'),'localSha256':sha,'matches':sha is not None and sha==e.get('sha256')})
result={'commit':'1a096b739e946218ad0d8102dd2358000f41dcfb','testCount':len(reports),'requestCount':len(requests),'allRequestsSameOriginGetWithoutBody':all(r['url'].startswith('https://emuc51.kwgrg-01.workers.dev/') and r['method']=='GET' and r['body'] is None for r in requests),'sourceMarkerAbsentFromRequests':all('PUBLIC_ACCEPTANCE_20261012_NO_UPLOAD' not in str(r) for r in requests),'jsErrors':errors,'failedRequests':failures,'tests':reports,'assets':assets}
assert len(reports)==15 and not errors and not failures and all(a['matches'] and a['status']==200 for a in assets)
(root/'asset-and-network-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in result.items() if k not in ['tests','assets']},ensure_ascii=False))
