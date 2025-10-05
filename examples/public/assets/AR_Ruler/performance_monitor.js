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
        this.videoName = 'unknown';
        
        // Performance metrics
        this.frameTimeUtilization = 0;
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
     * Set the video name for CSV export
     */
    setVideoName(videoName) {
        this.videoName = videoName;
        console.log('Performance monitor video name set to:', videoName);
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
    updateFrame(stats, measurementDistance = 0, moduleInstance = null) {
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

        // Calculate frame time utilization
        this.calculateFrameTimeUtilization();

        // Update measurement distance
        this.measurementDistance = measurementDistance;

        // Update component latencies from stats
        if (stats) {
            this.updateComponentLatencies(stats, moduleInstance);
        }

        // Store performance data
        this.storePerformanceData();
    }

    /**
     * Calculate frame time utilization using the correct method for browser environments
     * 
     * DEFINITION: Frame time utilization = (actual processing time / available frame time) × 100%
     * 
     * WHY THIS IS CORRECT:
     * 1. Browser Security: True CPU measurement is blocked by browser security policies
     * 2. Frame-Based Approach: Measures actual work done vs time available per frame
     * 3. Real-World Relevance: Shows how much of each frame is spent processing vs idle
     * 4. Performance Indicator: Higher values indicate potential frame drops or lag
     * 
     * This method provides the most accurate estimate possible within browser constraints
     * by measuring the ratio of actual processing time to frame duration.
     */
    calculateFrameTimeUtilization() {
        const currentTime = performance.now();
        
        // Calculate frame time utilization as processing time percentage of frame duration
        let frameTimeUtilization = 0;
        
        if (this.lastFrameTime > 0) {
            const frameDuration = currentTime - this.lastFrameTime;        // Total time available for this frame
            const frameProcessingTime = this.componentLatencies.total;     // Actual time spent processing
            
            if (frameDuration > 0) {
                // Frame time utilization = (processing time / frame duration) × 100%
                // This represents the percentage of frame time spent on actual work
                frameTimeUtilization = Math.min(100, (frameProcessingTime / frameDuration) * 100);
            }
        }
        
        // Direct assignment for real-time responsiveness (no smoothing)
        this.frameTimeUtilization = Math.round(frameTimeUtilization * 100) / 100;
        
        // Update frame timing for next calculation
        this.lastFrameTime = currentTime;
    }
    
    

    /**
     * Update component latencies from stats object
     */
    updateComponentLatencies(stats, moduleInstance = null) {
        if (stats && stats.timers) {
            stats.timers.forEach(timer => {
                const [name, timerObj] = timer;
                if (this.componentLatencies.hasOwnProperty(name)) {
                    this.componentLatencies[name] = timerObj.getElapsedTime();
                }
            });
            
            // Use most accurate timing: JavaScript + C++ (includes WASM overhead)
            if (moduleInstance && moduleInstance.getSlamProcessingTime) {
                try {
                    const cppSlamTime = moduleInstance.getSlamProcessingTime();
                    if (cppSlamTime > 0) {
                        // Get JavaScript timing (includes WASM communication overhead)
                        const jsSlamTime = this.componentLatencies.slam || 0;
                        
                        // Store both timings for detailed analysis
                        this.componentLatencies.slamCpp = cppSlamTime;
                        
                        // Use JavaScript timing as it includes WASM overhead (most accurate for real-world performance)
                        // But log both for analysis
                        // console.log(`[Performance] JS timing (includes WASM overhead): ${jsSlamTime.toFixed(2)}ms`);
                        // console.log(`[Performance] C++ timing (pure algorithm): ${cppSlamTime.toFixed(2)}ms`);
                        // console.log(`[Performance] WASM overhead: ${(jsSlamTime - cppSlamTime).toFixed(2)}ms`);
                        
                        // Keep JavaScript timing for most accurate real-world performance
                        // (This includes the WASM communication overhead which is part of the total cost)
                        
                        // Update Stats tracker with JavaScript timing (most accurate - includes WASM overhead)
                        if (stats.timers && stats.timers.has('slam')) {
                            const slamTimer = stats.timers.get('slam');
                            if (slamTimer) {
                                // Update both delta and average array for live display
                                slamTimer.delta = jsSlamTime;
                                
                                // Update the average array to reflect accurate timing
                                slamTimer.avg[slamTimer.idx] = jsSlamTime;
                                slamTimer.idx = (slamTimer.idx + 1) % slamTimer.avg.length;
                                
                                // console.log(`[Performance] Updated Stats tracker with JS timing (includes WASM): ${jsSlamTime.toFixed(2)}ms`);
                            }
                        }
                        
                        // Also update total timing if available
                        if (stats.timers && stats.timers.has('total')) {
                            const totalTimer = stats.timers.get('total');
                            if (totalTimer) {
                                // Update total with accurate video + slam timing
                                const videoTime = this.componentLatencies.video || 0;
                                const totalTime = videoTime + jsSlamTime;
                                
                                // Update both delta and average array for live display
                                totalTimer.delta = totalTime;
                                totalTimer.avg[totalTimer.idx] = totalTime;
                                totalTimer.idx = (totalTimer.idx + 1) % totalTimer.avg.length;
                                
                                // console.log(`[Performance] Updated Stats total timing: ${totalTime.toFixed(2)}ms`);
                            }
                        }
                    }
                } catch (e) {
                    // console.log('[Performance] C++ SLAM timing not available, using JavaScript timing');
                }
            }
            
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
            frameTimeUtilization: Math.round(this.frameTimeUtilization * 100) / 100,
            memoryUsage: Math.round(this.memoryUsage * 100) / 100,
            fps: this.fps,
            videoLatency: Math.round(this.componentLatencies.video * 100) / 100,
            slamLatency: Math.round(this.componentLatencies.slam * 100) / 100,
            slamLatencyCpp: Math.round(this.componentLatencies.slamCpp * 100) / 100,
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

        // Create CSV header with both JS and C++ timing
        const csvHeader = 'video_name,timestamp,frame_number,frame_time_utilization_percent,memory_usage_mb,fps,video_latency_ms,slam_latency_ms_js,slam_latency_ms_cpp,wasm_overhead_ms,total_latency_ms,measurement_distance_m\n';
        
        // Create CSV content with detailed timing
        const csvContent = this.performanceData.map(data => {
            const slamLatencyJs = data.slamLatency || 0;
            const slamLatencyCpp = data.slamLatencyCpp || 0;
            const wasmOverhead = Math.max(0, slamLatencyJs - slamLatencyCpp);
            
            return `${this.videoName},${data.timestamp},${data.frameNumber},${data.frameTimeUtilization},${data.memoryUsage},${data.fps},${data.videoLatency},${slamLatencyJs},${slamLatencyCpp},${wasmOverhead},${data.totalLatency},${data.measurementDistance}`;
        }).join('\n');
        
        const fullCsv = csvHeader + csvContent;
        
        // Create and download file
        const blob = new Blob([fullCsv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const deviceName = navigator.userAgent.includes('Mobile') ? 'Mobile' : 
                          navigator.userAgent.includes('Tablet') ? 'Tablet' : 'Desktop';
        // Extract only the left video name (before the " / " separator) and remove .mp4
        const leftVideoName = this.videoName.split(' / ')[0].replace('.mp4', '').replace(/[^a-zA-Z0-9]/g, '_');
        a.download = `Stats-Report_${leftVideoName}_${deviceName}_${new Date().toLocaleString().replace(/[/:]/g, '-').replace(/,/g, '')}.csv`;
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
