package notifications

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func getWorkDir() string {
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

func isBase64Url(s string) bool {
	// Checks if a string is a valid base64url encoded string
	// base64url is similar to base64, but uses URL-safe characters: "-" and "_"
	// Instead of "+" and "/"
	// Base64url strings may end with 0, 1, or 2 `=` characters
	_, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil
}
