"""Printable QR sheets (A4 PDF) and PNGs for messengers: doctor app and nurse survey.

Usage (needs: pip install "qrcode[pil]" reportlab):
    python3 scripts/build-qr-sheets.py [output_dir]
The QR is generated locally (no third-party QR service). Text is in Tajik and Russian;
button names match the app's own Tajik labels.
"""
import sys
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
GREEN = (15, 107, 92)

SHEETS = [
    {
        "file": "qr-kabinet-vracha",
        "url": "https://doctor.e-clinic-control.ru/",
        "title_tj": "Кабинети духтур",
        "title_ru": "Кабинет врача",
        "qr_mm": 120,
        "steps_tj": [
            "Камераи телефонро ба QR-код равона кунед ва истинодро кушоед.",
            "Логин ва пароли худро ворид кунед (онҳоро маъмур медиҳад).",
            "Барои зуд кушодан: дар менюи браузер «Ба экрани асосӣ илова кардан»-ро интихоб кунед.",
        ],
        "steps_ru": [
            "Наведите камеру телефона на QR-код и откройте ссылку.",
            "Введите свой логин и пароль (выдаёт администратор).",
            "Чтобы открывать быстро: в меню браузера выберите «Добавить на главный экран».",
        ],
        "warning_tj": "Логин ва паролро ба касе надиҳед",
        "warning_ru": "Никому не передавайте логин и пароль",
    },
    {
        "file": "qr-anketa-medsestry",
        "url": "https://survey.e-clinic-control.ru/",
        "title_tj": "Пурсишномаи ҳамшира",
        "title_ru": "Анкета медсестры (скрининг)",
        "qr_mm": 86,
        "steps_tj": [
            "Камераи телефонро ба QR-код равона кунед ва истинодро кушоед.",
            "Забонро интихоб кунед, ному насаби худро нависед ва анкетаро пур кунед. Баъд «Фиристодани анкета»-ро пахш кунед.",
            "Агар интернет набошад, анкета дар телефон нигоҳ дошта мешавад. Вақте интернет пайдо шавад, «Ҳамоҳангсозӣ»-ро пахш кунед.",
            "Барои зуд кушодан: дар менюи браузер «Ба экрани асосӣ илова кардан»-ро интихоб кунед.",
        ],
        "steps_ru": [
            "Наведите камеру телефона на QR-код и откройте ссылку.",
            "Выберите язык, впишите свои ФИО и заполните анкету. Затем нажмите «Отправить анкету».",
            "Если нет интернета, анкета сохранится в телефоне. Когда интернет появится, нажмите «Синхронизировать».",
            "Чтобы открывать быстро: в меню браузера выберите «Добавить на главный экран».",
        ],
        "warning_tj": "Анкетаҳои нафиристодаро нест накунед",
        "warning_ru": "Не удаляйте неотправленные анкеты",
    },
]


def make_qr(url: str) -> Image.Image:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=20, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    return qr.make_image(fill_color=GREEN, back_color="white").convert("RGB")


def wrap(c: canvas.Canvas, text: str, font: str, size: float, width: float) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if c.stringWidth(candidate, font, size) <= width:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def build_pdf(sheet: dict, qr_img: Image.Image, path: Path) -> None:
    pdfmetrics.registerFont(TTFont("DejaVu", FONT))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", FONT_BOLD))
    width, height = A4
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(f"E-Clinic — {sheet['title_ru']} (QR)")
    c.setFillColorRGB(*[v / 255 for v in GREEN])
    c.rect(0, height - 38 * mm, width, 38 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("DejaVu-Bold", 30)
    c.drawCentredString(width / 2, height - 20 * mm, sheet["title_tj"])
    c.setFont("DejaVu", 18)
    c.drawCentredString(width / 2, height - 30 * mm, f"{sheet['title_ru']}  ·  E-Clinic")

    qr_size = sheet["qr_mm"] * mm
    qr_y = height - 44 * mm - qr_size
    c.drawImage(ImageReader(qr_img), (width - qr_size) / 2, qr_y, qr_size, qr_size)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.setFont("DejaVu-Bold", 17)
    c.drawCentredString(width / 2, qr_y - 9 * mm, sheet["url"].rstrip("/"))

    y = qr_y - 22 * mm
    text_width = width - 40 * mm
    for heading, steps in (("Чӣ тавр истифода бурдан", sheet["steps_tj"]), ("Как пользоваться", sheet["steps_ru"])):
        c.setFont("DejaVu-Bold", 14)
        c.setFillColorRGB(*[v / 255 for v in GREEN])
        c.drawString(20 * mm, y, heading)
        y -= 7 * mm
        c.setFillColorRGB(0.1, 0.1, 0.1)
        for number, step in enumerate(steps, 1):
            lines = wrap(c, step, "DejaVu", 12, text_width - 8 * mm)
            c.setFont("DejaVu-Bold", 12)
            c.drawString(20 * mm, y, f"{number}.")
            c.setFont("DejaVu", 12)
            for line in lines:
                c.drawString(28 * mm, y, line)
                y -= 5.6 * mm
            y -= 1.2 * mm
        y -= 4 * mm

    c.setFont("DejaVu-Bold", 11)
    c.setFillColorRGB(0.7, 0.13, 0.1)
    c.drawCentredString(width / 2, 14 * mm, f"{sheet['warning_tj']}.  ·  {sheet['warning_ru']}.")
    if y < 22 * mm:
        raise SystemExit(f"{path.name}: text runs into the footer, make the QR smaller")
    c.showPage()
    c.save()


def build_png(sheet: dict, qr_img: Image.Image, path: Path) -> None:
    size = 1080
    img = Image.new("RGB", (size, size + 260), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, size, 150], fill=GREEN)
    title = ImageFont.truetype(FONT_BOLD, 64)
    subtitle = ImageFont.truetype(FONT, 38)
    url_font = ImageFont.truetype(FONT_BOLD, 40)
    draw.text((size / 2, 62), sheet["title_tj"], font=title, fill="white", anchor="mm")
    draw.text((size / 2, 122), sheet["title_ru"], font=subtitle, fill="white", anchor="mm")
    qr = qr_img.resize((860, 860), Image.NEAREST)
    img.paste(qr, ((size - 860) // 2, 185))
    draw.text((size / 2, 1095), sheet["url"].rstrip("/"), font=url_font, fill=(25, 25, 25), anchor="mm")
    note = ImageFont.truetype(FONT, 30)
    draw.text((size / 2, 1160), sheet["warning_tj"], font=note, fill=(180, 35, 25), anchor="mm")
    draw.text((size / 2, 1205), sheet["warning_ru"], font=note, fill=(180, 35, 25), anchor="mm")
    img.save(path, optimize=True)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/qr")
    out.mkdir(parents=True, exist_ok=True)
    for sheet in SHEETS:
        qr_img = make_qr(sheet["url"])
        build_pdf(sheet, qr_img, out / f"{sheet['file']}.pdf")
        build_png(sheet, qr_img, out / f"{sheet['file']}.png")
        print(f"Saved {out / sheet['file']}.pdf and .png -> {sheet['url']}")


if __name__ == "__main__":
    main()
