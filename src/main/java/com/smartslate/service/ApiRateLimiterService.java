package com.smartslate.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * ApiRateLimiterService
 * Token bucket algorithm — each client gets a bucket that refills every second.
 * Tracks total number of rate-limited (rejected) requests per client.
 */
@Service
public class ApiRateLimiterService {

    private static final Logger log = LoggerFactory.getLogger(ApiRateLimiterService.class);

    @Value("${smartslate.ratelimit.maxTokens:100}")
    private long maxTokens;

    @Value("${smartslate.ratelimit.refillRatePerSecond:10}")
    private long refillRatePerSecond;

    /** clientId -> current token count */
    private final ConcurrentHashMap<String, AtomicLong> tokenBuckets = new ConcurrentHashMap<>();

    /** clientId -> total rejected request count */
    private final ConcurrentHashMap<String, AtomicLong> rejectedCounts = new ConcurrentHashMap<>();

    /**
     * Tries to consume `tokens` from the client's bucket.
     *
     * @param clientId the API client identifier (IP, API key, etc.)
     * @param tokens   number of tokens to consume (typically 1 per request)
     * @return true if the request is allowed, false if rate-limited
     */
    public boolean tryConsume(String clientId, int tokens) {
        if (clientId == null || clientId.isBlank()) return false;
        AtomicLong bucket = tokenBuckets.computeIfAbsent(clientId, k -> new AtomicLong(maxTokens));

        // Atomically subtract tokens if enough are available
        long prev = bucket.get();
        while (prev >= tokens) {
            if (bucket.compareAndSet(prev, prev - tokens)) {
                log.debug("[RateLimit] {} consumed {} tokens, {} remaining", clientId, tokens, prev - tokens);
                return true;
            }
            prev = bucket.get();
        }
        // Not enough tokens — rate limited
        rejectedCounts.computeIfAbsent(clientId, k -> new AtomicLong(0)).incrementAndGet();
        log.warn("[RateLimit] {} is rate-limited. Requested {}, available {}", clientId, tokens, prev);
        return false;
    }

    /**
     * Returns the remaining token count for a client.
     */
    public long getRemaining(String clientId) {
        AtomicLong bucket = tokenBuckets.get(clientId);
        return bucket == null ? maxTokens : bucket.get();
    }

    /**
     * Resets a client's bucket to the maximum token count.
     */
    public void resetBucket(String clientId) {
        tokenBuckets.put(clientId, new AtomicLong(maxTokens));
        rejectedCounts.remove(clientId);
        log.info("[RateLimit] Bucket reset for client: {}", clientId);
    }

    /**
     * Returns true if the client currently has 0 tokens (is rate-limited right now).
     */
    public boolean isRateLimited(String clientId) {
        return getRemaining(clientId) <= 0;
    }

    /**
     * Returns aggregate stats across all known clients.
     */
    public Map<String, Object> getStats() {
        long totalClients  = tokenBuckets.size();
        long totalLimited  = rejectedCounts.values().stream().mapToLong(AtomicLong::get).sum();
        long currentlyLimited = tokenBuckets.entrySet().stream()
                .filter(e -> e.getValue().get() <= 0)
                .count();

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("totalClients",       totalClients);
        stats.put("totalLimitedCount",  totalLimited);
        stats.put("currentlyLimited",   currentlyLimited);
        stats.put("maxTokens",          maxTokens);
        stats.put("refillRatePerSec",   refillRatePerSecond);
        stats.put("snapshotAt",         LocalDateTime.now().toString());
        return stats;
    }

    /**
     * Refills all client buckets by refillRatePerSecond tokens every second.
     * Caps at maxTokens.
     */
    @Scheduled(fixedRate = 1_000)
    public void refillBuckets() {
        tokenBuckets.forEach((clientId, bucket) -> {
            long current = bucket.get();
            if (current < maxTokens) {
                long next = Math.min(maxTokens, current + refillRatePerSecond);
                bucket.compareAndSet(current, next);
            }
        });
    }
}
