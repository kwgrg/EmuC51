#!/usr/bin/env python3
"""Build pinned SDCC browser stages. Usage: build.py NEW_WORK_DIRECTORY OUTPUT_DIRECTORY.
No system installation. Debian amd64 host with git, make, gcc/g++, Python, tar, patch, dpkg-deb.
The output is a development artifact; publishing requires the separate license/source audit.
"""
import base64, hashlib, json, os, pathlib, shutil, subprocess, sys, urllib.request
HERE = pathlib.Path(__file__).resolve().parent
PINS = json.loads((HERE / 'inputs.json').read_text())
work, output = [pathlib.Path(p).resolve() for p in sys.argv[1:]]
work.mkdir(exist_ok=False, parents=True)
output.mkdir(exist_ok=False, parents=True)
def run(args, cwd=work, env=None):
    subprocess.run([str(x) for x in args], cwd=cwd, env=env, check=True)
def download(url, sha):
    dest = work / url.split('/')[-1]
    urllib.request.urlretrieve(url, dest)
    if hashlib.sha256(dest.read_bytes()).hexdigest() != sha:
        raise RuntimeError('SHA256 mismatch: ' + url)
    return dest
source = work / 'source'; source.mkdir()
archive = download(**{'url':PINS['source']['url'], 'sha':PINS['source']['sha256']})
run(['tar','-xJf',archive,'--strip-components=1','-C',source])
for patch in ['c1-source.patch','config-sub.patch','psignal.patch','cc1-signatures.patch']:
    run(['patch','-p1','-i',HERE / patch], source)
host = work / 'host'
for package in PINS['packages']:
    deb = download('https://deb.debian.org/debian/' + package['Filename'], package['SHA256'])
    run(['dpkg-deb','-x',deb,host])
boost = work / 'boost'; boost.mkdir(); (boost / 'boost').symlink_to(host / 'usr/include/boost')
sdk = work / 'emsdk'
run(['git','clone','--depth','1','--branch',PINS['emsdkVersion'],'https://github.com/emscripten-core/emsdk.git',sdk])
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=sdk,text=True).strip() == PINS['emsdkCommit']
run([sdk/'emsdk','install',PINS['emsdkVersion']]); run([sdk/'emsdk','activate',PINS['emsdkVersion']])
em = sdk/'upstream/emscripten'
env = dict(os.environ, PATH=str(host/'usr/bin')+':'+str(em)+':'+os.environ['PATH'], M4=str(host/'usr/bin/m4'), BISON_PKGDATADIR=str(host/'usr/share/bison'))
flags = '-O2 -g0 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=268435456 -sSTACK_SIZE=2097152 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sMODULARIZE=1 -sEXPORT_NAME=createTool -sENVIRONMENT=worker,node -sINVOKE_RUN=0 -sSINGLE_FILE=1 -sDYNAMIC_EXECUTION=0 --post-js '+str(HERE/'heap.js')
helptext = subprocess.check_output([str(source/'configure'),'--help'],text=True)
options = [line.split()[0] for line in helptext.splitlines() if '--disable-' in line and '-port ' in line and 'mcs51' not in line]
options += ['--disable-'+part for part in ['ucsim','device-lib','packihx','sdcdb','sdbinutils','non-free','sdcpp']]
build = work/'compiler'; build.mkdir()
# zlib is unused by these three selected targets; do not use host headers in WASM.
wasmenv = dict(env,CPPFLAGS='-I'+str(boost),CFLAGS='-O2',CXXFLAGS='-O2 -I'+str(boost),LDFLAGS=flags,ac_cv_header_zlib_h='yes')
run([em/'emconfigure',source/'configure','--host=wasm32-unknown-emscripten',*options],build,wasmenv)
run(['make','-j4','sdcc-cc','sdcc-as','sdcc-ld'],build,wasmenv)
lib = work/'libiberty';lib.mkdir()
libenv=dict(env,CC=str(em/'emcc'),CXX=str(em/'em++'),AR=str(em/'emar'),RANLIB=str(em/'emranlib'),CFLAGS='-O2')
run([source/'support/sdbinutils/libiberty/configure','--host=wasm32-unknown-emscripten','--disable-shared'],lib,libenv)
run(['make','-j4'],lib,libenv)
cpp = work/'cpp';cpp.mkdir()
cppenv=dict(env,CFLAGS='-O2',CXXFLAGS='-O2',LDFLAGS='',CC_FOR_BUILD='gcc',CXX_FOR_BUILD='g++',CFLAGS_FOR_BUILD='-O2',CXXFLAGS_FOR_BUILD='-O2',LDFLAGS_FOR_BUILD='')
run([em/'emconfigure',source/'support/cpp/configure','--host=wasm32-unknown-emscripten','--disable-bootstrap','--disable-multilib','--disable-nls','--without-isl'],cpp,cppenv)
# Configure prerequisites without building the process-spawning cpp driver.
run(['make','configure-gcc','all-libcpp','all-libbacktrace'],cpp,cppenv)
run(['make','-j4','cc1','CC_FOR_BUILD=gcc','CXX_FOR_BUILD=g++','LIBIBERTY='+str(lib/'libiberty.a'),'BUILD_LIBIBERTY='+str(lib/'libiberty.a'),'LIBIBERTY_DIR='+str(source/'support/sdbinutils/include'),'ZLIB=','LDFLAGS='+flags],cpp/'gcc',cppenv)
for name,path in [('sdcpp',cpp/'gcc/cc1'),('sdcc',build/'src/sdcc'),('sdas8051',build/'bin/sdas8051'),('sdld',build/'bin/sdld')]:
    (output/(name+'.js')).write_bytes(path.read_bytes()+b'\nexport default createTool;\n')
assets={}
for name in ['mcs51','libsdcc','libint','liblong','libfloat']:
    assets['/sdk/lib/'+name+'.lib']=base64.b64encode((host/('usr/share/sdcc/lib/small/'+name+'.lib')).read_bytes()).decode('ascii')
for name in ['mcs51/8051.h','stdint.h']:
    assets['/sdk/include/'+name]=base64.b64encode((host/('usr/share/sdcc/include/'+name)).read_bytes()).decode('ascii')
(output/'files.js').write_text('export default '+json.dumps(assets)+';\n')
shutil.copy2(archive,output/archive.name)
print('Built stages only; attach notices, patches, recipe and audit before distribution.')
