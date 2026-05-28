"""
Gera HTML standalone com CSS, JS, dados e logo embutidos.
Tambem publica essa versao em index.html para o GitHub Pages.
"""

from pathlib import Path
import base64


ROOT = Path(__file__).resolve().parents[1]
SOURCE_HTML = "index.source.html"
STANDALONE_HTML = "mapa-cooperativa-standalone.html"
PAGES_HTML = "index.html"


def read_text(path):
    return (ROOT / path).read_text(encoding="utf-8")


def read_data_uri(path, mime_type):
    data = (ROOT / path).read_bytes()
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def build_html(include_manifest):
    html = read_text(SOURCE_HTML)
    css = read_text("css/style.css")
    map_js = read_text("js/map.js")
    ui_js = read_text("js/ui.js")
    app_js = read_text("js/app.js")
    mapa_data = read_text("data/municipios.json")
    brasil_data = read_text("data/brasil.json")
    logo_uri = read_data_uri("icons/sicredi-horizontal-box-rgb.png", "image/png")

    if not include_manifest:
        html = html.replace('  <link rel="manifest" href="manifest.json">\n', "")
    html = html.replace('src="icons/sicredi-horizontal-box-rgb.png"', f'src="{logo_uri}"')
    html = html.replace('  <link rel="stylesheet" href="css/style.css">', f"  <style>\n{css}\n  </style>")
    html = html.replace(
        '<script src="js/map.js"></script>\n<script src="js/ui.js"></script>\n<script src="js/app.js"></script>',
        "\n".join([
            "<script>",
            f"window.__MAPA_DATA__ = {mapa_data};",
            f"window.__BRASIL_DATA__ = {brasil_data};",
            "</script>",
            f"<script>\n{map_js}\n</script>",
            f"<script>\n{ui_js}\n</script>",
            f"<script>\n{app_js}\n</script>",
        ]),
    )

    return html


def write_output(path, html):
    out = ROOT / path
    out.write_text(html, encoding="utf-8")
    print(f"Gerado {out.name} ({out.stat().st_size / 1024:.1f} KB)")


def main():
    write_output(STANDALONE_HTML, build_html(include_manifest=False))
    write_output(PAGES_HTML, build_html(include_manifest=True))


if __name__ == "__main__":
    main()
