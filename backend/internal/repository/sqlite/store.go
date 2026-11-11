package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"k3/backend/internal/domain"
)

// Store groups all queries. Methods take a querier so services can run them
// inside one transaction when a rule spans several statements.
type Store struct{ DB *sql.DB }

type querier interface {
	ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
}

// Tx runs fn in one BEGIN IMMEDIATE transaction.
func (s *Store) Tx(ctx context.Context, fn func(q Q) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(Q{tx}); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Q is the query set bound to either the DB or a transaction.
type Q struct{ q querier }

func (s *Store) Q() Q { return Q{s.DB} }

func Now() string { return time.Now().UTC().Format(domain.TimeFormat) }

func isUnique(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NotFound()
	}
	return err
}

// requireOne turns "0 rows updated" into a version conflict or not-found.
func (q Q) requireOne(ctx context.Context, res sql.Result, table string, id int64) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 1 {
		return nil
	}
	var exists int
	// table is a constant from callers, never user input.
	if err := q.q.QueryRowContext(ctx, "SELECT 1 FROM "+table+" WHERE id = ?", id).Scan(&exists); err != nil {
		return notFound(err)
	}
	return domain.VersionConflict()
}
