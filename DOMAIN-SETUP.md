# Подключение постоянного домена

Когда домен будет куплен, замените `example.ru` на ваш домен.

План постоянных ссылок:

- Приложение №1: `https://admin.example.ru`
- Приложение №2: `https://doctor.example.ru`
- Приложение №3: `https://survey.example.ru`

Что нужно сделать в Cloudflare:

1. Добавить купленный домен в Cloudflare.
2. Перевести DNS домена на nameserver-ы Cloudflare.
3. Создать постоянный Cloudflare Tunnel для этого компьютера.
4. Добавить Public Hostnames:
   - `admin.example.ru` -> `http://127.0.0.1:3000/app-1-admin-panel`
   - `doctor.example.ru` -> `http://127.0.0.1:3000/app-2-doctor`
   - `survey.example.ru` -> `http://127.0.0.1:3000/app-3-patient-survey`
5. Установить Cloudflare Tunnel как Windows Service.

После этого ссылки перестанут меняться при перезагрузке компьютера.

Текущий временный режим:

- Работает через `trycloudflare.com`.
- Ссылка может измениться после перезапуска.
- Свежие ссылки всегда записываются в `PUBLIC-LINKS.txt`.
