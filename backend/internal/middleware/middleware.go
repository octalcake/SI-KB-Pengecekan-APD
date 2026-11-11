// Package middleware implements the SRS §7.2 chain:
// request ID → recovery → safe logging → Host/Origin allowlist → auth → CSRF.
package middleware

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"k3/backend/internal/domain"
	"k3/backend/internal/httpx"
	"k3/backend/internal/service"
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(s int) { w.status = s; w.ResponseWriter.WriteHeader(s) }

// Base wraps every request: request ID, panic recovery, metadata-only logging.
func Base(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b [6]byte
		rand.Read(b[:])
		id := "req-" + hex.EncodeToString(b[:])
		r = r.WithContext(httpx.WithRequestID(r.Context(), id))
		w.Header().Set("X-Request-ID", id)
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		defer func() {
			if p := recover(); p != nil {
				slog.Error("panic", "request_id", id, "panic", p)
				httpx.Error(sw, r, domain.NewError(http.StatusInternalServerError, "INTERNAL_ERROR", "Terjadi kesalahan internal."))
			}
			// No query string, body, cookies or headers: they may hold tokens.
			slog.Info("http", "request_id", id, "method", r.Method, "path", r.URL.Path,
				"status", sw.status, "ms", time.Since(start).Milliseconds())
		}()
		next.ServeHTTP(sw, r)
	})
}

// Origin rejects foreign Host headers, and mutating requests whose Origin is not allowlisted.
func Origin(hosts, origins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !slices.Contains(hosts, r.Host) {
				httpx.Error(w, r, domain.Forbidden("HOST_NOT_ALLOWED", "Host tidak diizinkan."))
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead && !slices.Contains(origins, r.Header.Get("Origin")) {
				httpx.Error(w, r, domain.Forbidden("ORIGIN_NOT_ALLOWED", "Origin tidak diizinkan."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type Authenticator struct {
	Auth       *service.Auth
	CookieName string
}

func unauthorized() error {
	return domain.NewError(http.StatusUnauthorized, "UNAUTHORIZED", "Silakan login terlebih dahulu.")
}

// Require resolves the session cookie; mutating methods also need X-CSRF-Token.
func (a *Authenticator) Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(a.CookieName)
		if err != nil || c.Value == "" {
			httpx.Error(w, r, unauthorized())
			return
		}
		u, csrf, err := a.Auth.Authenticate(r.Context(), c.Value)
		if err != nil {
			httpx.Error(w, r, unauthorized())
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead &&
			subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(csrf)) != 1 {
			httpx.Error(w, r, domain.Forbidden("CSRF_INVALID", "Token CSRF tidak valid."))
			return
		}
		next(w, r.WithContext(httpx.WithAuth(r.Context(), u, csrf, c.Value)))
	}
}
