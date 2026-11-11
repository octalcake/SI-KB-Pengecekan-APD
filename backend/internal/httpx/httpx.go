// Package httpx holds the JSON envelope (SRS §9.1) shared by handlers and middleware.
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"k3/backend/internal/domain"
)

type ctxKey int

const (
	keyRequestID ctxKey = iota
	keyUser
	keyCSRF
	keyToken
)

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyRequestID, id)
}

func RequestID(ctx context.Context) string { s, _ := ctx.Value(keyRequestID).(string); return s }

func WithAuth(ctx context.Context, u *domain.User, csrf, token string) context.Context {
	ctx = context.WithValue(ctx, keyUser, u)
	ctx = context.WithValue(ctx, keyCSRF, csrf)
	return context.WithValue(ctx, keyToken, token)
}

func User(ctx context.Context) *domain.User { u, _ := ctx.Value(keyUser).(*domain.User); return u }
func CSRF(ctx context.Context) string       { s, _ := ctx.Value(keyCSRF).(string); return s }
func Token(ctx context.Context) string      { s, _ := ctx.Value(keyToken).(string); return s }

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func Data(w http.ResponseWriter, status int, v any) { JSON(w, status, map[string]any{"data": v}) }

func List(w http.ResponseWriter, v any, page domain.Page) {
	JSON(w, http.StatusOK, map[string]any{"data": v, "meta": page})
}

// Error writes an AppError as-is; anything else becomes a generic 500 and is logged.
func Error(w http.ResponseWriter, r *http.Request, err error) {
	var ae *domain.AppError
	if !errors.As(err, &ae) {
		slog.Error("internal error", "request_id", RequestID(r.Context()), "path", r.URL.Path, "err", err)
		ae = domain.NewError(http.StatusInternalServerError, "INTERNAL_ERROR", "Terjadi kesalahan internal.")
	}
	if ae.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(ae.RetryAfter))
	}
	body := map[string]any{"code": ae.Code, "message": ae.Message, "request_id": RequestID(r.Context())}
	if len(ae.Fields) > 0 {
		body["fields"] = ae.Fields
	}
	JSON(w, ae.Status, map[string]any{"error": body})
}
