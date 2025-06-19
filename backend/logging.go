package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	_ "github.com/mattn/go-sqlite3"
	"github.com/sirupsen/logrus"
)

// RequestLoggerMiddleware logs each request with structured log fields
func RequestLoggerMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()

			traceID, ok := c.Get("trace_id").(string)
			if !ok {
				traceID = ""
			}

			err := next(c)

			stop := time.Now()
			latency := stop.Sub(start)

			entry := logrus.WithFields(logrus.Fields{
				"time":      stop.Format(time.RFC3339),
				"method":    c.Request().Method,
				"path":      c.Request().URL.Path,
				"status":    c.Response().Status,
				"latency":   latency.String(),
				"trace_id":  traceID,
				"remote_ip": c.RealIP(),
			})

			if details := c.Get("log_details"); details != nil {
				entry = entry.WithField("details", details)
			}

			if err != nil {
				entry = entry.WithField("error", err)
				entry.Error("Request failed")
			} else {
				if c.Response().Status != http.StatusOK {
					entry = entry.WithField("error", "non-200 status code")
					entry.Warn("Request completed with non-200 status")
				} else {
					entry.Info("Request completed successfully")
				}
			}

			return err
		}
	}
}

// TraceIDMiddleware adds a trace ID to requests for tracking
func TraceIDMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			traceID := c.Request().Header.Get("X-Trace-ID")
			if traceID == "" {
				traceID = uuid.New().String()
			}

			c.Set("trace_id", traceID)
			c.Response().Header().Set("X-Trace-ID", traceID)

			return next(c)
		}
	}
}

type LogEntry struct {
	Level   string      `json:"level"`
	Message string      `json:"message"`
	Time    time.Time   `json:"time"`
	TraceID string      `json:"trace_id,omitempty"`
	Details interface{} `json:"details,omitempty"`
}

func GetLogsHandler(c echo.Context) error {
	logPath := filepath.Join(getWorkDir(), "logs", "api.log")

	levelFilter := strings.ToLower(c.QueryParam("level"))
	limitStr := c.QueryParam("limit")
	sinceStr := c.QueryParam("since")

	limit := 100
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil {
			limit = parsed
		}
	}

	var since time.Time
	if sinceStr != "" {
		dur, err := time.ParseDuration(sinceStr)
		if err == nil {
			since = time.Now().Add(-dur)
		}
	}

	file, err := os.Open(logPath)
	if err != nil {
		return c.String(http.StatusInternalServerError, "Failed to open log file")
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	logs := make([]LogEntry, 0)

	for scanner.Scan() {
		line := scanner.Text()
		var entry map[string]interface{}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}

		timeStr, ok := entry["time"].(string)
		if !ok {
			continue
		}
		timestamp, err := time.Parse(time.RFC3339, timeStr)
		if err != nil {
			continue
		}
		if !since.IsZero() && timestamp.Before(since) {
			continue
		}

		levelStr, ok := entry["level"].(string)
		if !ok {
			continue
		}
		level := strings.ToLower(levelStr)
		if levelFilter != "" && level != levelFilter {
			continue
		}

		messageStr, ok := entry["msg"].(string)
		if !ok {
			continue
		}

		traceIDStr, _ := entry["trace_id"].(string)

		// Extract "details" if present (can be any JSON value)
		var details interface{}
		if d, found := entry["details"]; found {
			details = d
		}

		logs = append(logs, LogEntry{
			Level:   level,
			Message: messageStr,
			Time:    timestamp,
			TraceID: traceIDStr,
			Details: details,
		})
	}

	sort.Slice(logs, func(i, j int) bool {
		return logs[i].Time.After(logs[j].Time)
	})

	if len(logs) > limit {
		logs = logs[:limit]
	}

	return c.JSON(http.StatusOK, logs)
}
