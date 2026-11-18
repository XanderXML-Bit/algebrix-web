"""Generate the social card using the same shipped Sora/Manrope font files."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def font(family, size):
    path = next(Path(f'node_modules/@fontsource/{family}/files').glob(f'{family}-latin-400-normal.woff2'))
    return ImageFont.truetype(str(path), size)

image = Image.new('RGB', (1200, 630), '#080e19')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((70, 65, 158, 153), radius=20, fill='#6ba8ff')
draw.line([(90, 130), (114, 88), (138, 130)], fill='#080e19', width=9)
draw.line([(102, 115), (126, 115)], fill='#080e19', width=7)
draw.text((70, 195), 'Algebrix', font=font('sora', 92), fill='#f2f6ff')
draw.text((76, 335), 'Scientific math, graphs and everyday calculations.', font=font('manrope', 36), fill='#b4c2d9')
draw.line((76, 520, 144, 520), fill='#7bd2c2', width=5)
draw.text((168, 496), 'algebrix.zendren.net', font=font('manrope', 28), fill='#b4c2d9')
draw.text((905, 496), 'Zendren', font=font('sora', 28), fill='#7bd2c2')
image.save('public/og-image.png', optimize=True)
