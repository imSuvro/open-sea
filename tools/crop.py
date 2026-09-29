import sys
from PIL import Image
a=sys.argv
im=Image.open(a[1]); x0,y0,x1,y1=map(int,a[3:7]); sc=float(a[7]) if len(a)>7 else 2
c=im.crop((x0,y0,x1,y1)); c=c.resize((int(c.width*sc),int(c.height*sc)),Image.LANCZOS if sc<1 else Image.NEAREST); c.save(a[2])
