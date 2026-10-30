# ブランド素材の生成（4-4 の事前修正）: public/brand/icon-source.png（正方形・角丸の外は白）から
# icon-512 / icon-192（角丸・外は透明）、icon-maskable-512 / apple-touch-icon（180px。角を紺で塗った全面）、
# favicon.ico（16・32・48）を作り、logo.png の透明な余白をトリムする（幅 2000px を超えたら縮小）。
# 使い方: python3 -I scripts/brand-icons.py public/brand   （Pillow が必要。npm の依存には入れない）
import sys
from PIL import Image, ImageDraw
d = sys.argv[1]
src = Image.open(f'{d}/icon-source.png').convert('RGB')
W = src.size[0]
px = src.load()
navy = px[60, W // 2]
print('navy', navy, 'corner', px[2, 2])
# 角丸の外（四隅から塗りつぶしでつながる明るい画素）を探す
mask = Image.new('L', src.size, 0)
seen = set()
stack = [(0, 0), (W - 1, 0), (0, W - 1), (W - 1, W - 1)]
def bright(p): return sum(p) > 600
while stack:
    x, y = stack.pop()
    if (x, y) in seen or not (0 <= x < W and 0 <= y < W): continue
    seen.add((x, y))
    if not bright(px[x, y]): continue
    mask.putpixel((x, y), 255)
    stack += [(x+1,y),(x-1,y),(x,y+1),(x,y-1)]
# 縁のアンチエイリアスを含めるため 2px 太らせる
from PIL import ImageFilter
outside = mask.filter(ImageFilter.MaxFilter(5))
# 全面（maskable・apple-touch）: 外を紺で塗る
full = src.copy()
full.paste(Image.new('RGB', src.size, navy), (0, 0), outside)
# 角丸（通常）: 外を透明に。縁はなめらかに
alpha = Image.eval(outside.filter(ImageFilter.GaussianBlur(1.5)), lambda v: 255 - v)
rounded = full.convert('RGBA'); rounded.putalpha(alpha)
def save(im, size, name):
    # 元画像の圧縮ノイズで PNG が膨らむので 64 色に減色する（絵は単色の組み合わせなので見た目は変わらない）
    small = im.convert('RGBA').resize((size, size), Image.LANCZOS)
    small.quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
        f'{d}/{name}', optimize=True)
save(rounded, 512, 'icon-512.png')
save(rounded, 192, 'icon-192.png')
save(full, 512, 'icon-maskable-512.png')
save(full, 180, 'apple-touch-icon.png')
rounded.resize((256, 256), Image.LANCZOS).save(f'{d}/favicon.ico', sizes=[(16,16),(32,32),(48,48)])
# ロゴ: 透明な余白をトリム（周りに 2% 残す）
logo = Image.open(f'{d}/logo.png')
bbox = logo.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
pad = int(logo.size[0] * 0.02)
bbox = (max(0, bbox[0]-pad), max(0, bbox[1]-pad), min(logo.size[0], bbox[2]+pad), min(logo.size[1], bbox[3]+pad))
logo = logo.crop(bbox)
if logo.size[0] > 2000:
    logo = logo.resize((2000, round(logo.size[1] * 2000 / logo.size[0])), Image.LANCZOS)
logo.save(f'{d}/logo.png', optimize=True)
print('logo', logo.size)
