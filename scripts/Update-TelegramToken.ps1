$ErrorActionPreference = "Stop"

$gcloud = "C:\Users\admin\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$project = "project-d1c58e2c-ee1b-4604-99b"
$zone = "us-central1-a"
$instance = "e-clinic-server-recovery"
$remoteScript = Join-Path $PSScriptRoot "update-telegram-token-remote.sh"
$tokenPointer = [IntPtr]::Zero
$plainToken = $null

try {
  $Host.UI.RawUI.WindowTitle = "Безопасное обновление Telegram Netdata"
  Write-Host "Вставьте новый токен Telegram. Введённый текст не будет отображаться." -ForegroundColor Cyan
  $secureToken = Read-Host "Новый токен" -AsSecureString
  $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)

  if ($plainToken -notmatch '^\d{8,12}:[A-Za-z0-9_-]{30,}$') {
    throw "Неверный формат токена Telegram."
  }

  & $gcloud compute scp $remoteScript "${instance}:/tmp/eclinic-update-telegram-token.sh" `
    --project=$project --zone=$zone --tunnel-through-iap --quiet
  if ($LASTEXITCODE -ne 0) { throw "Не удалось передать служебный скрипт." }

  $plainToken | & $gcloud compute ssh $instance --project=$project --zone=$zone --tunnel-through-iap `
    --command="sudo bash /tmp/eclinic-update-telegram-token.sh" --quiet
  if ($LASTEXITCODE -ne 0) { throw "Сервер отклонил обновление или тест уведомлений не прошёл." }

  Write-Host "`nГотово: токен заменён, отправлены три тестовых уведомления." -ForegroundColor Green
}
catch {
  Write-Host "`nОшибка: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  $plainToken = $null
  if ($tokenPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  }
  Write-Host "`nНажмите Enter, чтобы закрыть окно."
  [void](Read-Host)
}
