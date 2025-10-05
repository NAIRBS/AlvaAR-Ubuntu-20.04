# Ask user for the Chrome process ID
$chromePid = Read-Host "Enter Chrome PID"

# Define output log path (user Documents)
$log = Join-Path $env:USERPROFILE "Documents\chrome_cpu_log_$chromePid.csv"

# Create log header
"Time,CPU%" | Out-File $log -Force

# Check if process exists
$proc = Get-Process -Id $chromePid -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "Process with PID $chromePid not found. Exiting."
    exit
}

# Initialize CPU time and timestamp
$lastCpu = $proc.CPU
$lastTime = Get-Date

# Get total logical processors for normalization
$cores = (Get-WmiObject Win32_ComputerSystem).NumberOfLogicalProcessors

Write-Host "Logging CPU usage for PID $chromePid..."
Write-Host "Output file: $log"
Write-Host "Press Ctrl + C to stop."

# Continuous sampling loop
while ($true) {
    Start-Sleep -Seconds 1

    $proc = Get-Process -Id $chromePid -ErrorAction SilentlyContinue
    if (-not $proc) {
        "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')),Process ended" | Out-File $log -Append
        break
    }

    # Calculate delta CPU usage and elapsed time
    $newCpu = $proc.CPU
    $newTime = Get-Date
    $deltaCpu = $newCpu - $lastCpu
    $deltaTime = ($newTime - $lastTime).TotalSeconds

    # Compute CPU usage as a percentage of total CPU capacity
    $cpuPercent = [math]::Round(($deltaCpu / $deltaTime / $cores) * 100, 2)

    # Append to CSV log
    "$($newTime.ToString('yyyy-MM-dd HH:mm:ss')),$cpuPercent" | Out-File $log -Append

    # Update reference values
    $lastCpu = $newCpu
    $lastTime = $newTime
}
