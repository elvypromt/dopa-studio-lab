import pathlib
h = pathlib.Path(__file__).parent
css = (h / '../index.html').read_text().split('<style>', 1)[1].split('</style>', 1)[0]
(h / 'index.html').write_text((h / 'src.html').read_text().replace('/*PROTO_CSS*/', css.strip()))
print('ok')
