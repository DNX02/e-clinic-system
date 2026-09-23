from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FRAMES_DIR = ROOT / "artifacts" / "nurse-tutorial-frames"
OUTPUT_DIR = ROOT / "artifacts"
OUTPUT_DIR.mkdir(exist_ok=True)
VIDEO = OUTPUT_DIR / "e-clinic-instrukciya-dlya-medsester.mp4"
SILENT = OUTPUT_DIR / "e-clinic-instrukciya-silent.mp4"
AUDIO = OUTPUT_DIR / "e-clinic-instrukciya.wav"
TEMP_FRAMES = OUTPUT_DIR / "nurse-tutorial-video-frames"
TEMP_FRAMES.mkdir(exist_ok=True)

font_path = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arial.ttf"
bold_path = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arialbd.ttf"
title_font = ImageFont.truetype(str(bold_path), 34)
caption_font = ImageFont.truetype(str(font_path), 29)
step_font = ImageFont.truetype(str(bold_path), 25)

scenes = [
    ("01-open.png", "Откройте приложение «Опросник медсестры».", 7),
    ("02-passport.png", "Введите своё ФИО и паспортные данные пациента.", 9),
    ("03-clinic.png", "Выберите поликлинику пациента.", 7),
    ("04-measurements.png", "Введите рост, вес и окружность талии. ИМТ посчитается автоматически.", 10),
    ("05-findrisc.png", "Ответьте на вопросы FINDRISC: активность, питание, давление, сахар и наследственность.", 12),
    ("06-pressure.png", "Укажите курение и артериальное давление.", 8),
    ("07-submit.png", "Проверьте данные и нажмите «Отправить анкету».", 8),
    ("08-result.png", "Результат: FINDRISC 15 — высокий риск. Направьте пациента к врачу и на измерение сахара крови.", 13),
]

def wrap(draw, text, font, width):
    words = text.split()
    lines, current = [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines

fps = 12
frame_number = 0
for index, (filename, caption, seconds) in enumerate(scenes, start=1):
    screenshot = Image.open(FRAMES_DIR / filename).convert("RGB")
    screenshot.thumbnail((630, 1000), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (720, 1280), "#eef7f4")
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((28, 24, 692, 115), radius=24, fill="#0f766e")
    draw.text((54, 47), "E-Clinic Control", font=title_font, fill="white")
    phone_x = (720 - screenshot.width) // 2
    canvas.paste(screenshot, (phone_x, 135))
    caption_top = 1000
    draw.rounded_rectangle((34, caption_top, 686, 1244), radius=28, fill="white", outline="#b9d9cf", width=3)
    draw.text((62, caption_top + 28), f"ШАГ {index}", font=step_font, fill="#0f766e")
    y = caption_top + 78
    for line in wrap(draw, caption, caption_font, 590):
        draw.text((62, y), line, font=caption_font, fill="#173c36")
        y += 39
    for _ in range(seconds * fps):
        frame_number += 1
        canvas.save(TEMP_FRAMES / f"frame-{frame_number:05d}.jpg", quality=88)

try:
    import imageio_ffmpeg
except ImportError:
    sys.path.insert(0, str(Path(os.environ["TEMP"]) / "eclinic-video-python"))
    import imageio_ffmpeg

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([
    ffmpeg, "-y", "-framerate", str(fps), "-i", str(TEMP_FRAMES / "frame-%05d.jpg"),
    "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p", str(SILENT)
], check=True)
subprocess.run([
    ffmpeg, "-y", "-i", str(SILENT), "-i", str(AUDIO), "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart", str(VIDEO)
], check=True)
print(VIDEO)
