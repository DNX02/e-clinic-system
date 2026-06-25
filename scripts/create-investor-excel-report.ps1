param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dbPath = Join-Path $root "data\db.json"
$reportsDir = Join-Path $root "reports"
if (-not (Test-Path $reportsDir)) { New-Item -ItemType Directory -Path $reportsDir | Out-Null }
if (-not $OutputPath) {
  $stamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
  $OutputPath = Join-Path $reportsDir "investor_dashboard_$stamp.xlsx"
}

$db = Get-Content $dbPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Date-Key($value) {
  if (-not $value) { return "Не указано" }
  return ([datetime]$value).ToString("yyyy-MM-dd")
}

function Value-Or($value, $fallback) {
  if ($null -eq $value -or $value -eq "") { return $fallback }
  return $value
}

function Map-Value($map, $key) {
  if ($null -eq $map) { return 0 }
  if ($map.PSObject.Methods.Name -contains "Contains" -and $map.Contains($key)) { return $map[$key] }
  if ($map.PSObject.Methods.Name -contains "ContainsKey" -and $map.ContainsKey($key)) { return $map[$key] }
  return 0
}

function Survey-Clinic($survey) {
  if ($survey.patient -and $survey.patient.clinic) { return $survey.patient.clinic }
  if ($survey.clinic) { return $survey.clinic }
  return "Не указано"
}

function Clinic-Key($value) {
  $text = [string]$value
  if ($text -match "\d+") { return "{0:D4}" -f [int]$matches[0] }
  return $text.ToLowerInvariant()
}

function Count-By($items, [scriptblock]$keyFn) {
  $map = [ordered]@{}
  foreach ($item in $items) {
    $key = & $keyFn $item
    if (-not $key) { $key = "Не указано" }
    if (-not $map.Contains($key)) { $map[$key] = 0 }
    $map[$key]++
  }
  return $map
}

function Average-Percent($items) {
  if (-not $items -or $items.Count -eq 0) { return 0 }
  $sum = 0
  foreach ($item in $items) { $sum += [double](Value-Or $item.percent 0) }
  return [math]::Round($sum / $items.Count)
}

function Get-AttemptsByParticipant($attempts) {
  $map = @{}
  foreach ($attempt in $attempts) {
    if (-not $map.ContainsKey($attempt.participantId)) { $map[$attempt.participantId] = @() }
    $map[$attempt.participantId] += $attempt
  }
  return $map
}

function Get-DoctorPostPercent($attempts) {
  $correct = 0
  $total = 0
  foreach ($attempt in ($attempts | Where-Object { $_.type -eq "task" })) {
    $correct += [double](Value-Or $attempt.correct 0)
    $total += [double](Value-Or (Value-Or $attempt.total $attempt.maxScore) 0)
  }
  if ($total -le 0) { return 0 }
  return [math]::Round(($correct / $total) * 100)
}

function Get-EducationRows($participants, $attempts, [string]$postMode) {
  $attemptsByParticipant = Get-AttemptsByParticipant $attempts
  $rows = @()
  foreach ($participant in $participants) {
    $participantAttempts = @()
    if ($attemptsByParticipant.ContainsKey($participant.id)) { $participantAttempts = $attemptsByParticipant[$participant.id] }
    $pre = $participantAttempts | Where-Object { $_.type -eq "pre" } | Select-Object -First 1
    $postPercent = if ($postMode -eq "task") {
      Get-DoctorPostPercent $participantAttempts
    } else {
      [double](Value-Or (($participantAttempts | Where-Object { $_.type -eq "post" } | Select-Object -First 1).percent) 0)
    }
    $rows += [pscustomobject]@{
      Clinic = if ($participant.clinic) { $participant.clinic } else { "Не указано" }
      Name = $participant.fullName
      Role = if ($participant.specialty) { $participant.specialty } elseif ($participant.position) { $participant.position } else { "" }
      RegisteredAt = $participant.createdAt
      PrePercent = if ($pre) { [double](Value-Or $pre.percent 0) } else { 0 }
      PostPercent = $postPercent
      HasPre = [bool]$pre
      HasPost = $postPercent -gt 0
    }
  }
  return $rows
}

function Group-EducationByClinic($rows) {
  $groups = $rows | Group-Object Clinic | Sort-Object { Clinic-Key $_.Name }
  foreach ($group in $groups) {
    $items = @($group.Group)
    $preItems = @($items | Where-Object { $_.HasPre })
    $postItems = @($items | Where-Object { $_.HasPost })
    [pscustomobject]@{
      Clinic = $group.Name
      Registered = $items.Count
      PreCompleted = $preItems.Count
      PostCompleted = $postItems.Count
      PreAverage = if ($preItems.Count) { [math]::Round(($preItems | Measure-Object PrePercent -Average).Average) } else { 0 }
      PostAverage = if ($postItems.Count) { [math]::Round(($postItems | Measure-Object PostPercent -Average).Average) } else { 0 }
      Passed70 = @($postItems | Where-Object { $_.PostPercent -ge 70 }).Count
    }
  }
}

function Write-Table($sheet, [int]$row, [int]$col, [string[]]$headers, $rows) {
  for ($i = 0; $i -lt $headers.Count; $i++) {
    $cell = $sheet.Cells.Item($row, $col + $i)
    $cell.Value2 = $headers[$i]
    $cell.Font.Bold = $true
    $cell.Interior.Color = 0xDCEFEA
  }
  $r = $row + 1
  foreach ($item in $rows) {
    for ($i = 0; $i -lt $headers.Count; $i++) {
      $value = $item[$headers[$i]]
      $cell = $sheet.Cells.Item([int]$r, [int]($col + $i))
      if ($value -is [byte] -or $value -is [int16] -or $value -is [int32] -or $value -is [int64] -or $value -is [single] -or $value -is [double] -or $value -is [decimal]) {
        $cell.Value2 = [double]$value
      } else {
        $cell.Value2 = [string](Value-Or $value "")
      }
    }
    $r++
  }
  $range = $sheet.Range($sheet.Cells.Item($row, $col), $sheet.Cells.Item([math]::Max($row, $r - 1), $col + $headers.Count - 1))
  $range.Borders.LineStyle = 1
  $range.Columns.AutoFit() | Out-Null
  return $r + 1
}

function Add-Chart($sheet, [string]$title, $range, [int]$type, [int]$left, [int]$top, [int]$width = 520, [int]$height = 300) {
  $chartObject = $sheet.ChartObjects().Add($left, $top, $width, $height)
  $chart = $chartObject.Chart
  $chart.ChartType = $type
  $chart.SetSourceData($range)
  $chart.HasTitle = $true
  $chart.ChartTitle.Text = $title
  $chart.ChartArea.Format.Line.Visible = 0
  return $chart
}

$doctorRows = @(Get-EducationRows $db.trainingParticipants $db.trainingAttempts "task")
$nurseRows = @(Get-EducationRows $db.nurseTrainingParticipants $db.nurseTrainingAttempts "post")
$doctorClinicRows = @(Group-EducationByClinic $doctorRows)
$nurseClinicRows = @(Group-EducationByClinic $nurseRows)

$surveys = @($db.nurseSurveys)
$visits = @($db.doctorVisits)
$doctors = @($db.doctors)
$surveyById = @{}
foreach ($survey in $surveys) { $surveyById[$survey.id] = $survey }

$needsDoctor = @($surveys | Where-Object { $_.needsDoctor }).Count
$highFindrisc = @($surveys | Where-Object { $_.findrisc.highRisk }).Count
$highScore2 = @($surveys | Where-Object { $_.score2.highRisk }).Count
$surveyTotal = [math]::Max(1, $surveys.Count)
$riskRows = @(
  @{ "Показатель" = "Нужно к врачу"; "Количество" = $needsDoctor; "Процент" = [math]::Round(($needsDoctor / $surveyTotal) * 100) },
  @{ "Показатель" = "FINDRISC повышен"; "Количество" = $highFindrisc; "Процент" = [math]::Round(($highFindrisc / $surveyTotal) * 100) },
  @{ "Показатель" = "Сердечно-сосудистый риск высок"; "Количество" = $highScore2; "Процент" = [math]::Round(($highScore2 / $surveyTotal) * 100) }
)

$dateSet = [ordered]@{}
foreach ($item in $surveys) { $dateSet[(Date-Key $item.createdAt)] = $true }
foreach ($item in $visits) { $dateSet[(Date-Key $item.createdAt)] = $true }
foreach ($item in $doctorRows) { $dateSet[(Date-Key $item.RegisteredAt)] = $true }
foreach ($item in $nurseRows) { $dateSet[(Date-Key $item.RegisteredAt)] = $true }
$dates = @($dateSet.Keys | Sort-Object)

$surveyByDate = Count-By $surveys { param($x) Date-Key $x.createdAt }
$visitByDate = Count-By $visits { param($x) Date-Key $x.createdAt }
$doctorRegByDate = Count-By $doctorRows { param($x) Date-Key $x.RegisteredAt }
$nurseRegByDate = Count-By $nurseRows { param($x) Date-Key $x.RegisteredAt }
$dynamicRows = foreach ($date in $dates) {
  @{
    "Дата" = $date
    "Анкеты пациентов" = [int](Map-Value $surveyByDate $date)
    "Осмотры врачей" = [int](Map-Value $visitByDate $date)
    "Регистрация врачей" = [int](Map-Value $doctorRegByDate $date)
    "Регистрация медсестер" = [int](Map-Value $nurseRegByDate $date)
  }
}

$clinicNames = [ordered]@{}
foreach ($doctor in $doctors) { $clinicNames[$doctor.clinic] = $true }
foreach ($survey in $surveys) { $clinicNames[(Survey-Clinic $survey)] = $true }
foreach ($row in $doctorRows) { $clinicNames[$row.Clinic] = $true }
foreach ($row in $nurseRows) { $clinicNames[$row.Clinic] = $true }
$clinicList = @($clinicNames.Keys | Where-Object { $_ } | Sort-Object { Clinic-Key $_ })
$doctorsByClinic = Count-By $doctors { param($x) $x.clinic }
$surveysByClinic = Count-By $surveys { param($x) Survey-Clinic $x }
$visitsByClinic = @{}
foreach ($visit in $visits) {
  $clinic = if ($surveyById.ContainsKey($visit.surveyId)) { $surveyById[$visit.surveyId].patient.clinic } else { "Не указано" }
  if (-not $visitsByClinic.ContainsKey($clinic)) { $visitsByClinic[$clinic] = 0 }
  $visitsByClinic[$clinic]++
}
$clinicRows = foreach ($clinic in $clinicList) {
  @{
    "Поликлиника" = $clinic
    "Врачи в системе" = [int](Map-Value $doctorsByClinic $clinic)
    "Анкеты пациентов" = [int](Map-Value $surveysByClinic $clinic)
    "Осмотры врачей" = [int](Map-Value $visitsByClinic $clinic)
    "Врачи на обучении" = @($doctorRows | Where-Object { $_.Clinic -eq $clinic }).Count
    "Медсестры на обучении" = @($nurseRows | Where-Object { $_.Clinic -eq $clinic }).Count
  }
}

$diagnosisRows = (Count-By $visits { param($x) if ($x.diagnosis) { $x.diagnosis } else { "Без диагноза" } }).GetEnumerator() | ForEach-Object {
  @{ "Диагноз" = $_.Key; "Количество" = $_.Value }
}
$drugValues = @()
foreach ($visit in $visits) {
  $drugValues += @($visit.diabetesDrugs)
  $drugValues += @($visit.hypertensionDrugs)
}
$drugRows = (Count-By $drugValues { param($x) $x }).GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
  @{ "Препарат" = $_.Key; "Количество назначений" = $_.Value }
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Add()
while ($wb.Worksheets.Count -lt 6) { $wb.Worksheets.Add() | Out-Null }

try {
  $overview = $wb.Worksheets.Item(1); $overview.Name = "Обзор"
  $dynamic = $wb.Worksheets.Item(2); $dynamic.Name = "Динамика"
  $doctorSheet = $wb.Worksheets.Item(3); $doctorSheet.Name = "Обучение врачей"
  $nurseSheet = $wb.Worksheets.Item(4); $nurseSheet.Name = "Обучение медсестер"
  $clinicSheet = $wb.Worksheets.Item(5); $clinicSheet.Name = "Поликлиники"
  $riskSheet = $wb.Worksheets.Item(6); $riskSheet.Name = "Риски и назначения"

  foreach ($sheet in @($overview, $dynamic, $doctorSheet, $nurseSheet, $clinicSheet, $riskSheet)) {
    $sheet.Cells.Font.Name = "Arial"
    $sheet.Cells.Font.Size = 10
  }

  $overview.Cells.Item(1,1).Value2 = "Инвесторская аналитика E-Clinic Control"
  $overview.Cells.Item(1,1).Font.Size = 18
  $overview.Cells.Item(1,1).Font.Bold = $true
  $overview.Cells.Item(2,1).Value2 = "Сформировано: $(Get-Date -Format 'dd.MM.yyyy HH:mm')"
  $overview.Cells.Item(2,1).Font.Color = 0x666666
  $doctorPre = @($doctorRows | Where-Object { $_.HasPre })
  $doctorPost = @($doctorRows | Where-Object { $_.HasPost })
  $nursePre = @($nurseRows | Where-Object { $_.HasPre })
  $nursePost = @($nurseRows | Where-Object { $_.HasPost })
  $kpis = @(
    @{ "Показатель" = "Врачи в системе"; "Значение" = $doctors.Count; "Комментарий" = "Зарегистрированные врачи" },
    @{ "Показатель" = "Анкеты пациентов"; "Значение" = $surveys.Count; "Комментарий" = "Скрининг пациентов" },
    @{ "Показатель" = "Осмотры врачей"; "Значение" = $visits.Count; "Комментарий" = "Клинические действия" },
    @{ "Показатель" = "Врачи на обучении"; "Значение" = $doctorRows.Count; "Комментарий" = "Участники №4" },
    @{ "Показатель" = "Медсестры на обучении"; "Значение" = $nurseRows.Count; "Комментарий" = "Участники №5" },
    @{ "Показатель" = "Средний пре-тест врачей"; "Значение" = "$(Average-Percent $doctorPre)%"; "Комментарий" = "$($doctorPre.Count) сдали" },
    @{ "Показатель" = "Средний пост-тест врачей"; "Значение" = "$(Average-Percent $doctorPost)%"; "Комментарий" = "$($doctorPost.Count) сдали" },
    @{ "Показатель" = "Средний пре-тест медсестер"; "Значение" = "$(Average-Percent $nursePre)%"; "Комментарий" = "$($nursePre.Count) сдали" },
    @{ "Показатель" = "Средний пост-тест медсестер"; "Значение" = "$(Average-Percent $nursePost)%"; "Комментарий" = "$($nursePost.Count) сдали" }
  )
  Write-Table $overview 4 1 @("Показатель","Значение","Комментарий") $kpis | Out-Null

  Write-Table $dynamic 1 1 @("Дата","Анкеты пациентов","Осмотры врачей","Регистрация врачей","Регистрация медсестер") $dynamicRows | Out-Null
  if ($dynamicRows.Count -gt 0) {
    $range = $dynamic.Range($dynamic.Cells.Item(1,1), $dynamic.Cells.Item($dynamicRows.Count + 1,5))
    Add-Chart $dynamic "Динамика проекта по дням" $range 65 380 20 700 320 | Out-Null
  }

  $doctorSummary = @(
    @{ "Показатель" = "Зарегистрировано"; "Значение" = $doctorRows.Count },
    @{ "Показатель" = "Пре-тест сдали"; "Значение" = $doctorPre.Count },
    @{ "Показатель" = "Пост-тест сдали"; "Значение" = $doctorPost.Count },
    @{ "Показатель" = "Средний пре-тест"; "Значение" = "$(Average-Percent $doctorPre)%" },
    @{ "Показатель" = "Средний пост-тест"; "Значение" = "$(Average-Percent $doctorPost)%" },
    @{ "Показатель" = "Пост-тест 70%+"; "Значение" = @($doctorPost | Where-Object { $_.PostPercent -ge 70 }).Count }
  )
  $row = Write-Table $doctorSheet 1 1 @("Показатель","Значение") $doctorSummary
  Write-Table $doctorSheet $row 1 @("Clinic","Registered","PreCompleted","PostCompleted","PreAverage","PostAverage","Passed70") ($doctorClinicRows | ForEach-Object {
    @{ "Clinic"=$_.Clinic; "Registered"=$_.Registered; "PreCompleted"=$_.PreCompleted; "PostCompleted"=$_.PostCompleted; "PreAverage"=$_.PreAverage; "PostAverage"=$_.PostAverage; "Passed70"=$_.Passed70 }
  }) | Out-Null
  if ($doctorClinicRows.Count -gt 0) {
    $range = $doctorSheet.Range($doctorSheet.Cells.Item($row,1), $doctorSheet.Cells.Item($row + $doctorClinicRows.Count,4))
    Add-Chart $doctorSheet "Врачи: регистрация, пре- и пост-тесты" $range 51 620 20 620 320 | Out-Null
  }

  $nurseSummary = @(
    @{ "Показатель" = "Зарегистрировано"; "Значение" = $nurseRows.Count },
    @{ "Показатель" = "Пре-тест сдали"; "Значение" = $nursePre.Count },
    @{ "Показатель" = "Пост-тест сдали"; "Значение" = $nursePost.Count },
    @{ "Показатель" = "Средний пре-тест"; "Значение" = "$(Average-Percent $nursePre)%" },
    @{ "Показатель" = "Средний пост-тест"; "Значение" = "$(Average-Percent $nursePost)%" },
    @{ "Показатель" = "Пост-тест 70%+"; "Значение" = @($nursePost | Where-Object { $_.PostPercent -ge 70 }).Count }
  )
  $row = Write-Table $nurseSheet 1 1 @("Показатель","Значение") $nurseSummary
  Write-Table $nurseSheet $row 1 @("Clinic","Registered","PreCompleted","PostCompleted","PreAverage","PostAverage","Passed70") ($nurseClinicRows | ForEach-Object {
    @{ "Clinic"=$_.Clinic; "Registered"=$_.Registered; "PreCompleted"=$_.PreCompleted; "PostCompleted"=$_.PostCompleted; "PreAverage"=$_.PreAverage; "PostAverage"=$_.PostAverage; "Passed70"=$_.Passed70 }
  }) | Out-Null
  if ($nurseClinicRows.Count -gt 0) {
    $range = $nurseSheet.Range($nurseSheet.Cells.Item($row,1), $nurseSheet.Cells.Item($row + $nurseClinicRows.Count,4))
    Add-Chart $nurseSheet "Медсестры: регистрация, пре- и пост-тесты" $range 51 620 20 620 320 | Out-Null
  }

  Write-Table $clinicSheet 1 1 @("Поликлиника","Врачи в системе","Анкеты пациентов","Осмотры врачей","Врачи на обучении","Медсестры на обучении") $clinicRows | Out-Null
  if ($clinicRows.Count -gt 0) {
    $range = $clinicSheet.Range($clinicSheet.Cells.Item(1,1), $clinicSheet.Cells.Item($clinicRows.Count + 1,6))
    Add-Chart $clinicSheet "Активность по поликлиникам" $range 51 620 20 620 340 | Out-Null
  }

  $row = Write-Table $riskSheet 1 1 @("Показатель","Количество","Процент") $riskRows
  Write-Table $riskSheet $row 1 @("Диагноз","Количество") $diagnosisRows | Out-Null
  $drugStart = $row + [math]::Max(2, @($diagnosisRows).Count + 3)
  Write-Table $riskSheet $drugStart 1 @("Препарат","Количество назначений") $drugRows | Out-Null
  if ($riskRows.Count -gt 0) {
    $range = $riskSheet.Range($riskSheet.Cells.Item(1,1), $riskSheet.Cells.Item($riskRows.Count + 1,3))
    Add-Chart $riskSheet "Риски пациентов, %" $range 51 520 20 560 300 | Out-Null
  }

  foreach ($sheet in @($overview, $dynamic, $doctorSheet, $nurseSheet, $clinicSheet, $riskSheet)) {
    $sheet.Columns.AutoFit() | Out-Null
    $sheet.Rows.Item(1).Font.Bold = $true
  }

  if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
  $wb.SaveAs($OutputPath, 51)
  Write-Output $OutputPath
} finally {
  $wb.Close($false) | Out-Null
  $excel.Quit() | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
