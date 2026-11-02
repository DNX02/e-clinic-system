from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
FONT_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"

try:
    import imageio_ffmpeg
except ImportError:
    sys.path.insert(0, str(Path(os.environ["TEMP"]) / "eclinic-video-python"))
    import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

VIDEOS = {
    ("nurse", "ru"): [
        ("01-open.png", "Откройте приложение «Опросник медсестры».", 7),
        ("02-passport.png", "Введите фамилию и имя медсестры, затем данные пациента. Номер телефона обязателен.", 11),
        ("03-clinic.png", "Обязательно выберите поликлинику пациента.", 7),
        ("04-measurements.png", "Введите рост, вес и окружность талии. Индекс массы тела посчитается автоматически.", 10),
        ("05-findrisc.png", "В каждом вопросе FINDRISC выберите ответ. Пустые ответы отправить нельзя.", 11),
        ("06-pressure.png", "Укажите курение, верхнее и нижнее артериальное давление.", 8),
        ("07-submit.png", "Проверьте все обязательные поля и нажмите «Отправить анкету».", 8),
        ("08-result.png", "Результат покажет баллы и подскажет, нужно ли направить пациента к врачу.", 10),
    ],
    ("nurse", "tg"): [
        ("01-open.png", "Барномаи «Пурсишномаи ҳамшира»-ро кушоед.", 8),
        ("02-passport.png", "Насаб ва номи ҳамшира, сипас маълумоти беморро ворид кунед. Рақами телефон ҳатмист.", 12),
        ("03-clinic.png", "Поликлиникаи беморро ҳатман интихоб кунед.", 8),
        ("04-measurements.png", "Қад, вазн ва даври миёнро ворид кунед. Индекси массаи бадан худкор ҳисоб мешавад.", 12),
        ("05-findrisc.png", "Ба ҳар саволи FINDRISC ҷавоб интихоб кунед. Ҷавоби холиро фиристодан мумкин нест.", 12),
        ("06-pressure.png", "Тамокукашӣ, фишори болоӣ ва поёнии хунро нишон диҳед.", 9),
        ("07-submit.png", "Ҳамаи майдонҳои ҳатмиро санҷед ва «Фиристодани анкета»-ро пахш кунед.", 10),
        ("08-result.png", "Натиҷа холҳоро нишон медиҳад ва мегӯяд, ки беморро ба духтур равон кардан лозим аст ё не.", 12),
    ],
    ("doctor", "ru"): [
        ("01-login.png", "Войдите по своему логину и специальному ключу.", 8),
        ("02-patients.png", "После имени врача находится удобное меню. В разделе «Пациенты» открывается картотека.", 10),
        ("03-search.png", "Найдите пациента по фамилии, имени, телефону или дате рождения.", 9),
        ("04-card.png", "Откройте пациента и изучите анкету медсестры и историю осмотров.", 10),
        ("05-measurements.png", "Введите вес, рост, сахар крови, тип измерения и повторное давление.", 12),
        ("06-plan.png", "Укажите направление, план лечения, анализы, препараты и рекомендации.", 11),
        ("07-save.png", "Проверьте данные и нажмите «Сохранить осмотр».", 8),
        ("08-result.png", "Осмотр сохранён. Повторный визит появится в задачах врача.", 9),
    ],
    ("doctor", "tg"): [
        ("01-login.png", "Бо логин ва калиди махсуси худ ворид шавед.", 9),
        ("02-patients.png", "Пас аз номи духтур меню ҷойгир аст. Дар бахши «Беморон» картотека кушода мешавад.", 11),
        ("03-search.png", "Беморро аз рӯи насаб, ном, телефон ё санаи таваллуд ёбед.", 10),
        ("04-card.png", "Беморро кушоед ва анкетаи ҳамшира ва таърихи муоинаҳоро бинед.", 11),
        ("05-measurements.png", "Вазн, қад, қанди хун, навъи ченкунӣ ва фишори такрориро ворид кунед.", 13),
        ("06-plan.png", "Роҳхат, нақшаи табобат, таҳлилҳо, доруҳо ва тавсияҳоро нишон диҳед.", 11),
        ("07-save.png", "Маълумотро санҷед ва «Сабти муоина»-ро пахш кунед.", 9),
        ("08-result.png", "Муоина сабт шуд. Ташрифи такрорӣ дар вазифаҳои духтур пайдо мешавад.", 10),
    ],
}


def wrap(draw, text, font, width):
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def make_card(kind, language, screenshot_path, caption, step, destination):
    screenshot = Image.open(screenshot_path).convert("RGB")
    title_font = ImageFont.truetype(str(FONT_DIR / "arialbd.ttf"), 34)
    caption_font = ImageFont.truetype(str(FONT_DIR / "arial.ttf"), 27 if kind == "doctor" else 29)
    step_font = ImageFont.truetype(str(FONT_DIR / "arialbd.ttf"), 23 if kind == "doctor" else 25)
    step_word = "ҚАДАМИ" if language == "tg" else "ШАГ"
    if kind == "doctor":
        screenshot.thumbnail((1180, 650), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (1280, 720), "#eef7f4")
        draw = ImageDraw.Draw(canvas)
        canvas.paste(screenshot, ((1280 - screenshot.width) // 2, 0))
        draw.rounded_rectangle((25, 545, 1255, 700), radius=22, fill="white", outline="#87bfb0", width=3)
        draw.rounded_rectangle((48, 565, 182, 610), radius=12, fill="#0f766e")
        draw.text((62, 574), f"{step_word} {step}", font=step_font, fill="white")
        y = 565
        for line in wrap(draw, caption, caption_font, 990):
            draw.text((205, y), line, font=caption_font, fill="#173c36")
            y += 38
    else:
        screenshot.thumbnail((630, 1000), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (720, 1280), "#eef7f4")
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle((28, 24, 692, 115), radius=24, fill="#0f766e")
        draw.text((54, 47), "E-Clinic Control", font=title_font, fill="white")
        canvas.paste(screenshot, ((720 - screenshot.width) // 2, 135))
        draw.rounded_rectangle((34, 1000, 686, 1244), radius=28, fill="white", outline="#b9d9cf", width=3)
        draw.text((62, 1028), f"{step_word} {step}", font=step_font, fill="#0f766e")
        y = 1078
        for line in wrap(draw, caption, caption_font, 590):
            draw.text((62, y), line, font=caption_font, fill="#173c36")
            y += 39
    canvas.save(destination)


def speak(text, output):
    text_file = output.with_suffix(".txt")
    text_file.write_text(text, encoding="utf-8")
    command = (
        "Add-Type -AssemblyName System.Speech; "
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$s.SelectVoice('Microsoft Irina Desktop'); $s.Rate=-1; "
        f"$t=[IO.File]::ReadAllText('{text_file}',[Text.Encoding]::UTF8); "
        f"$s.SetOutputToWaveFile('{output}'); $s.Speak($t); $s.Dispose()"
    )
    subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], check=True)


def render(kind, language, scenes):
    work = ARTIFACTS / f"updated-{kind}-{language}-work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    source = ARTIFACTS / f"updated-{kind}-{language}-frames"
    segments = []
    for index, (filename, caption, seconds) in enumerate(scenes, start=1):
        card = work / f"card-{index:02d}.png"
        spoken = work / f"voice-{index:02d}.wav"
        segment = work / f"segment-{index:02d}.mp4"
        make_card(kind, language, source / filename, caption, index, card)
        speak(caption, spoken)
        subprocess.run([
            FFMPEG, "-y", "-loop", "1", "-i", str(card), "-i", str(spoken),
            "-vf", "fps=12", "-af", "apad", "-t", str(seconds),
            "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", str(segment)
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        segments.append(segment)
    concat = work / "concat.txt"
    concat.write_text("".join(f"file '{path.as_posix()}'\n" for path in segments), encoding="utf-8")
    output = ARTIFACTS / f"updated-review-{kind}-{language}.mp4"
    subprocess.run([
        FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
        "-c", "copy", "-movflags", "+faststart", str(output)
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(output)


for key, scenes in VIDEOS.items():
    render(*key, scenes)
