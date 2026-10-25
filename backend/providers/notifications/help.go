package notifications

import (
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// getWorkDir is where logs/ and the notification DB live: DATA_DIR when set
// (the Docker image points it at its one /data volume), else beside the binary.
func getWorkDir() string {
	if dir := os.Getenv("DATA_DIR"); dir != "" {
		return dir
	}
	ex, err := os.Executable()
	if err != nil {
		panic(err)
	}

	dir := filepath.Dir(ex)

	if strings.Contains(dir, "go-build") {
		return "."
	}
	return filepath.Dir(ex)
}

func isValidURL(url string) bool {
	pattern := `^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$`
	re := regexp.MustCompile(pattern)
	return re.MatchString(url)
}

// pushServiceHosts are the browser push services a real PushSubscription
// endpoint points at. The server POSTs to whatever endpoint a client stores, so
// anything else (loopback, LAN, metadata addresses, arbitrary hosts) is refused.
// A leading "." matches that domain's subdomains.
var pushServiceHosts = []string{
	"fcm.googleapis.com",                // Chrome, Edge, Android
	"updates.push.services.mozilla.com", // Firefox
	"web.push.apple.com",                // Safari
	".notify.windows.com",               // legacy Edge (WNS)
}

// maxPushEndpointLen bounds the stored endpoint (real ones are ~200-400 chars).
const maxPushEndpointLen = 1024

func isValidPushEndpoint(raw string) bool {
	if len(raw) > maxPushEndpointLen || !isValidURL(raw) {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range pushServiceHosts {
		if host == h || (strings.HasPrefix(h, ".") && strings.HasSuffix(host, h)) {
			return true
		}
	}
	return false
}

// validateWebPushSubscription checks a browser PushSubscription triple before it
// is stored as a delivery target - shared by client creation and /refresh.
func validateWebPushSubscription(endpoint, p256dh, auth string) error {
	if !isValidPushEndpoint(endpoint) {
		return errors.New("invalid endpoint url")
	}
	if len(p256dh) < 10 || len(p256dh) > 256 || !isBase64Url(p256dh) {
		return errors.New("invalid p256dh")
	}
	if len(auth) < 8 || len(auth) > 256 || !isBase64Url(auth) {
		return errors.New("invalid auth")
	}
	return nil
}

func isBase64Url(s string) bool {
	// Checks if a string is a valid base64url encoded string
	// base64url is similar to base64, but uses URL-safe characters: "-" and "_"
	// Instead of "+" and "/"
	// Base64url strings may end with 0, 1, or 2 `=` characters
	_, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil
}
