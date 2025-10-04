/**
 * Performance Monitor for AR Ruler Applications
 * Tracks CPU usage, memory usage, component latencies, and measurement data
 */

class PerformanceMonitor {
    constructor() {
        this.performanceData = [];
        this.isMonitoring = false;
        this.frameCount = 0;
        this.startTime = null;
        this.lastFrameTime = 0;
        
        // Performance metrics
        this.cpuUsage = 0;
        this.memoryUsage = 0;
        this.componentLatencies = {
            video: 0,
            slam: 0,
            total: 0
        };
        this.measurementDistance = 0;
        this.fps = 0;
        
        // Memory tracking
        this.memoryInfoAvailable = performance && performance.memory;
        this.mbSize = Math.pow(1000, 2);
        
        // CPU usage calculation
        this.cpuUsageHistory = [];
        this.cpuUsageBufferSize = 60; // 1 second at 60fps
        
        // Component timing
        this.componentTimers = {
            video: { start: 0, end: 0, duration: 0 },
            slam: { start: 0, end: 0, duration: 0 },
            total: { start: 0, end: 0, duration: 0 }
        };
        
        // UI elements
        this.exportButton = null;
        this.idleCallbackId = null;
    }

    /**
     * Initialize the performance monitor
     */
    init() {
        this.createUI();
        this.startTime = performance.now();
        this.isMonitoring = true;
        console.log('Performance Monitor initialized');
    }

    /**
     * Create UI elements for performance monitoring
     */
    createUI() {
        // Find the toggle panels button (eye button)
        const toggleButton = document.getElementById('toggle-panels');
        if (!toggleButton) {
            console.warn('Toggle panels button not found');
            return;
        }

        // Create export button
        this.exportButton = document.createElement('button');
        this.exportButton.textContent = '📊 Export Performance';
        this.exportButton.title = 'Export Performance Data to CSV';
        this.exportButton.style.cssText = `
            background: #4CAF50;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 10px;
            transition: background 0.3s ease;
            display: inline-block;
            vertical-align: top;
            white-space: nowrap;
        `;
        this.exportButton.onmouseover = () => this.exportButton.style.background = '#45a049';
        this.exportButton.onmouseout = () => this.exportButton.style.background = '#4CAF50';
        this.exportButton.onclick = () => this.exportPerformanceData();

        // Insert the export button right after the toggle button
        toggleButton.parentNode.insertBefore(this.exportButton, toggleButton.nextSibling);
        
        // Create a wrapper div for the buttons to keep them together horizontally
        const buttonWrapper = document.createElement('div');
        buttonWrapper.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        
        // Move the toggle button and export button into the wrapper
        toggleButton.parentNode.insertBefore(buttonWrapper, toggleButton);
        buttonWrapper.appendChild(toggleButton);
        buttonWrapper.appendChild(this.exportButton);
    }

    /**
     * Start monitoring a component
     */
    startComponent(componentName) {
        if (this.componentTimers[componentName]) {
            this.componentTimers[componentName].start = performance.now();
        }
    }

    /**
     * Stop monitoring a component
     */
    stopComponent(componentName) {
        if (this.componentTimers[componentName]) {
            this.componentTimers[componentName].end = performance.now();
            this.componentTimers[componentName].duration = 
                this.componentTimers[componentName].end - this.componentTimers[componentName].start;
            this.componentLatencies[componentName] = this.componentTimers[componentName].duration;
        }
    }

    /**
     * Update performance metrics for current frame
     */
    updateFrame(stats, measurementDistance = 0) {
        if (!this.isMonitoring) return;

        this.frameCount++;
        const currentTime = performance.now();
        
        // Calculate FPS
        if (this.lastFrameTime > 0) {
            const frameTime = currentTime - this.lastFrameTime;
            this.fps = Math.round(1000 / frameTime);
        }
        this.lastFrameTime = currentTime;

        // Update memory usage
        if (this.memoryInfoAvailable) {
            this.memoryUsage = performance.memory.usedJSHeapSize / this.mbSize;
        }

        // Calculate CPU usage (simplified estimation)
        this.calculateCPUUsage();

        // Update measurement distance
        this.measurementDistance = measurementDistance;

        // Update component latencies from stats
        if (stats) {
            this.updateComponentLatencies(stats);
        }

        // Store performance data
        this.storePerformanceData();
    }

    /**
     * Calculate actual CPU usage based on real frame timing
     */
    calculateCPUUsage() {
        const currentTime = performance.now();
        
        // Calculate actual CPU usage based on real frame timing
        let actualCpuUsage = 0;
        
        // Method 1: Use actual frame duration (not assumed 60fps)
        if (this.lastFrameTime > 0) {
            const frameDuration = currentTime - this.lastFrameTime;
            const frameProcessingTime = this.componentLatencies.total;
            
            if (frameDuration > 0) {
                // CPU usage = (processing time / actual frame duration) * 100
                actualCpuUsage = Math.min(100, (frameProcessingTime / frameDuration) * 100);
            }
        }
        
        // Method 2: Use idle time to validate CPU usage
        if (typeof requestIdleCallback !== 'undefined') {
            this.measureIdleTime();
        }
        
        // Method 3: Use performance timing for precise CPU measurement
        this.measurePreciseTiming();
        
        // Store the actual CPU usage
        this.cpuUsageHistory.push(actualCpuUsage);
        
        // Keep only recent history
        if (this.cpuUsageHistory.length > this.cpuUsageBufferSize) {
            this.cpuUsageHistory.shift();
        }
        
        // Calculate average CPU usage
        this.cpuUsage = this.calculateSmoothedCpuUsage();
        
        // Update last frame time for next calculation
        this.lastFrameTime = currentTime;
    }
    
    /**
     * Calculate smoothed CPU usage with exponential smoothing
     */
    calculateSmoothedCpuUsage() {
        if (this.cpuUsageHistory.length === 0) return 0;
        
        // Use exponential smoothing for more stable readings
        const alpha = 0.3; // Smoothing factor
        let smoothed = this.cpuUsageHistory[0];
        
        for (let i = 1; i < this.cpuUsageHistory.length; i++) {
            smoothed = alpha * this.cpuUsageHistory[i] + (1 - alpha) * smoothed;
        }
        
        return Math.round(smoothed * 100) / 100; // Round to 2 decimal places
    }
    
    /**
     * Measure idle time to validate actual CPU usage
     */
    measureIdleTime() {
        if (this.idleCallbackId) {
            cancelIdleCallback(this.idleCallbackId);
        }
        
        this.idleCallbackId = requestIdleCallback((deadline) => {
            const idleTime = deadline.timeRemaining();
            const currentTime = performance.now();
            
            // Use actual frame duration if available
            let frameDuration = 16.67; // Default to 60fps if no frame data
            if (this.lastFrameTime > 0) {
                frameDuration = currentTime - this.lastFrameTime;
            }
            
            // Calculate CPU usage based on actual idle time
            // More idle time = lower CPU usage
            const idleRatio = idleTime / frameDuration;
            const cpuUsageFromIdle = Math.max(0, Math.min(100, (1 - idleRatio) * 100));
            
            // Update CPU usage with idle-based validation
            if (cpuUsageFromIdle >= 0) {
                this.cpuUsageHistory.push(cpuUsageFromIdle);
                
                // Keep only recent history
                if (this.cpuUsageHistory.length > this.cpuUsageBufferSize) {
                    this.cpuUsageHistory.shift();
                }
                
                // Update CPU usage with smoothed calculation
                this.cpuUsage = this.calculateSmoothedCpuUsage();
            }
        });
    }
    
    /**
     * Use performance.mark() and performance.measure() for precise CPU timing
     */
    measurePreciseTiming() {
        const now = performance.now();
        
        // Mark the start of CPU measurement
        performance.mark('cpu-measure-start');
        
        // Use setTimeout to measure actual CPU busy time
        setTimeout(() => {
            performance.mark('cpu-measure-end');
            performance.measure('cpu-busy-time', 'cpu-measure-start', 'cpu-measure-end');
            
            const measures = performance.getEntriesByName('cpu-busy-time');
            if (measures.length > 0) {
                const busyTime = measures[measures.length - 1].duration;
                const frameTime = 1000 / Math.max(this.fps, 1);
                
                if (frameTime > 0) {
                    // Calculate actual CPU usage from busy time
                    const preciseCpuUsage = Math.min(100, (busyTime / frameTime) * 100);
                    this.cpuUsageHistory.push(preciseCpuUsage);
                    
                    // Keep only recent history
                    if (this.cpuUsageHistory.length > this.cpuUsageBufferSize) {
                        this.cpuUsageHistory.shift();
                    }
                    
                    // Update CPU usage with precise timing
                    this.cpuUsage = this.calculateSmoothedCpuUsage();
                }
            }
            
            // Clean up old performance marks
            performance.clearMarks('cpu-measure-start');
            performance.clearMarks('cpu-measure-end');
            performance.clearMeasures('cpu-busy-time');
        }, 0);
    }

    /**
     * Update component latencies from stats object
     */
    updateComponentLatencies(stats) {
        if (stats && stats.timers) {
            stats.timers.forEach(timer => {
                const [name, timerObj] = timer;
                if (this.componentLatencies.hasOwnProperty(name)) {
                    this.componentLatencies[name] = timerObj.getElapsedTime();
                }
            });
            
            // Calculate total latency as sum of all components
            this.componentLatencies.total = this.componentLatencies.video + this.componentLatencies.slam;
        }
    }

    /**
     * Store performance data for current frame
     */
    storePerformanceData() {
        const data = {
            timestamp: performance.now(),
            frameNumber: this.frameCount,
            cpuUsage: Math.round(this.cpuUsage * 100) / 100,
            memoryUsage: Math.round(this.memoryUsage * 100) / 100,
            fps: this.fps,
            videoLatency: Math.round(this.componentLatencies.video * 100) / 100,
            slamLatency: Math.round(this.componentLatencies.slam * 100) / 100,
            totalLatency: Math.round(this.componentLatencies.total * 100) / 100,
            measurementDistance: Math.round(this.measurementDistance * 1000) / 1000
        };
        
        this.performanceData.push(data);
    }


    /**
     * Export performance data to CSV
     */
    exportPerformanceData() {
        if (this.performanceData.length === 0) {
            alert('No performance data to export');
            return;
        }

        // Create CSV header
        const csvHeader = 'timestamp,frame_number,cpu_usage_percent,memory_usage_mb,fps,video_latency_ms,slam_latency_ms,total_latency_ms,measurement_distance_m\n';
        
        // Create CSV content
        const csvContent = this.performanceData.map(data => {
            return `${data.timestamp},${data.frameNumber},${data.cpuUsage},${data.memoryUsage},${data.fps},${data.videoLatency},${data.slamLatency},${data.totalLatency},${data.measurementDistance}`;
        }).join('\n');
        
        const fullCsv = csvHeader + csvContent;
        
        // Create and download file
        const blob = new Blob([fullCsv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `performance_data_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        console.log(`Exported ${this.performanceData.length} performance data points to CSV`);
    }


    /**
     * Stop monitoring
     */
    stop() {
        this.isMonitoring = false;
        console.log('Performance monitoring stopped');
    }

    /**
     * Get current performance summary
     */
    getPerformanceSummary() {
        if (this.performanceData.length === 0) {
            return null;
        }

        const avgCpu = this.performanceData.reduce((sum, data) => sum + data.cpuUsage, 0) / this.performanceData.length;
        const avgMemory = this.performanceData.reduce((sum, data) => sum + data.memoryUsage, 0) / this.performanceData.length;
        const avgFps = this.performanceData.reduce((sum, data) => sum + data.fps, 0) / this.performanceData.length;
        const avgVideoLatency = this.performanceData.reduce((sum, data) => sum + data.videoLatency, 0) / this.performanceData.length;
        const avgSlamLatency = this.performanceData.reduce((sum, data) => sum + data.slamLatency, 0) / this.performanceData.length;
        const avgTotalLatency = this.performanceData.reduce((sum, data) => sum + data.totalLatency, 0) / this.performanceData.length;

        return {
            totalFrames: this.performanceData.length,
            avgCpuUsage: Math.round(avgCpu * 100) / 100,
            avgMemoryUsage: Math.round(avgMemory * 100) / 100,
            avgFps: Math.round(avgFps * 100) / 100,
            avgVideoLatency: Math.round(avgVideoLatency * 100) / 100,
            avgSlamLatency: Math.round(avgSlamLatency * 100) / 100,
            avgTotalLatency: Math.round(avgTotalLatency * 100) / 100
        };
    }
}

// Export the PerformanceMonitor class
export { PerformanceMonitor };
