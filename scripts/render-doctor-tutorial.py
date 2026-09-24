from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FRAMES_DIR = ROOT / "artifacts" / "doctor-tutorial-frames"
OUTPUT_DIR = ROOT / "artifacts"
VIDEO = OUTPUT_DIR / "e-clinic-instrukciya-dlya-vrachey.mp4"
SILENT = OUTPUT_DIR / "e-clinic-vrachi-silent.mp4"
AUDIO = OUTPUT_DIR / "e-clinic-vrachi.wav"
TEMP_FRAMES = OUTPUT_DIR / "doctor-tutorial-video-frames"
TEMP_FRAMES.mkdir(parents=True, exist_ok=True)

font_dir = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
title_font = ImageFont.truetype(str(font_dir / "arialbd.ttf"), 34)
caption_font = ImageFont.truetype(str(font_dir / "arial.ttf"), 27)
step_font = ImageFont.truetype(str(font_dir / "arialbd.ttf"), 23)
scenes = [
    ("01-login.png", "Войдите по своему логину и специальному ключу.", 8),
    ("02-patients.png", "В разделе «Пациенты» находится картотека вашей поликлиники.", 9),
    ("03-search.png", "Введите фамилию, имя, телефон или дату рождения пациента.", 9),
    ("04-card.png", "Нажмите «Открыть» и изучите анкету медсестры и прежние осмотры.", 10),
    ("05-measurements.png", "Введите вес, рост, сахар крови, тип измерения и повторное давление.", 13),
    ("06-plan.png", "Укажите направление, план лечения, анализы, препараты и рекомендации.", 12),
    ("07-save.png", "Проверьте данные и нажмите «Сохранить осмотр».", 8),
    ("08-result.png", "Готово. Осмотр сохранён, а повторный визит появится в задачах врача.", 10),
]

def wrap(draw, text, font, width):
    words, lines, current = text.split(), [], ""
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

fps, frame_number = 12, 0
for index, (filename, caption, seconds) in enumerate(scenes, start=1):
    screenshot = Image.open(FRAMES_DIR / filename).convert("RGB")
    screenshot.thumbnail((1180, 650), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1280, 720), "#eef7f4")
    draw = ImageDraw.Draw(canvas)
    canvas.paste(screenshot, ((1280 - screenshot.width) // 2, 0))
    draw.rounded_rectangle((25, 545, 1255, 700), radius=22, fill="white", outline="#87bfb0", width=3)
    draw.rounded_rectangle((48, 565, 165, 610), radius=12, fill="#0f766e")
    draw.text((66, 574), f"ШАГ {index}", font=step_font, fill="white")
    y = 565
    for line in wrap(draw, caption, caption_font, 1010):
        draw.text((190, y), line, font=caption_font, fill="#173c36")
        y += 38
    for _ in range(seconds * fps):
        frame_number += 1
        canvas.save(TEMP_FRAMES / f"frame-{frame_number:05d}.jpg", quality=88)

try:
    import imageio_ffmpeg
except ImportError:
    sys.path.insert(0, str(Path(os.environ["TEMP"]) / "eclinic-video-python"))
    import imageio_ffmpeg

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ffmpeg, "-y", "-framerate", str(fps), "-i", str(TEMP_FRAMES / "frame-%05d.jpg"), "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p", str(SILENT)], check=True)
subprocess.run([ffmpeg, "-y", "-i", str(SILENT), "-i", str(AUDIO), "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(VIDEO)], check=True)
print(VIDEO)
