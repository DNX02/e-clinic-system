# Бесплатное внешнее размещение E-Clinic Control

Цель: сайт должен работать даже когда локальный компьютер выключен.

## Что меняется

Сейчас локальный сервер хранит данные в `data/db.json`.

После внешнего размещения:

- Node.js сервер работает на Render Free.
- Данные хранятся в PostgreSQL Neon Free или Supabase Free.
- Домен `e-clinic-control.ru` остается в Cloudflare.
- Локальная версия продолжает работать как раньше, если переменная `DATABASE_URL` не задана.

## Вариант, который проще всего попробовать

1. Neon Free для базы данных.
2. Render Free для Node.js сервера.
3. Cloudflare DNS для домена.

## Шаг 1. Создать базу Neon

1. Откройте `https://neon.tech/`.
2. Войдите через GitHub или email.
3. Создайте новый проект.
4. Region можно выбрать ближайший доступный.
5. Скопируйте строку подключения PostgreSQL.

Она будет выглядеть примерно так:

```text
postgresql://user:password@host.neon.tech/dbname?sslmode=require
```

Это значение нужно будет вставить в Render как `DATABASE_URL`.

## Шаг 2. Создать сервис Render

1. Откройте `https://render.com/`.
2. Войдите через GitHub.
3. Нажмите `New +`.
4. Выберите `Web Service`.
5. Подключите репозиторий:

```text
DNX02/e-clinic-system
```

6. Если Render увидит `render.yaml`, можно выбрать Blueprint.
7. Если создаете вручную:

```text
Build Command: npm install
Start Command: npm start
Environment: Node
Plan: Free
```

8. В Environment Variables добавьте:

```text
DATABASE_URL=строка_из_Neon
PGSSLMODE=require
NODE_ENV=production
```

9. Нажмите Deploy.

## Шаг 3. Проверить Render-ссылку

После деплоя Render даст ссылку вида:

```text
https://e-clinic-control.onrender.com
```

Проверьте:

```text
https://e-clinic-control.onrender.com/app-6-investor-dashboard
https://e-clinic-control.onrender.com/app-2-doctor
```

Если открывается, внешний сервер работает.

## Шаг 4. Подключить домены Cloudflare

В Cloudflare DNS нужно направить поддомены на Render.

Для каждого поддомена создается CNAME:

```text
admin      CNAME  e-clinic-control.onrender.com
doctor     CNAME  e-clinic-control.onrender.com
survey     CNAME  e-clinic-control.onrender.com
training   CNAME  e-clinic-control.onrender.com
nurse      CNAME  e-clinic-control.onrender.com
investor   CNAME  e-clinic-control.onrender.com
```

Proxy status можно оставить `Proxied`.

## Важное ограничение бесплатного Render

Render Free может засыпать после периода без активности.
Первое открытие сайта после сна может занять 30-60 секунд.

Для презентации и тестирования этого достаточно.
Для постоянной медицинской эксплуатации лучше потом перейти на платный VPS или Render Starter.

## Что уже подготовлено в коде

- Если `DATABASE_URL` есть, сервер использует PostgreSQL.
- Если `DATABASE_URL` нет, сервер использует локальный `data/db.json`.
- Render получает команду запуска из `render.yaml`.
- Данные в PostgreSQL хранятся в таблице `app_state` как JSONB.

## Как перенести текущие реальные данные

При первом запуске с `DATABASE_URL` сервер попытается взять данные из локального `data/db.json`, если файл доступен.
На Render этого файла обычно нет, поэтому там создастся новая пустая база.

Чтобы перенести реальные данные, нужно отдельно загрузить текущий `data/db.json` в PostgreSQL. Это следующий шаг после создания Neon и получения `DATABASE_URL`.

Команда для переноса с этого компьютера:

```powershell
$env:DATABASE_URL="postgresql://user:password@host.neon.tech/dbname?sslmode=require"
$env:PGSSLMODE="require"
npm install
npm run upload-db
```

После этого внешний сервер Render будет использовать уже заполненную облачную базу.
