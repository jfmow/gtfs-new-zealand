package main

import (
	"crypto/ecdsa"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v5"
)

// MapKit JS tokens, signed here so they never expire on the client.
//
// Apple's dashboard tokens without a domain restriction last only 7 days, and
// the Android app's map (MapKit JS in a web view, loaded from file://) can't
// use a domain-restricted one. A token signed with a MapKit JS key from the
// Apple developer account (Certificates, IDs & Profiles -> Keys, with MapKit JS
// enabled) has whatever lifetime we give it; MapKit JS asks for a new one
// through its authorizationCallback when it runs out.
//
// Env: MAPKIT_TEAM_ID, MAPKIT_KEY_ID, MAPKIT_PRIVATE_KEY (the .p8 contents;
// literal "\n" sequences are accepted for single-line .env values).

const mapkitTokenLifetime = 30 * time.Minute

type mapkitSigner struct {
	teamID string
	keyID  string
	key    *ecdsa.PrivateKey

	mu      sync.Mutex
	token   string
	expires time.Time
}

func newMapkitSignerFromEnv() (*mapkitSigner, error) {
	teamID := strings.TrimSpace(os.Getenv("MAPKIT_TEAM_ID"))
	keyID := strings.TrimSpace(os.Getenv("MAPKIT_KEY_ID"))
	pem := strings.ReplaceAll(os.Getenv("MAPKIT_PRIVATE_KEY"), `\n`, "\n")
	if teamID == "" || keyID == "" || strings.TrimSpace(pem) == "" {
		return nil, errors.New("MAPKIT_TEAM_ID, MAPKIT_KEY_ID and MAPKIT_PRIVATE_KEY are not all set")
	}
	key, err := jwt.ParseECPrivateKeyFromPEM([]byte(pem))
	if err != nil {
		return nil, err
	}
	return &mapkitSigner{teamID: teamID, keyID: keyID, key: key}, nil
}

// current returns a token with at least five minutes left, signing a new one
// when needed - one signature per ~25 minutes however many clients ask.
func (s *mapkitSigner) current(now time.Time) (string, time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && now.Add(5*time.Minute).Before(s.expires) {
		return s.token, s.expires, nil
	}
	exp := now.Add(mapkitTokenLifetime)
	t := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": s.teamID,
		"iat": now.Unix(),
		"exp": exp.Unix(),
	})
	t.Header["kid"] = s.keyID
	signed, err := t.SignedString(s.key)
	if err != nil {
		return "", time.Time{}, err
	}
	s.token, s.expires = signed, exp
	return signed, exp, nil
}

// mapkitTokenHandler: GET /mapkit/token -> {"token": "...", "expires_at": unix}.
// 503 when the server has no MapKit key configured (the app then falls back
// to its other map).
func mapkitTokenHandler(signer *mapkitSigner) echo.HandlerFunc {
	return func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-store")
		if signer == nil {
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"message": "MapKit is not configured on this server"})
		}
		token, exp, err := signer.current(time.Now())
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Couldn't sign a MapKit token"})
		}
		return c.JSON(http.StatusOK, map[string]any{"token": token, "expires_at": exp.Unix()})
	}
}
