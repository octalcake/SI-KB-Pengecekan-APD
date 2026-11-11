// Package service holds business rules; SQL stays in repository/sqlite.
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"k3/backend/internal/domain"
	"k3/backend/internal/repository/sqlite"
)

// dummyHash keeps login timing similar for unknown usernames.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-equaliser-not-a-password"), bcrypt.DefaultCost)

type Auth struct {
	Store   *sqlite.Store
	TTL     time.Duration
	Limiter *LoginLimiter
	// OnLogout stops monitoring owned by the user before the auth session ends.
	OnLogout func(ctx context.Context, userID int64)
}

type LoginResult struct {
	User      *domain.User
	Token     string
	CSRFToken string
	ExpiresAt time.Time
}

func errInvalidLogin() error {
	return domain.NewError(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Username atau password salah.")
}

func (a *Auth) Login(ctx context.Context, ip, username, password string) (*LoginResult, error) {
	if wait := a.Limiter.Blocked(ip); wait > 0 {
		e := domain.NewError(http.StatusTooManyRequests, "RATE_LIMITED", "Terlalu banyak percobaan login. Coba lagi nanti.")
		e.RetryAfter = int(wait.Seconds()) + 1
		return nil, e
	}
	u, err := a.Store.Q().UserByUsername(ctx, username)
	hash := dummyHash
	if err == nil {
		hash = []byte(u.PasswordHash)
	} else if !isNotFound(err) {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(password)) != nil || u == nil {
		a.Limiter.Fail(ip)
		return nil, errInvalidLogin()
	}
	a.Limiter.Reset(ip)

	token, csrf := randomToken(), randomToken()
	exp := time.Now().UTC().Add(a.TTL)
	q := a.Store.Q()
	if err := q.DeleteExpiredAuthSessions(ctx); err != nil {
		return nil, err
	}
	if err := q.CreateAuthSession(ctx, HashToken(token), u.ID, csrf, exp.Format(domain.TimeFormat)); err != nil {
		return nil, err
	}
	return &LoginResult{User: &u.User, Token: token, CSRFToken: csrf, ExpiresAt: exp}, nil
}

// Authenticate resolves a raw cookie token to its user and CSRF token.
func (a *Auth) Authenticate(ctx context.Context, token string) (*domain.User, string, error) {
	return a.Store.Q().AuthSession(ctx, HashToken(token))
}

func (a *Auth) Logout(ctx context.Context, token string, userID int64) error {
	if a.OnLogout != nil {
		a.OnLogout(ctx, userID)
	}
	return a.Store.Q().DeleteAuthSession(ctx, HashToken(token))
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// randomToken returns 256 random bits, base64url encoded.
func randomToken() string {
	var b [32]byte
	rand.Read(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func isNotFound(err error) bool {
	var ae *domain.AppError
	return errors.As(err, &ae) && ae.Status == http.StatusNotFound
}

// LoginLimiter blocks an IP for one window after maxFails failed logins.
// shortcut: in-memory per process, fine for single-machine localhost MVP.
type LoginLimiter struct {
	mu       sync.Mutex
	maxFails int
	window   time.Duration
	fails    map[string][]time.Time
}

func NewLoginLimiter(maxFails int, window time.Duration) *LoginLimiter {
	return &LoginLimiter{maxFails: maxFails, window: window, fails: map[string][]time.Time{}}
}

func (l *LoginLimiter) prune(ip string, now time.Time) []time.Time {
	kept := l.fails[ip][:0]
	for _, t := range l.fails[ip] {
		if now.Sub(t) < l.window {
			kept = append(kept, t)
		}
	}
	l.fails[ip] = kept
	return kept
}

func (l *LoginLimiter) Blocked(ip string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	f := l.prune(ip, now)
	if len(f) < l.maxFails {
		return 0
	}
	return l.window - now.Sub(f[0])
}

func (l *LoginLimiter) Fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fails[ip] = append(l.prune(ip, time.Now()), time.Now())
}

func (l *LoginLimiter) Reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, ip)
}
