// Command seed creates the single officer account. It never overwrites an
// existing user; remove SEED_PASSWORD from env after it succeeds.
package main

import (
	"log/slog"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"k3/backend/internal/config"
	"k3/backend/internal/repository/sqlite"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fatal("invalid config", err)
	}
	pw := cfg.SeedPassword
	if len(pw) < 12 || strings.HasPrefix(pw, "isi-") {
		fatal("SEED_PASSWORD must be set to a real password of at least 12 characters", nil)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		fatal("hash password", err)
	}

	db, err := sqlite.Open(cfg.DBPath)
	if err != nil {
		fatal("open db", err)
	}
	defer db.Close()

	res, err := db.Exec(
		`INSERT INTO users (username, password_hash, display_name, created_at)
		 VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING`,
		cfg.SeedUsername, string(hash), cfg.SeedDisplayName, time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		fatal("insert user (did you run migrations?)", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		slog.Info("user already exists, nothing changed", "username", cfg.SeedUsername)
		return
	}
	slog.Info("user created", "username", cfg.SeedUsername)
}

func fatal(msg string, err error) {
	slog.Error(msg, "err", err)
	os.Exit(1)
}
