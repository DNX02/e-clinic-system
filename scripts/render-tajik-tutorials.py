from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "artifacts"
OUTPUT_DIR.mkdir(exist_ok=True)
FONT_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"

try:
    import imageio_ffmpeg
except ImportError:
    sys.path.insert(0, str(Path(os.environ["TEMP"]) / "eclinic-video-python"))
    import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
FPS = 12

NURSE_SCENES = [
    ("01-open.png", "Барномаи «Саволномаи ҳамшира»-ро кушоед.", 8),
    ("02-passport.png", "Ному насаби худ ва маълумоти шиносномаи беморро ворид кунед.", 10),
    ("03-clinic.png", "Дармонгоҳи беморро интихоб кунед.", 8),
    ("04-measurements.png", "Қад, вазн ва гирди миёнро ворид кунед. Индекси массаи бадан худкор ҳисоб мешавад.", 12),
    ("05-findrisc.png", "Ба саволҳои FINDRISC ҷавоб диҳед: фаъолияти ҷисмонӣ, ғизо, фишори хун, қанди хун ва ирсият.", 13),
    ("06-pressure.png", "Тамокукашӣ ва фишори артериявиро нишон диҳед.", 9),
    ("07-submit.png", "Маълумотро санҷед ва тугмаи «Фиристодани саволнома»-ро пахш кунед.", 10),
    ("08-result.png", "Натиҷа: FINDRISC понздаҳ — хатари баланд. Беморро ба назди духтур ва барои чен кардани қанди хун равон кунед.", 14),
]

DOCTOR_SCENES = [
    ("01-login.png", "Бо логин ва калиди махсуси худ ворид шавед.", 9),
    ("02-patients.png", "Дар бахши «Беморон» рӯйхати беморони дармонгоҳи шумо ҷойгир аст.", 10),
    ("03-search.png", "Ному насаб, рақами телефон ё санаи таваллуди беморро ворид кунед.", 10),
    ("04-card.png", "Тугмаи «Кушодан»-ро пахш карда, саволномаи ҳамшира ва муоинаҳои пешинаро бинед.", 12),
    ("05-measurements.png", "Вазн, қад, сатҳи қанди хун, навъи ченкунӣ ва фишори такрориро ворид кунед.", 13),
    ("06-plan.png", "Роҳхат, нақшаи табобат, таҳлилҳо, доруҳо ва тавсияҳоро нишон диҳед.", 11),
    ("07-save.png", "Маълумотро санҷед ва тугмаи «Сабти муоина»-ро пахш кунед.", 9),
    ("08-result.png", "Тайёр. Муоина сабт шуд ва ташрифи такрорӣ дар вазифаҳои духтур пайдо мешавад.", 11),
]


def wrap(draw, text, font, width):
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def create_audio(scenes, work_dir, output_audio):
    audio_dir = work_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    wav_files = []
    for index, (_, caption, seconds) in enumerate(scenes, start=1):
        text_file = audio_dir / f"scene-{index:02d}.txt"
        spoken_wav = audio_dir / f"scene-{index:02d}-spoken.wav"
        wav = audio_dir / f"scene-{index:02d}.wav"
        text_file.write_text(caption, encoding="utf-8")
        speech_command = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$s.SelectVoice('Microsoft Irina Desktop'); $s.Rate = -1; "
            f"$text = [IO.File]::ReadAllText('{text_file}', [Text.Encoding]::UTF8); "
            f"$s.SetOutputToWaveFile('{spoken_wav}'); $s.Speak($text); $s.Dispose()"
        )
        subprocess.run(["powershell.exe", "-NoProfile", "-Command", speech_command], check=True)
        subprocess.run([
            FFMPEG, "-y", "-i", str(spoken_wav), "-af", f"apad=pad_dur={seconds}",
            "-t", str(seconds), "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", str(wav)
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wav_files.append(wav)
    concat_file = audio_dir / "concat.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in wav_files), encoding="utf-8")
    subprocess.run([
        FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-c:a", "pcm_s16le", str(output_audio)
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def create_frames(kind, scenes, work_dir):
    source_dir = OUTPUT_DIR / f"{kind}-tutorial-frames-tg"
    frame_dir = work_dir / "frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    title_font = ImageFont.truetype(str(FONT_DIR / "arialbd.ttf"), 34)
    caption_font = ImageFont.truetype(str(FONT_DIR / "arial.ttf"), 27 if kind == "doctor" else 29)
    step_font = ImageFont.truetype(str(FONT_DIR / "arialbd.ttf"), 23 if kind == "doctor" else 25)
    frame_number = 0
    for index, (filename, caption, seconds) in enumerate(scenes, start=1):
        screenshot = Image.open(source_dir / filename).convert("RGB")
        if kind == "doctor":
            screenshot.thumbnail((1180, 650), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (1280, 720), "#eef7f4")
            draw = ImageDraw.Draw(canvas)
            canvas.paste(screenshot, ((1280 - screenshot.width) // 2, 0))
            draw.rounded_rectangle((25, 545, 1255, 700), radius=22, fill="white", outline="#87bfb0", width=3)
            draw.rounded_rectangle((48, 565, 175, 610), radius=12, fill="#0f766e")
            draw.text((64, 574), f"ҚАДАМИ {index}", font=step_font, fill="white")
            y = 565
            for line in wrap(draw, caption, caption_font, 1000):
                draw.text((200, y), line, font=caption_font, fill="#173c36")
                y += 38
        else:
            screenshot.thumbnail((630, 1000), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (720, 1280), "#eef7f4")
            draw = ImageDraw.Draw(canvas)
            draw.rounded_rectangle((28, 24, 692, 115), radius=24, fill="#0f766e")
            draw.text((54, 47), "E-Clinic Control", font=title_font, fill="white")
            canvas.paste(screenshot, ((720 - screenshot.width) // 2, 135))
            draw.rounded_rectangle((34, 1000, 686, 1244), radius=28, fill="white", outline="#b9d9cf", width=3)
            draw.text((62, 1028), f"ҚАДАМИ {index}", font=step_font, fill="#0f766e")
            y = 1078
            for line in wrap(draw, caption, caption_font, 590):
                draw.text((62, y), line, font=caption_font, fill="#173c36")
                y += 39
        for _ in range(seconds * FPS):
            frame_number += 1
            canvas.save(frame_dir / f"frame-{frame_number:05d}.jpg", quality=88)
    return frame_dir


def render(kind, scenes, output_name):
    work_dir = OUTPUT_DIR / f"{kind}-tutorial-tg-work"
    shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True)
    frame_dir = create_frames(kind, scenes, work_dir)
    silent = work_dir / "silent.mp4"
    audio = work_dir / "audio.wav"
    output = OUTPUT_DIR / output_name
    create_audio(scenes, work_dir, audio)
    subprocess.run([
        FFMPEG, "-y", "-framerate", str(FPS), "-i", str(frame_dir / "frame-%05d.jpg"),
        "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p", str(silent)
    ], check=True)
    subprocess.run([
        FFMPEG, "-y", "-i", str(silent), "-i", str(audio), "-c:v", "copy", "-c:a", "aac",
        "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(output)
    ], check=True)
    print(output)


def main():
    render("nurse", NURSE_SCENES, "e-clinic-dastur-baroi-hamshiraho-tg.mp4")
    render("doctor", DOCTOR_SCENES, "e-clinic-dastur-baroi-duhturon-tg.mp4")


if __name__ == "__main__":
    main()
