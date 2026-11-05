#!/usr/bin/env python3
"""Smoke-test an existing bridge build against two isolated Herdr installations.

Creates disposable shell-only sessions in a fresh HOME/XDG directory, binds the
bridge to loopback, and stops only these test sessions in finally blocks. No
installed binary, running user session, profile or research process is changed.
"""
from pathlib import Path
import os,sys,subprocess,socket,json,time,base64,struct,urllib.request,urllib.parse,hashlib
import argparse,tempfile,textwrap
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--herdr-old',type=Path,required=True)
parser.add_argument('--herdr-new',type=Path,required=True)
parser.add_argument('--bridge',type=Path,required=True)
parser.add_argument('--static-dir',type=Path,required=True)
args=parser.parse_args()
bridge=args.bridge.resolve()
args.static_dir=args.static_dir.resolve()
stage=Path(tempfile.mkdtemp(prefix='passel-compat-',dir='/tmp'))
print('Isolated test logs:',stage,flush=True)
class WS:
 def __init__(self,port,path):
  self.s=socket.create_connection(('127.0.0.1',port),timeout=5);self.buf=b''
  key=base64.b64encode(os.urandom(16)).decode()
  self.s.sendall((f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n').encode())
  while b'\r\n\r\n' not in self.buf:self.buf+=self.s.recv(4096)
  head,self.buf=self.buf.split(b'\r\n\r\n',1);assert head.startswith(b'HTTP/1.1 101'),head
 def read(self,n):
  while len(self.buf)<n:
   data=self.s.recv(65536)
   if not data:raise EOFError()
   self.buf+=data
  data,self.buf=self.buf[:n],self.buf[n:];return data
 def frames(self,seconds):
  end=time.monotonic()+seconds;out=[]
  while time.monotonic()<end:
   self.s.settimeout(max(.01,end-time.monotonic()))
   try:
    a,b=self.read(2);n=b&127
    if n==126:n=struct.unpack('!H',self.read(2))[0]
    elif n==127:n=struct.unpack('!Q',self.read(8))[0]
    assert n<40*1024*1024
    data=self.read(n)
    if a&15==8:raise RuntimeError('WebSocket closed: '+repr(data))
    if a&15 in (1,2):out.append((a&15,data))
   except socket.timeout:break
  return out
 def drain(self,seconds):return b''.join(data for _,data in self.frames(seconds))
 def send(self,value):
  body=json.dumps(value).encode();mask=os.urandom(4);n=len(body)
  prefix=bytes([0x81,0x80|n]) if n<126 else bytes([0x81,0xfe])+struct.pack('!H',n)
  self.s.sendall(prefix+mask+bytes(x^mask[i%4] for i,x in enumerate(body)))
 def close(self):self.s.close()

def run(version,exe,port):
 root=stage/('smoke-'+version);root.mkdir(exist_ok=True)
 env={**os.environ,'HOME':str(root),'XDG_CONFIG_HOME':str(root/'config'),'XDG_DATA_HOME':str(root/'data')}
 env.pop('HERDR_SESSION',None);env.pop('HERDR_SOCKET_PATH',None)
 log=(root/'server.log').open('wb');server=subprocess.Popen([str(exe),'--session','passel-smoke','server'],cwd=root,env=env,stdout=log,stderr=log)
 bp=None;ws=None;events=None;second=None
 try:
  sock=root/'config/herdr/sessions/passel-smoke/herdr.sock'
  for _ in range(100):
   if sock.exists():break
   if server.poll() is not None:raise RuntimeError((root/'server.log').read_text()[-2000:])
   time.sleep(.1)
  assert sock.exists(),list(root.rglob('*.sock'))
  def api(method,params={}):
   with socket.socket(socket.AF_UNIX) as s:
    s.settimeout(5);s.connect(str(sock));s.sendall(json.dumps({'id':'smoke','method':method,'params':params}).encode()+b'\n')
    value=json.loads(s.makefile('rb').readline());assert 'error' not in value,value;return value['result']
  snap=api('session.snapshot')['snapshot']
  if not snap['panes']:api('workspace.create',{'label':'Compatibility smoke'});snap=api('session.snapshot')['snapshot']
  pane=snap['panes'][0];pid=pane['pane_id'];tid=pane['terminal_id']
  blog=(root/'bridge.log').open('wb')
  bp=subprocess.Popen([str(bridge),'--host','127.0.0.1','--port',str(port),'--static-dir',str(args.static_dir)],env={**env,'HERDR_SOCKET_PATH':str(sock)},stdout=blog,stderr=blog,cwd=root)
  def http(path,body=None):
   req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,headers={'Origin':f'http://127.0.0.1:{port}','Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
   with urllib.request.urlopen(req,timeout=5) as r:return json.load(r)
  for _ in range(100):
   try:status=http('/api/snapshot');break
   except Exception:
    if bp.poll() is not None:raise RuntimeError((root/'bridge.log').read_text()[-2000:])
    time.sleep(.1)
  assert status['panes'] and snap['protocol'] == (20 if version=='0.8.2' else 22),status
  events=WS(port,'/ws/events');events.drain(.2)
  result=http('/api/command',{'method':'tab.rename','params':{'tab_id':pane['tab_id'],'label':'Smoke renamed'}})
  assert 'error' not in result,result
  event=events.drain(.7)
  assert b'tab_renamed' in event and b'Smoke renamed' in event,('No tab rename event',event)
  ws=WS(port,'/ws/terminal?'+urllib.parse.urlencode({'terminal_id':tid,'cols':100,'rows':30}));ws.drain(.5)
  def read():return api('pane.read',{'pane_id':pid,'source':'visible','format':'text','lines':80,'strip_ansi':True})['read']['text']
  # Only a disposable shell receives this bounded test command.
  ws.send({'type':'input','data':"printf 'PASSEL_INPUT_OK\\n'; seq 1 200\r"});ws.drain(.7)
  assert '200' in read(),read()
  ws.send({'type':'resize','cols':90,'rows':25});ws.drain(.5)
  assert api('pane.get',{'pane_id':pid})['pane']['scroll']['viewport_rows']==25
  ws.send({'type':'scroll','direction':'up','lines':15,'column':45,'row':12});ws.drain(.5)
  assert api('pane.get',{'pane_id':pid})['pane']['scroll']['offset_from_bottom']>0
  ws.send({'type':'scroll','direction':'down','lines':15,'column':45,'row':12});ws.drain(.3)
  second=WS(port,'/ws/terminal?'+urllib.parse.urlencode({'terminal_id':tid,'cols':90,'rows':25}));second.drain(.3)
  ws.send({'type':'input','data':"printf 'MULTICLIENT_OK\\n'\r"});ws.drain(.3);other=second.drain(.3)
  assert b'MULTICLIENT_OK' in other,other[-300:]
  ws.close();ws=None;second.close();second=None;time.sleep(.4)
  ws=WS(port,'/ws/terminal?'+urllib.parse.urlencode({'terminal_id':tid,'cols':90,'rows':25}));ws.drain(.3)
  ws.send({'type':'input','data':"printf 'RECONNECT_OK\\n'\r"});ws.drain(.4);assert 'RECONNECT_OK' in read()
  second=WS(port,'/ws/terminal?'+urllib.parse.urlencode({'terminal_id':tid,'cols':60,'rows':18,'output_grid':'true'}))
  frames=second.frames(.5)
  assert any(op==1 and json.loads(data).get('grid_version')==1 for op,data in frames)
  records=[]
  for op,data in frames:
   if op!=2:continue
   assert data[0]==2
   pos=1
   while pos<len(data):
    cols,rows,full,size=struct.unpack_from('<HHBI',data,pos);pos+=9
    assert pos+size<=len(data);records.append((cols,rows,full,data[pos:pos+size]));pos+=size
  assert any(c==60 and r==18 and f for c,r,f,_ in records),records[:2]
  second.send({'type':'resize','cols':90,'rows':25})
  frames=second.frames(.5)
  assert any(op==2 and struct.unpack_from('<HH',data,1)==(90,25) for op,data in frames)
  if version=='0.9.3':
   # A disposable mouse-reporting app, never a live Codex/Claude session.
   mouse_app=root/'mouse-probe.py'; mouse_result=root/'mouse-result.bin'
   mouse_app.write_text(textwrap.dedent("""
 import os,sys,tty,termios,select,time
 from pathlib import Path
 fd=sys.stdin.fileno(); old=termios.tcgetattr(fd); data=b''
 try:
  tty.setraw(fd)
  os.write(1,b'\\x1b[?1000h\\x1b[?1006hMOUSE_READY\\r\\n')
  end=time.monotonic()+8
  while time.monotonic()<end and data.count(b'\\x1b[<')<2:
   if select.select([fd],[],[],.1)[0]:data+=os.read(fd,256)
  Path(sys.argv[1]).write_bytes(data)
 finally:
  os.write(1,b'\\x1b[?1000l\\x1b[?1006l')
  termios.tcsetattr(fd,termios.TCSANOW,old)
 """))
   import shlex
   ws.send({'type':'input','data':f'python3 {shlex.quote(str(mouse_app))} {shlex.quote(str(mouse_result))}\r'})
   frames=ws.frames(.5)
   assert any(op==1 and json.loads(data).get('type')=='terminal_mouse_capture' and json.loads(data)['enabled'] for op,data in frames),frames[-2:]
   # A later viewer must receive the cached mode even without a new app transition.
   third=WS(port,'/ws/terminal?'+urllib.parse.urlencode({'terminal_id':tid,'cols':90,'rows':25}))
   try:
    initial=third.frames(.3)
    assert any(op==1 and json.loads(data).get('type')=='terminal_mouse_capture' and json.loads(data)['enabled'] for op,data in initial),initial[-2:]
   finally:third.close()
   ws.send({'type':'mouse','down':True,'column':26,'row':8,'modifiers':0})
   ws.send({'type':'mouse','down':False,'column':26,'row':8,'modifiers':0})
   frames=ws.frames(.5)
   for _ in range(30):
    if mouse_result.exists():break
    time.sleep(.1)
   assert mouse_result.exists(), 'mouse input did not reach the test app'
   assert mouse_result.read_bytes()==b'\x1b[<0;27;9M\x1b[<0;27;9m',mouse_result.read_bytes()
   assert any(op==1 and json.loads(data).get('type')=='terminal_mouse_capture' and not json.loads(data)['enabled'] for op,data in frames),frames[-2:]
   print(version,'PASS app click/release, mouse mode changes and late-viewer mode replay',flush=True)
  print(version,'PASS snapshot, command, events, terminal input/output, resize, scroll, multi-client and reconnect',flush=True)
  print(version,'PASS grid metadata, full baseline and dimension changes beside ANSI bytes',flush=True)
 finally:
  for w in [ws,events,second]:
   if w:w.close()
  if bp:
   bp.terminate()
   try:bp.wait(timeout=10)
   except subprocess.TimeoutExpired:bp.kill();bp.wait()
  subprocess.run([str(exe),'session','stop','passel-smoke'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
  try:server.wait(timeout=10)
  except subprocess.TimeoutExpired:server.terminate();server.wait(timeout=10)
  log.close()
for version,exe in [('0.8.2',args.herdr_old.resolve()),('0.9.3',args.herdr_new.resolve())]:
 with socket.socket() as probe:
  probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
 run(version,exe,port)
