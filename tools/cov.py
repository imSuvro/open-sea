import sys
from PIL import Image
import numpy as np
for f in sys.argv[1:]:
    im=np.asarray(Image.open(f).convert('L')).astype(float)/255
    h=im.shape[0]
    sea=im[int(h*0.5):int(h*0.7),:]     # skip UI region
    print(f, 'coverage(mask>0.5)=%.3f  mean=%.3f'%((sea>0.5).mean(), sea.mean()))
