"""Renders the nurse and doctor training videos from scripts/capture-tutorials.mjs screenshots.

Vertical 1080x1920 H.264 (phones, WhatsApp). Each scene: the real app screen, a zoom to the part
that matters, a pulsing ring around the button, captions in Tajik (large) and Russian (below).
Needs: ffmpeg, Pillow, qrcode.  Usage:
    node scripts/capture-tutorials.mjs artifacts/tutorials
    python3 scripts/render-tutorials.py artifacts/tutorials
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 25
GREEN = (15, 107, 92)
DARK = (22, 27, 34)
GREY = (90, 98, 110)
RING = (255, 122, 0)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
AREA = (40, 236, 1040, 1476)  # where the phone screen is shown
CAPTION_TOP = 1506

VIDEOS = {
    "nurse": {
        "file": "e-clinic-dastur-hamshira.mp4",
        "title_tj": "Дастур барои ҳамшира",
        "title_ru": "Инструкция для медсестры",
        "url": "https://survey.e-clinic-control.ru/",
        "scenes": {
            "01-language": ("Истинодро кушоед ва забонро интихоб кунед: «Тоҷикӣ» ё «Русский».", "Откройте ссылку и выберите язык: «Тоҷикӣ» или «Русский»."),
            "02-nurse-name": ("Ному насаби худро нависед. Он дар ҳар анкета сабт мешавад.", "Впишите свои ФИО. Они сохраняются в каждой анкете."),
            "03-patient": ("Маълумоти беморро пур кунед. Синну сол аз санаи таваллуд худ ба худ ҳисоб мешавад.", "Заполните данные пациента. Возраст рассчитается сам по дате рождения."),
            "04-clinic": ("Дармонгоҳи беморро интихоб кунед.", "Выберите поликлинику пациента."),
            "05-measurements": ("Қад, вазн ва даври миёнро ворид кунед. Индекси массаи бадан худ ба худ ҳисоб мешавад.", "Введите рост, вес и окружность талии. ИМТ рассчитается сам."),
            "06-findrisc": ("Ба ҳамаи саволҳои FINDRISC ҷавоб диҳед.", "Ответьте на все вопросы FINDRISC."),
            "07-pressure": ("Тамокукашӣ ва фишори хунро нависед.", "Укажите курение и артериальное давление."),
            "08-submit": ("Ҳамаашро санҷед ва «Фиристодани анкета»-ро пахш кунед.", "Проверьте всё и нажмите «Отправить анкету»."),
            "09-result": ("Натиҷа фавран пайдо мешавад. Агар хавф баланд бошад — беморро ба духтур фиристед.", "Результат появится сразу. При высоком риске направьте пациента к врачу."),
            "10-offline": ("Агар интернет набошад, анкета гум намешавад — он дар телефон нигоҳ дошта мешавад.", "Если нет интернета, анкета не пропадёт — она сохранится в телефоне."),
            "11-saved-list": ("Анкетаҳои нафиристода дар «Анкетаҳои нигоҳдошта» ҳастанд. Онҳоро нест накунед.", "Неотправленные анкеты лежат в «Анкетаҳои нигоҳдошта» (сохранённые). Не удаляйте их."),
            "12-sync-button": ("Вақте интернет пайдо шавад, «Ҳамоҳангсозӣ»-ро пахш кунед.", "Когда появится интернет, нажмите «Синхронизировать» (Ҳамоҳангсозӣ)."),
            "13-synced": ("Тайёр! Навишта шудааст: «Ҳама анкетаҳо фиристода шуданд».", "Готово! Написано: «Все анкеты отправлены»."),
        },
    },
    "doctor": {
        "file": "e-clinic-dastur-dukhtur.mp4",
        "title_tj": "Дастур барои духтур",
        "title_ru": "Инструкция для врача",
        "url": "https://doctor.e-clinic-control.ru/",
        "scenes": {
            "01-login": ("Забонро интихоб кунед, логин ва калиди худро ворид кунед ва «Ворид шудан»-ро пахш кунед.", "Выберите язык, введите логин и ключ и нажмите «Войти» (Ворид шудан)."),
            "02-counters": ("Дар боло рақамҳо: беморони дармонгоҳ, иловакардаи шумо ва муоинаҳои шумо.", "Вверху цифры: пациенты поликлиники, добавленные вами и ваши осмотры."),
            "03-search": ("Беморро аз рӯи ному насаб, телефон ё санаи таваллуд ёбед.", "Найдите пациента по ФИО, телефону или дате рождения."),
            "04-open": ("«Кушодан»-ро пахш кунед.", "Нажмите «Открыть» (Кушодан)."),
            "05-card": ("Анкетаи ҳамшира ва сабабҳои равонасозиро бинед.", "Посмотрите анкету медсестры и причины направления."),
            "06-sugar": ("Вазн, қад ва қанди хунро ворид кунед. Ташхис аз рӯи қанд худ ба худ пешниҳод мешавад.", "Введите вес, рост и сахар крови. Диагноз по сахару подставится сам."),
            "07-pressure": ("Фишори хунро такроран чен кунед ва мӯҳлати муоинаи такрориро нависед.", "Повторно измерьте давление и укажите срок повторного осмотра."),
            "08-plan": ("Равонасозӣ, нақшаи табобат ва доруҳоро интихоб кунед.", "Отметьте направления, план лечения и препараты."),
            "09-save": ("«Нигоҳ доштани муоина»-ро пахш кунед.", "Нажмите «Сохранить осмотр» (Нигоҳ доштани муоина)."),
            "10-saved": ("Муоина сабт шуд — рақами «Муоинаҳои сабткардаи ман» зиёд шуд.", "Осмотр сохранён — число «Мои сохранённые осмотры» выросло."),
            "11-add-button": ("Бемори навро бо тугмаи «Илова кардани бемор» илова кунед.", "Нового пациента добавьте кнопкой «Добавить пациента»."),
            "12-added-hint": ("Пас аз илова муоинаро пур кунед ва сабт кунед — танҳо он гоҳ муоина ба ҳисоб меравад.", "После добавления заполните и сохраните осмотр — только тогда он засчитается."),
            "13-sync": ("Агар интернет набошад, сабт дар телефон мемонад. Баъд «Ҳамоҳангсозӣ»-ро пахш кунед.", "Без интернета запись остаётся в телефоне. Потом нажмите «Синхронизировать»."),
        },
    },
}

font = lambda size, bold=False: ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if draw.textlength(candidate, font=fnt) <= width:
            line = candidate
        else:
            lines.append(line)
            line = word
    return lines + ([line] if line else [])


def background(video, step=None, total=None):
    img = Image.new("RGB", (W, H), (238, 243, 242))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 200], fill=GREEN)
    d.text((48, 52), video["title_tj"], font=font(46, True), fill="white")
    d.text((48, 118), f"{video['title_ru']}  ·  E-Clinic", font=font(32), fill=(210, 235, 230))
    if step:
        label = f"{step}/{total}"
        d.rounded_rectangle([W - 210, 60, W - 48, 140], radius=40, fill=(255, 255, 255))
        d.text((W - 129, 100), label, font=font(42, True), fill=GREEN, anchor="mm")
    return img


def caption_card(img, tj, ru):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([30, CAPTION_TOP, W - 30, H - 30], radius=36, fill="white", outline=(214, 224, 222), width=2)
    y = CAPTION_TOP + 34
    tj_font, ru_font = font(48, True), font(36)
    tj_lines, ru_lines = wrap(d, tj, tj_font, W - 140), wrap(d, ru, ru_font, W - 140)
    while len(tj_lines) * 60 + len(ru_lines) * 46 + 24 > H - 30 - CAPTION_TOP - 50 and tj_font.size > 36:
        tj_font, ru_font = font(tj_font.size - 4, True), font(ru_font.size - 3)
        tj_lines, ru_lines = wrap(d, tj, tj_font, W - 140), wrap(d, ru, ru_font, W - 140)
    for line in tj_lines:
        d.text((70, y), line, font=tj_font, fill=DARK)
        y += int(tj_font.size * 1.25)
    y += 18
    for line in ru_lines:
        d.text((70, y), line, font=ru_font, fill=GREY)
        y += int(ru_font.size * 1.28)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def views(shot, box, scale):
    """Source rect for the full screen and for the zoom on the highlighted box (source pixels)."""
    sw, sh = shot.size
    area_w, area_h = AREA[2] - AREA[0], AREA[3] - AREA[1]
    full = (0, 0, sw, sh)
    if not box:
        return full, full
    crop_h = sw * area_h / area_w
    centre = (box["y"] + box["height"] / 2) * scale
    if box["height"] * scale > crop_h * 0.9:
        centre = box["y"] * scale + crop_h * 0.45
    top = max(0, min(sh - crop_h, centre - crop_h / 2))
    return full, (0, top, sw, top + crop_h)


def render_scene(base, shot, box, scale, t, duration):
    """One frame: zoom from the full screen to the target, then a pulsing ring."""
    full, zoom = views(shot, box, scale)
    k = ease((t - 0.5) / 0.9)
    src = [full[i] + (zoom[i] - full[i]) * k for i in range(4)]
    area_w, area_h = AREA[2] - AREA[0], AREA[3] - AREA[1]
    src_w, src_h = src[2] - src[0], src[3] - src[1]
    fit = min(area_w / src_w, area_h / src_h)
    out_w, out_h = int(src_w * fit), int(src_h * fit)
    ox, oy = AREA[0] + (area_w - out_w) // 2, AREA[1] + (area_h - out_h) // 2
    frame = base.copy()
    view = shot.resize((out_w, out_h), Image.BILINEAR, box=tuple(src))
    mask = Image.new("L", (out_w, out_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, out_w - 1, out_h - 1], radius=28, fill=255)
    frame.paste(view, (ox, oy), mask)
    d = ImageDraw.Draw(frame)
    d.rounded_rectangle([ox - 3, oy - 3, ox + out_w + 2, oy + out_h + 2], radius=30, outline=(190, 204, 201), width=3)
    if box and t > 1.4:
        pulse = 0.5 + 0.5 * math.sin((t - 1.4) * 2 * math.pi / 1.1)
        pad = 10 + 8 * pulse
        x0 = ox + (box["x"] * scale - src[0]) * fit - pad
        y0 = oy + (box["y"] * scale - src[1]) * fit - pad
        x1 = ox + ((box["x"] + box["width"]) * scale - src[0]) * fit + pad
        y1 = oy + ((box["y"] + box["height"]) * scale - src[1]) * fit + pad
        y0, y1 = max(y0, AREA[1] - 6), min(y1, AREA[3] + 6)
        d.rounded_rectangle([x0, y0, x1, y1], radius=22, outline=RING, width=int(7 + 3 * pulse))
    return frame


def title_card(video, outro=False):
    img = Image.new("RGB", (W, H), GREEN)
    d = ImageDraw.Draw(img)
    if not outro:
        d.text((W / 2, 700), "E-Clinic", font=font(64, True), fill=(200, 235, 228), anchor="mm")
        d.text((W / 2, 860), video["title_tj"], font=font(76, True), fill="white", anchor="mm")
        d.text((W / 2, 960), video["title_ru"], font=font(50), fill=(215, 240, 235), anchor="mm")
        d.text((W / 2, 1130), "Скрининги диабет ва фишори хун", font=font(38), fill=(200, 230, 224), anchor="mm")
        d.text((W / 2, 1190), "Скрининг диабета и давления", font=font(34), fill=(185, 220, 214), anchor="mm")
        return img
    qr = qrcode.QRCode(box_size=18, border=2)
    qr.add_data(video["url"])
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color=GREEN, back_color="white").convert("RGB").resize((700, 700), Image.NEAREST)
    d.rounded_rectangle([170, 380, 910, 1120], radius=40, fill="white")
    img.paste(qr_img, (190, 400))
    d.text((W / 2, 1230), video["url"].rstrip("/").replace("https://", ""), font=font(46, True), fill="white", anchor="mm")
    d.text((W / 2, 1360), "Саволҳо бошад — ба маъмур муроҷиат кунед.", font=font(38), fill=(215, 240, 235), anchor="mm")
    d.text((W / 2, 1420), "Вопросы — к администратору.", font=font(34), fill=(195, 228, 222), anchor="mm")
    d.text((W / 2, 260), "Ташаккур!  ·  Спасибо!", font=font(60, True), fill="white", anchor="mm")
    return img


def scene_duration(tj, ru):
    return round(max(6.5, 2.0 + max(len(tj) / 13, len(ru) / 15)), 1)


def render(video, frames_dir, scenes, scale, out_path):
    ffmpeg = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_path)
    ], stdin=subprocess.PIPE)
    previous = None
    total_seconds = 0.0

    def emit(frame, fade_from=None, i=0, fade_frames=10):
        if fade_from is not None and i < fade_frames:
            frame = Image.blend(fade_from, frame, (i + 1) / fade_frames)
        ffmpeg.stdin.write(frame.tobytes())

    intro = title_card(video)
    for i in range(int(3.5 * FPS)):
        emit(intro)
    previous, total_seconds = intro, 3.5
    texts = video["scenes"]
    for number, scene in enumerate(scenes, 1):
        tj, ru = texts[scene["name"]]
        base = background(video, number, len(scenes))
        caption_card(base, tj, ru)
        shot = Image.open(frames_dir / scene["file"]).convert("RGB")
        duration = scene_duration(tj, ru)
        frame = None
        for i in range(int(duration * FPS)):
            frame = render_scene(base, shot, scene["box"], scale, i / FPS, duration)
            emit(frame, previous, i)
        previous, total_seconds = frame, total_seconds + duration
    outro = title_card(video, outro=True)
    for i in range(int(5 * FPS)):
        emit(outro, previous, i)
    total_seconds += 5
    ffmpeg.stdin.close()
    if ffmpeg.wait() != 0:
        raise SystemExit(f"ffmpeg failed for {out_path}")
    return total_seconds


def main():
    frames_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/tutorials")
    meta = json.loads((frames_dir / "scenes.json").read_text(encoding="utf-8"))
    scale = meta["viewport"]["scale"]
    for key, video in VIDEOS.items():
        scenes = meta["scenes"][key]
        missing = [s["name"] for s in scenes if s["name"] not in video["scenes"]]
        if missing:
            raise SystemExit(f"{key}: no captions for scenes {missing}")
        out = frames_dir / video["file"]
        seconds = render(video, frames_dir, scenes, scale, out)
        print(f"{out}  {len(scenes)} scenes, {seconds:.0f} s")


if __name__ == "__main__":
    main()
