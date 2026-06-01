# E-Clinic Admin Android

Android-приложение для панели администратора:

https://admin.e-clinic-control.ru/

## Сборка для Google Play

1. Установить Android Studio.
2. Открыть папку `android-admin-app`.
3. Дождаться синхронизации Gradle.
4. В Android Studio выбрать `Build > Generate Signed App Bundle / APK`.
5. Выбрать `Android App Bundle`.
6. Создать или выбрать release key.
7. Собрать `release`-версию `.aab`.
8. Загрузить `.aab` в Google Play Console.

## Важно для публикации

- Нужен аккаунт Google Play Developer.
- Нужна ссылка на политику конфиденциальности: `https://admin.e-clinic-control.ru/privacy-admin.html`.
- В Data Safety нужно указать, что приложение работает с медицинскими/персональными данными и требует авторизации.
- Админка должна работать на постоянном сервере 24/7.
