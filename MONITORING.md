# Мониторинг сервера

## Netdata

Netdata работает на VM `e-clinic-server-recovery` как служба `netdata.service`.

HTTP-проверки находятся только на сервере в `/etc/netdata/go.d/httpcheck.conf` и выполняются каждые 30 секунд для:

- административного приложения;
- приложения врача;
- инвесторской аналитики;
- панели мониторинга;
- приложения медсестры;
- анкеты пациента;
- учебного приложения;
- локального `/api/health`, включая проверку доступности базы данных.

Стандартные тревоги Netdata сообщают о недоступности, неправильном HTTP-статусе, тайм-ауте и ошибке содержимого локальной проверки базы.

## Telegram

Настройки Telegram хранятся только на сервере в `/etc/netdata/health_alarm_notify.conf`. Токен бота и идентификатор получателя нельзя добавлять в GitHub, сообщения или снимки экрана.

Проверка отправки:

```bash
sudo -u netdata /usr/libexec/netdata/plugins.d/alarm-notify.sh test
```

Успешная проверка отправляет три сообщения: `WARNING`, `CRITICAL` и `CLEAR`. После теста нужно убедиться, что все три сообщения пришли на телефон.

Если токен когда-либо был опубликован или отправлен в чат, его необходимо отозвать через `@BotFather`, создать новый и заменить значение `TELEGRAM_BOT_TOKEN` на сервере.

## Быстрая диагностика

```bash
systemctl status netdata --no-pager
journalctl -u netdata --since "1 hour ago" --no-pager
curl --fail http://127.0.0.1:3000/api/health
```

## Ежедневная проверка безопасности

Таймер `eclinic-security-audit.timer` ежедневно запускает локальную замену GitHub Actions. Проверка выполняется для последнего коммита `main` и включает:

- `npm audit` для рабочих зависимостей;
- проверку синтаксиса JavaScript и shell-скриптов;
- поиск случайно добавленных токенов, ключей и паролей в файлах Git.

При ошибке служба `eclinic-security-audit-notify.service` отправляет сообщение в Telegram через уже настроенного бота Netdata. Токен и получатель читаются из закрытого серверного файла и не копируются в репозиторий.

Проверка состояния:

```bash
systemctl status eclinic-security-audit.timer --no-pager
journalctl -u eclinic-security-audit.service -n 100 --no-pager
```

Безопасная ручная проверка Telegram-канала, не создающая настоящую ошибку службы:

```bash
sudo /usr/local/sbin/eclinic-security-audit-notify --test
```
