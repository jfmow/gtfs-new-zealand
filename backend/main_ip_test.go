package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestClientIPIgnoresSpoofedForwardedFor(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "100.64.0.0/10")
	extract := echo.ExtractIPFromXFFHeader(trustedProxyOptions()...)

	cases := []struct {
		name, remote, xff, want string
	}{
		{"direct client spoofing the header", "203.0.113.9:5000", "198.51.100.1", "203.0.113.9"},
		{"via local proxy", "127.0.0.1:5000", "198.51.100.1", "198.51.100.1"},
		{"via docker bridge proxy", "172.17.0.1:5000", "198.51.100.1", "198.51.100.1"},
		{"via TRUSTED_PROXIES range", "100.100.1.1:5000", "198.51.100.1", "198.51.100.1"},
		{"client prepends a fake hop through a trusted proxy", "127.0.0.1:5000", "198.51.100.77, 203.0.113.9", "203.0.113.9"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, "/at/routes", nil)
		req.RemoteAddr = tc.remote
		req.Header.Set(echo.HeaderXForwardedFor, tc.xff)
		if got := extract(req); got != tc.want {
			t.Errorf("%s: client IP = %s, want %s", tc.name, got, tc.want)
		}
	}
}
