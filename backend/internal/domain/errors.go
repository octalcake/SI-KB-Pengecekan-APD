// Package domain holds shared types and the application error used by every layer.
package domain

import (
	"fmt"
	"net/http"
)

// AppError maps to the §9.1 error body. Message is safe to show the user.
type AppError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	// RetryAfter, in seconds, is sent as the Retry-After header when > 0.
	RetryAfter int
}

func (e *AppError) Error() string { return fmt.Sprintf("%d %s: %s", e.Status, e.Code, e.Message) }

func NewError(status int, code, msg string) *AppError {
	return &AppError{Status: status, Code: code, Message: msg}
}

func Validation(fields map[string]string) *AppError {
	return &AppError{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_ERROR", Message: "Input tidak valid.", Fields: fields}
}

func BadRequest(msg string) *AppError {
	return NewError(http.StatusBadRequest, "BAD_REQUEST", msg)
}

func NotFound() *AppError {
	return NewError(http.StatusNotFound, "NOT_FOUND", "Data tidak ditemukan.")
}

func Conflict(code, msg string) *AppError {
	return NewError(http.StatusConflict, code, msg)
}

func VersionConflict() *AppError {
	return Conflict("VERSION_CONFLICT", "Data telah diubah oleh proses lain. Muat ulang lalu coba lagi.")
}

func Forbidden(code, msg string) *AppError {
	return NewError(http.StatusForbidden, code, msg)
}
