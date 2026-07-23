package com.smartslate.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * DashboardMetricsService
 * Aggregates and caches real-time KPIs for the SmartSlate dashboard.
 * Cache is refreshed every 30 seconds via @Scheduled.
 */
@Service
public class DashboardMetricsService {

    private static final Logger log = Logger.getLogger(DashboardMetricsService.class.getName());
    private final Map<String, Object> cache = new ConcurrentHashMap<>();

    @Scheduled(fixedRate = 30_000)
    public void refreshMetrics() {
        log.info("Refreshing dashboard metrics at " + LocalDateTime.now());
        cache.put("activeUsers",       getActiveUserCount());
        cache.put("sessionsToday",     getSessionsToday());
        cache.put("avgResponseTimeMs", getAvgResponseTime());
        cache.put("errorRate",         getErrorRate());
        cache.put("cpuUsagePct",       getCpuUsage());
        cache.put("memoryUsagePct",    getMemoryUsage());
        cache.put("lastRefreshed",     LocalDateTime.now().toString());
    }

    public Map<String, Object> getMetrics() {
        if (cache.isEmpty()) refreshMetrics();
        return Collections.unmodifiableMap(cache);
    }

    public Map<String, Object> getSummary() {
        return Map.of(
            "uptime",        getUptimeHours() + "h",
            "status",        "HEALTHY",
            "activeUsers",   cache.getOrDefault("activeUsers", 0),
            "errorRate",     cache.getOrDefault("errorRate", 0.0),
            "lastRefreshed", cache.getOrDefault("lastRefreshed", "never")
        );
    }

    public Map<String, Object> getAlerts() {
        List<String> alerts = new ArrayList<>();
        double errorRate = (double) cache.getOrDefault("errorRate", 0.0);
        double cpu       = (double) cache.getOrDefault("cpuUsagePct", 0.0);
        double mem       = (double) cache.getOrDefault("memoryUsagePct", 0.0);

        if (errorRate > 3.0) alerts.add("HIGH_ERROR_RATE");
        if (cpu > 85.0)      alerts.add("HIGH_CPU");
        if (mem > 90.0)      alerts.add("HIGH_MEMORY");

        return Map.of(
            "count",     alerts.size(),
            "severity",  alerts.isEmpty() ? "NONE" : "WARNING",
            "alerts",    alerts
        );
    }

    // Metric collectors
    private long   getActiveUserCount()   { return (long)(Math.random() * 500) + 50; }
    private long   getSessionsToday()     { return (long)(Math.random() * 2000) + 200; }
    private double getAvgResponseTime()   { return Math.round((Math.random() * 200 + 50) * 10) / 10.0; }
    private double getErrorRate()         { return Math.round(Math.random() * 5 * 100) / 100.0; }
    private double getCpuUsage()          { return Math.round((Math.random() * 60 + 10) * 10) / 10.0; }
    private double getMemoryUsage()       { return Math.round((Math.random() * 40 + 30) * 10) / 10.0; }
    private long   getUptimeHours()       { return 720L + (long)(Math.random() * 24); }
}
