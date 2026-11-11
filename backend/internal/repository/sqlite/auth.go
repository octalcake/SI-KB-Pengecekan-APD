package sqlite

import (
	"context"

	"k3/backend/internal/domain"
)

type UserCredentials struct {
	domain.User
	PasswordHash string
}

func (q Q) UserByUsername(ctx context.Context, username string) (*UserCredentials, error) {
	var u UserCredentials
	err := q.q.QueryRowContext(ctx,
		`SELECT id, display_name, role, password_hash FROM users WHERE username = ?`, username,
	).Scan(&u.ID, &u.DisplayName, &u.Role, &u.PasswordHash)
	if err != nil {
		return nil, notFound(err)
	}
	return &u, nil
}

func (q Q) CreateAuthSession(ctx context.Context, tokenHash string, userID int64, csrf, expiresAt string) error {
	_, err := q.q.ExecContext(ctx,
		`INSERT INTO auth_sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		tokenHash, userID, csrf, expiresAt, Now())
	return err
}

// AuthSession returns the user and CSRF token for a valid, unexpired token hash.
func (q Q) AuthSession(ctx context.Context, tokenHash string) (*domain.User, string, error) {
	var u domain.User
	var csrf string
	err := q.q.QueryRowContext(ctx,
		`SELECT u.id, u.display_name, u.role, s.csrf_token
		 FROM auth_sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, Now(),
	).Scan(&u.ID, &u.DisplayName, &u.Role, &csrf)
	if err != nil {
		return nil, "", notFound(err)
	}
	return &u, csrf, nil
}

func (q Q) DeleteAuthSession(ctx context.Context, tokenHash string) error {
	_, err := q.q.ExecContext(ctx, `DELETE FROM auth_sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (q Q) DeleteExpiredAuthSessions(ctx context.Context) error {
	_, err := q.q.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at <= ?`, Now())
	return err
}
