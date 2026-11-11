// Package sqlite holds all SQL; only Go opens the database.
package sqlite

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

// Open sets the pragmas on every connection (SRS §11.1); dbmate migrations
// run in a transaction where these pragmas are no-ops, so they live here.
func Open(path string) (*sql.DB, error) {
	dsn := "file:" + path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
