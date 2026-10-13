"""One bounded GET using unchanged urllib proxy and certificate defaults. No retries."""
import datetime
import hashlib
import json
import os
import pathlib
import platform
import ssl
import urllib.error
import urllib.parse
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent
URL = 'https://emuc51.kwgrg-01.workers.dev/'
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def safe_proxy(value):
    parsed = urllib.parse.urlsplit(value)
    return {'scheme': parsed.scheme, 'host': parsed.hostname, 'port': parsed.port,
            'credentialsPresent': parsed.username is not None or parsed.password is not None}
proxies = urllib.request.getproxies()
configuration = {'python': platform.python_version(), 'openssl': ssl.OPENSSL_VERSION,
    'proxyVariablesPresent': [k for k in ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy'] if k in os.environ],
    'effectiveHttpsProxy': safe_proxy(proxies['https']) if 'https' in proxies else None,
    'proxyBypassForTarget': urllib.request.proxy_bypass(urllib.parse.urlsplit(URL).hostname),
    'certificateVariablesPresent': [k for k in ['SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE','NODE_EXTRA_CA_CERTS'] if k in os.environ],
    'defaultVerifyPaths': ssl.get_default_verify_paths()._asdict(),
    'certificateVerification': 'unchanged Python default', 'userAgent': urllib.request.OpenerDirector().addheaders,
    'method': 'GET', 'timeoutSeconds': 20, 'retries': 0, 'bodyReadLimit': 65536}
(OUT/'configuration.json').write_text(json.dumps(configuration,indent=2)+'\n')
result = {'url':URL, 'startedAt':now(), 'configuration':'configuration.json'}
def record(response):
    result['status'] = response.status
    result['finalUrl'] = response.url
    sensitive = {'set-cookie','cookie','authorization','proxy-authorization'}
    result['headers'] = {k:v[:4096] for k,v in response.headers.items() if k.lower() not in sensitive}
    data = response.read(65537)
    result['bodyTruncated'] = len(data)>65536
    data = data[:65536]
    result['capturedBodySha256'] = hashlib.sha256(data).hexdigest()
    (OUT/'response-body.txt').write_text(data.decode('utf-8',errors='replace'))
try:
    with urllib.request.urlopen(URL, timeout=20) as response:
        record(response)
        result['outcome'] = 'HTTP response'
except urllib.error.HTTPError as error:
    record(error)
    result['outcome'] = 'HTTPError'
    result['error'] = str(error)
except urllib.error.URLError as error:
    result['outcome'] = 'URLError (transport/proxy/TLS failure)'
    result['error'] = str(error.reason)
finally:
    result['finishedAt'] = now()
    (OUT/'response.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
