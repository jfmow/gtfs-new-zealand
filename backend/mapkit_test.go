package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func testMapkitSigner(t *testing.T) (*mapkitSigner, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	p8 := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	t.Setenv("MAPKIT_TEAM_ID", "TEAM123456")
	t.Setenv("MAPKIT_KEY_ID", "KEY1234567")
	// As a single-line .env value would hold it.
	t.Setenv("MAPKIT_PRIVATE_KEY", strings.ReplaceAll(p8, "\n", `\n`))
	s, err := newMapkitSignerFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	return s, key
}

func TestMapkitTokenClaims(t *testing.T) {
	s, key := testMapkitSigner(t)
	now := time.Now()
	signed, exp, err := s.current(now)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(signed, func(tok *jwt.Token) (any, error) { return &key.PublicKey, nil }, jwt.WithValidMethods([]string{"ES256"}))
	if err != nil {
		t.Fatalf("token doesn't verify: %v", err)
	}
	if parsed.Header["kid"] != "KEY1234567" {
		t.Errorf("kid = %v", parsed.Header["kid"])
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["iss"] != "TEAM123456" {
		t.Errorf("iss = %v", claims["iss"])
	}
	if _, hasOrigin := claims["origin"]; hasOrigin {
		t.Error("token must not be origin-restricted (the Android web view has no origin)")
	}
	if got := exp.Sub(now); got < 29*time.Minute || got > 31*time.Minute {
		t.Errorf("lifetime = %v", got)
	}
}

func TestMapkitTokenIsReusedUntilNearExpiry(t *testing.T) {
	s, _ := testMapkitSigner(t)
	now := time.Now()
	a, _, _ := s.current(now)
	b, _, _ := s.current(now.Add(10 * time.Minute))
	if a != b {
		t.Error("a token with 20 minutes left should be reused")
	}
	c, _, _ := s.current(now.Add(26 * time.Minute))
	if c == a {
		t.Error("a token with under 5 minutes left should be replaced")
	}
}

func TestMapkitSignerNeedsAllEnv(t *testing.T) {
	t.Setenv("MAPKIT_TEAM_ID", "TEAM123456")
	t.Setenv("MAPKIT_KEY_ID", "")
	t.Setenv("MAPKIT_PRIVATE_KEY", "")
	if _, err := newMapkitSignerFromEnv(); err == nil {
		t.Error("expected an error with the key missing")
	}
}
