# Резервное копирование и восстановление

## Текущая защита

- **AWS Lightsail (текущий production):**
  - Инстанс `e-clinic-server` (`13.63.64.38`, `eu-north-1a`, Стокгольм).
  - Снимки диска: автоматические ежедневные снимки в консоли Lightsail (вкладка «Снимки»).
  - База данных: локальный PostgreSQL 16 (`localhost:5432`), порт закрыт снаружи.
- **Google Cloud (резервная точка отката):**
  - Точка восстановления Cloud SQL: `pre-aws-migration-20261102` (статус `SUCCESSFUL`).
  - Cloud SQL `eclinic-postgres`: автоматическая копия каждый день в `02:00`, хранение 7 копий.
  - Для Cloud SQL включено восстановление на выбранный момент времени (PITR), журналы хранятся 7 дней.
  - Диск VM `e-clinic-server-recovery`: ежедневный снимок в `22:00`, хранение 7 дней.
  - Для VM включена защита от случайного удаления.
- Перед каждым автоматическим деплоем код предыдущего выпуска сохраняется в `/opt/e-clinic-deploy-backups`; хранятся последние 5 архивов.

## Проверка копий

```bash
# AWS Lightsail: проверить статус снимков через браузер (консоль Lightsail -> Снимки)
# Google Cloud (standby точка отката):
gcloud sql backups list --instance=eclinic-postgres --project=project-d1c58e2c-ee1b-4604-99b
gcloud compute snapshots list --project=project-d1c58e2c-ee1b-4604-99b
gcloud compute disks describe e-clinic-server-recovery --zone=us-central1-a --project=project-d1c58e2c-ee1b-4604-99b
```

Проверять нужно не только наличие записи, но и статус `SUCCESSFUL` для Cloud SQL и `READY` для снимка VM.

## Восстановление Cloud SQL

Не восстанавливать копию поверх рабочей базы без отдельного подтверждения и актуального снимка. Для проверки сначала создать временный экземпляр-клон через Google Cloud Console или команду `gcloud sql backups restore` с параметром `--restore-instance`.

После проверки временный экземпляр необходимо удалить, чтобы не платить за вторую базу.

### Проверенная миграция на AWS (2 ноября 2026 года)

Свежий дамп из Cloud SQL `eclinic-postgres` был импортирован в PostgreSQL 16 на AWS Lightsail `13.63.64.38`. Все 10 108 анкет, 5 000 событий аудита и аккаунты сохранены полностью без расхождений. Время отклика базы на сервере составляет 1–2 мс.

## Контроль после восстановления

1. Проверить `systemctl status e-clinic`.
2. Проверить `https://doctor.e-clinic-control.ru/api/health`.
3. Проверить вход администратора, врача и инвестора.
4. Проверить чтение пациентов и создание тестовой анкеты.
