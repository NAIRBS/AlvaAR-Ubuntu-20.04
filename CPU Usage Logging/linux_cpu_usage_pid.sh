#!/bin/bash

# Check if PID was provided
if [ -z "$1" ]; then
    echo "Usage: $0 <Chrome PID>"
    exit 1
fi

PID=$1
LOG="$HOME/chrome_cpu_log_$PID.csv"

# Verify that the PID exists
if [ ! -d "/proc/$PID" ]; then
    echo "Process with PID $PID does not exist."
    exit 1
fi

# Initialize CSV file
echo "Time,CPU%" > "$LOG"
echo "Logging CPU usage for PID $PID..."
echo "Output file: $LOG"
echo "Press Ctrl+C to stop."

# Get number of CPU cores
CORES=$(nproc)

# Function to cleanly handle Ctrl+C
cleanup() {
    echo "Logging stopped."
    exit 0
}
trap cleanup SIGINT

# Initialize previous CPU times
PREV_TOTAL=$(awk '{print $14+$15}' /proc/$PID/stat)
PREV_TIME=$(date +%s)

# Main loop
while true; do
    sleep 1
    if [ ! -d "/proc/$PID" ]; then
        echo "$(date +'%Y-%m-%d %H:%M:%S'),Process ended" >> "$LOG"
        break
    fi

    TOTAL=$(awk '{print $14+$15}' /proc/$PID/stat)
    NOW=$(date +%s)
    DELTA=$((TOTAL - PREV_TOTAL))
    ELAPSED=$((NOW - PREV_TIME))

    # CPU usage percentage
    CPU=$(echo "scale=2; 100 * $DELTA / $ELAPSED / $CORES" | bc)

    echo "$(date +'%Y-%m-%d %H:%M:%S'),$CPU" >> "$LOG"

    PREV_TOTAL=$TOTAL
    PREV_TIME=$NOW
done
